package git

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/blueship581/pinru/internal/errs"
	gl "github.com/blueship581/pinru/internal/gitlab"
	"github.com/blueship581/pinru/internal/gitops"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type QuestionBankSyncDetail struct {
	QuestionID  int64  `json:"questionId"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
	Message     string `json:"message"`
}

type QuestionBankSyncResult struct {
	ProjectID    string                    `json:"projectId"`
	ProjectName  string                    `json:"projectName"`
	SyncedCount  int                       `json:"syncedCount"`
	SkippedCount int                       `json:"skippedCount"`
	ErrorCount   int                       `json:"errorCount"`
	Details      []QuestionBankSyncDetail  `json:"details"`
}

type localQuestionBankTrackedState struct {
	paths              map[string]struct{}
	existingQuestionIDs map[int64]store.QuestionBankItem
}

func (s *GitService) ListQuestionBankItems(projectID string) ([]store.QuestionBankItem, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, errors.New(errs.MsgProjectRequired)
	}
	project, err := s.store.GetProject(projectID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, fmt.Errorf(errs.FmtStoreProjectNotFound, projectID)
	}

	items, err := s.store.ListQuestionBankItems(project.ID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].SourcePath = util.NormalizePath(items[i].SourcePath)
		if items[i].ArchivePath != nil {
			normalized := util.NormalizePath(*items[i].ArchivePath)
			items[i].ArchivePath = &normalized
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(items[i].DisplayName))
		right := strings.ToLower(strings.TrimSpace(items[j].DisplayName))
		if left != right {
			return left < right
		}
		return items[i].QuestionID < items[j].QuestionID
	})
	return items, nil
}

// DeleteQuestionBankItem removes a single question from the project's
// question bank. It deletes the source directory, any archived snapshot,
// and the database row. Refuses when a task has already been claimed from
// this question, to avoid orphaning task records.
func (s *GitService) DeleteQuestionBankItem(projectID string, questionID int64) error {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return errors.New(errs.MsgProjectRequired)
	}
	if s.store == nil {
		return errors.New("存储服务未初始化")
	}

	item, err := s.store.GetQuestionBankItem(projectID, questionID)
	if err != nil {
		return err
	}
	if item == nil {
		return fmt.Errorf(errs.FmtQuestionBankItemNotFound, questionID)
	}

	existingTask, err := s.store.FindTaskByProjectConfigAndGitLabProjectID(projectID, questionID)
	if err != nil {
		return err
	}
	if existingTask != nil {
		return fmt.Errorf("该题已被领用为任务 %s，请先删除任务再移除题库条目", existingTask.ID)
	}

	sourcePath := strings.TrimSpace(item.SourcePath)
	if sourcePath != "" {
		if err := os.RemoveAll(util.ExpandTilde(sourcePath)); err != nil {
			return fmt.Errorf("删除题源目录失败：%w", err)
		}
	}
	if item.ArchivePath != nil {
		archivePath := strings.TrimSpace(*item.ArchivePath)
		if archivePath != "" {
			if err := os.Remove(util.ExpandTilde(archivePath)); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("删除归档文件失败：%w", err)
			}
		}
	}

	return s.store.DeleteQuestionBankItem(projectID, questionID)
}

func (s *GitService) ScanLocalQuestionBank(projectID string) (*ImportLocalSourcesResult, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, errors.New(errs.MsgProjectRequired)
	}
	if s.store == nil {
		return nil, errors.New("存储服务未初始化")
	}

	project, err := s.store.GetProject(projectID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, fmt.Errorf(errs.FmtStoreProjectNotFound, projectID)
	}

	basePath := util.NormalizePath(project.CloneBasePath)
	if basePath == "" {
		return nil, errors.New(errs.MsgRootDirRequired)
	}
	if err := os.MkdirAll(util.ExpandTilde(basePath), 0o755); err != nil {
		return nil, err
	}

	removedDetails, err := s.pruneMissingLocalQuestionBankItems(project.ID)
	if err != nil {
		return nil, err
	}

	trackedState, err := s.collectLocalQuestionBankTrackedState(project.ID)
	if err != nil {
		return nil, err
	}

	models := parseLocalImportModels(project.Models, project.SourceModelFolder)
	questionBankRoot := util.BuildQuestionBankRootPath(basePath)
	candidates, skippedDetails, err := discoverLocalQuestionBankCandidates(basePath, questionBankRoot, trackedState.paths, models)
	if err != nil {
		return nil, err
	}

	result := &ImportLocalSourcesResult{
		ProjectID:   project.ID,
		ProjectName: project.Name,
		Details:     make([]ImportLocalSourceDetail, 0, len(removedDetails)+len(candidates)+len(skippedDetails)),
	}
	result.Details = append(result.Details, removedDetails...)
	result.RemovedCount = len(removedDetails)
	result.Details = append(result.Details, skippedDetails...)
	result.SkippedCount += len(skippedDetails)

	for _, candidate := range candidates {
		if existingItem, ok := trackedState.existingQuestionIDs[candidate.SyntheticProject]; ok {
			result.Details = append(result.Details, ImportLocalSourceDetail{
				Name:    candidate.Name,
				Kind:    candidate.Kind,
				Path:    candidate.Path,
				Status:  "skipped",
				Message: fmt.Sprintf("题库已存在题目 %s（%d），跳过重复入库", existingItem.DisplayName, existingItem.QuestionID),
			})
			result.SkippedCount++
			continue
		}

		detail, item, scanErr := s.scanLocalSourceCandidateToQuestionBank(*project, candidate)
		if scanErr != nil {
			result.Details = append(result.Details, ImportLocalSourceDetail{
				Name:    candidate.Name,
				Kind:    candidate.Kind,
				Path:    candidate.Path,
				Status:  "error",
				Message: scanErr.Error(),
			})
			result.ErrorCount++
			continue
		}

		trackedState.existingQuestionIDs[candidate.SyntheticProject] = item
		result.Details = append(result.Details, detail)
		result.ImportedCount++
	}

	sort.SliceStable(result.Details, func(i, j int) bool {
		leftName := strings.ToLower(result.Details[i].Name)
		rightName := strings.ToLower(result.Details[j].Name)
		if leftName != rightName {
			return leftName < rightName
		}
		if result.Details[i].Kind != result.Details[j].Kind {
			return result.Details[i].Kind < result.Details[j].Kind
		}
		return result.Details[i].Path < result.Details[j].Path
	})

	return result, nil
}

func (s *GitService) ImportLocalSources(projectID string) (*ImportLocalSourcesResult, error) {
	return s.ScanLocalQuestionBank(projectID)
}

// PickQuestionBankArchives opens a native file picker for selecting
// multiple .zip/.7z archives. Returns the absolute paths the user selected,
// or an empty slice if the user cancelled.
func (s *GitService) PickQuestionBankArchives() ([]string, error) {
	app := application.Get()
	if app == nil {
		return nil, errors.New("wails 运行时未就绪")
	}
	paths, err := app.Dialog.OpenFile().
		SetTitle("选择要导入的题库压缩包").
		CanChooseFiles(true).
		CanChooseDirectories(false).
		AddFilter("压缩包", "*.zip;*.7z").
		PromptForMultipleSelection()
	if err != nil {
		return nil, err
	}
	return paths, nil
}

// ImportQuestionBankArchives copies the provided archive files into the
// project's CloneBasePath, then triggers ScanLocalQuestionBank so the newly
// copied archives are imported into the question bank.
func (s *GitService) ImportQuestionBankArchives(projectID string, archivePaths []string) (*ImportLocalSourcesResult, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, errors.New(errs.MsgProjectRequired)
	}
	if len(archivePaths) == 0 {
		return nil, errors.New("未选择任何压缩包")
	}

	project, err := s.store.GetProject(projectID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, fmt.Errorf(errs.FmtStoreProjectNotFound, projectID)
	}
	basePath := util.NormalizePath(project.CloneBasePath)
	if basePath == "" {
		return nil, errors.New(errs.MsgRootDirRequired)
	}
	if err := os.MkdirAll(util.ExpandTilde(basePath), 0o755); err != nil {
		return nil, err
	}
	archivesDir := util.ExpandTilde(util.BuildQuestionBankArchivesPath(basePath))
	if err := os.MkdirAll(archivesDir, 0o755); err != nil {
		return nil, err
	}

	preDetails := make([]ImportLocalSourceDetail, 0, len(archivePaths))
	for _, raw := range archivePaths {
		src := strings.TrimSpace(raw)
		if src == "" {
			continue
		}
		ext := strings.ToLower(filepath.Ext(src))
		if ext != ".zip" && ext != ".7z" {
			preDetails = append(preDetails, ImportLocalSourceDetail{
				Name:    filepath.Base(src),
				Kind:    "archive",
				Path:    src,
				Status:  "error",
				Message: "不支持的压缩格式（仅支持 .zip / .7z）",
			})
			continue
		}
		info, err := os.Stat(src)
		if err != nil {
			preDetails = append(preDetails, ImportLocalSourceDetail{
				Name:    filepath.Base(src),
				Kind:    "archive",
				Path:    src,
				Status:  "error",
				Message: fmt.Sprintf("读取压缩包失败：%v", err),
			})
			continue
		}
		if info.IsDir() {
			preDetails = append(preDetails, ImportLocalSourceDetail{
				Name:    filepath.Base(src),
				Kind:    "archive",
				Path:    src,
				Status:  "error",
				Message: "路径是目录而不是压缩包",
			})
			continue
		}

		dest, err := pickAvailableCopyDest(archivesDir, filepath.Base(src))
		if err != nil {
			preDetails = append(preDetails, ImportLocalSourceDetail{
				Name:    filepath.Base(src),
				Kind:    "archive",
				Path:    src,
				Status:  "error",
				Message: err.Error(),
			})
			continue
		}

		if err := copyQuestionBankArchive(src, dest); err != nil {
			_ = os.Remove(dest)
			preDetails = append(preDetails, ImportLocalSourceDetail{
				Name:    filepath.Base(src),
				Kind:    "archive",
				Path:    src,
				Status:  "error",
				Message: fmt.Sprintf("复制压缩包失败：%v", err),
			})
			continue
		}
	}

	result, err := s.ScanLocalQuestionBank(projectID)
	if err != nil {
		return nil, err
	}
	if len(preDetails) > 0 {
		result.Details = append(preDetails, result.Details...)
		for _, d := range preDetails {
			if d.Status == "error" {
				result.ErrorCount++
			}
		}
	}
	return result, nil
}

func pickAvailableCopyDest(baseDir, baseName string) (string, error) {
	baseName = strings.TrimSpace(baseName)
	if baseName == "" {
		return "", errors.New("压缩包文件名为空")
	}
	dest := filepath.Join(baseDir, baseName)
	if _, err := os.Stat(dest); os.IsNotExist(err) {
		return dest, nil
	} else if err != nil {
		return "", err
	}
	ext := filepath.Ext(baseName)
	stem := strings.TrimSuffix(baseName, ext)
	for i := 1; i < 1000; i++ {
		candidate := filepath.Join(baseDir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("目录 %s 已存在过多同名文件", baseDir)
}

func copyQuestionBankArchive(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func (s *GitService) SyncGitLabQuestionBank(projectID string, questionIDs []int64) (*QuestionBankSyncResult, error) {
	return s.syncGitLabQuestionBank(projectID, questionIDs, len(questionIDs) > 0)
}

func (s *GitService) RefreshQuestionBankItem(projectID string, questionID int64) (*QuestionBankSyncResult, error) {
	item, err := s.store.GetQuestionBankItem(strings.TrimSpace(projectID), questionID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf(errs.FmtQuestionBankItemNotFound, questionID)
	}
	if strings.TrimSpace(item.SourceKind) != "gitlab" {
		return nil, errors.New(errs.MsgQuestionBankRefreshOnlyGitLab)
	}
	return s.syncGitLabQuestionBank(projectID, []int64{questionID}, true)
}

// pruneMissingLocalQuestionBankItems removes question-bank rows whose backing
// files on disk have been deleted out-of-band. Only local-sourced entries are
// considered — GitLab entries are managed by the sync flow and stay put. A
// row is pruned only when both its source directory and its archive (if any)
// are missing, so partial/in-flight states don't cause data loss.
func (s *GitService) pruneMissingLocalQuestionBankItems(projectID string) ([]ImportLocalSourceDetail, error) {
	items, err := s.store.ListQuestionBankItems(projectID)
	if err != nil {
		return nil, err
	}

	removed := make([]ImportLocalSourceDetail, 0)
	for _, item := range items {
		kind := strings.TrimSpace(item.SourceKind)
		if kind != "local_archive" && kind != "local_directory" {
			continue
		}

		sourcePath := strings.TrimSpace(item.SourcePath)
		archivePath := ""
		if item.ArchivePath != nil {
			archivePath = strings.TrimSpace(*item.ArchivePath)
		}

		if sourcePath != "" && pathExists(sourcePath) {
			continue
		}
		if archivePath != "" && pathExists(archivePath) {
			continue
		}

		if err := s.store.DeleteQuestionBankItem(projectID, item.QuestionID); err != nil {
			return nil, err
		}

		displayName := strings.TrimSpace(item.DisplayName)
		if displayName == "" {
			displayName = fmt.Sprintf("%d", item.QuestionID)
		}
		reportPath := sourcePath
		if reportPath == "" {
			reportPath = archivePath
		}
		detailKind := "archive"
		if kind == "local_directory" {
			detailKind = "directory"
		}
		removed = append(removed, ImportLocalSourceDetail{
			Name:    displayName,
			Kind:    detailKind,
			Path:    reportPath,
			Status:  "removed",
			Message: "本地文件已不存在，已自动移除题库条目",
		})
	}
	return removed, nil
}

func pathExists(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false
	}
	_, err := os.Stat(util.ExpandTilde(trimmed))
	return err == nil
}

func (s *GitService) collectLocalQuestionBankTrackedState(projectID string) (*localQuestionBankTrackedState, error) {
	tasks, err := s.store.ListTasks(&projectID)
	if err != nil {
		return nil, err
	}
	items, err := s.store.ListQuestionBankItems(projectID)
	if err != nil {
		return nil, err
	}

	state := &localQuestionBankTrackedState{
		paths:               make(map[string]struct{}),
		existingQuestionIDs: make(map[int64]store.QuestionBankItem),
	}

	for _, task := range tasks {
		if task.LocalPath != nil && strings.TrimSpace(*task.LocalPath) != "" {
			state.paths[util.NormalizePath(*task.LocalPath)] = struct{}{}
		}

		runs, err := s.store.ListModelRuns(task.ID)
		if err != nil {
			return nil, err
		}
		for _, run := range runs {
			if run.LocalPath == nil || strings.TrimSpace(*run.LocalPath) == "" {
				continue
			}
			state.paths[util.NormalizePath(*run.LocalPath)] = struct{}{}
		}
	}

	for _, item := range items {
		state.existingQuestionIDs[item.QuestionID] = item
		if strings.TrimSpace(item.SourcePath) != "" {
			state.paths[util.NormalizePath(item.SourcePath)] = struct{}{}
		}
		if item.ArchivePath != nil && strings.TrimSpace(*item.ArchivePath) != "" {
			state.paths[util.NormalizePath(*item.ArchivePath)] = struct{}{}
		}
	}

	return state, nil
}

func discoverLocalQuestionBankCandidates(
	basePath string,
	questionBankRoot string,
	trackedPaths map[string]struct{},
	modelNames []string,
) ([]localSourceCandidate, []ImportLocalSourceDetail, error) {
	entries, err := os.ReadDir(util.ExpandTilde(basePath))
	if err != nil {
		if os.IsNotExist(err) {
			return []localSourceCandidate{}, []ImportLocalSourceDetail{}, nil
		}
		return nil, nil, err
	}

	modelNameSet := make(map[string]struct{}, len(modelNames))
	for _, modelName := range modelNames {
		trimmed := strings.TrimSpace(modelName)
		if trimmed == "" {
			continue
		}
		modelNameSet[strings.ToLower(trimmed)] = struct{}{}
	}

	dirStemSet := make(map[string]struct{})
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if name == "" || strings.HasPrefix(name, ".") {
			continue
		}
		normalizedPath := util.NormalizePath(filepath.Join(basePath, name))
		if util.SamePath(normalizedPath, questionBankRoot) {
			continue
		}
		if _, tracked := trackedPaths[normalizedPath]; tracked {
			continue
		}
		if _, isModelDir := modelNameSet[strings.ToLower(name)]; isModelDir {
			continue
		}
		dirStemSet[strings.ToLower(name)] = struct{}{}
	}

	candidates := make([]localSourceCandidate, 0)
	skipped := make([]ImportLocalSourceDetail, 0)
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name())
		if name == "" || strings.HasPrefix(name, ".") {
			continue
		}
		normalizedPath := util.NormalizePath(filepath.Join(basePath, name))
		if util.SamePath(normalizedPath, questionBankRoot) {
			continue
		}
		if _, tracked := trackedPaths[normalizedPath]; tracked {
			continue
		}

		if entry.IsDir() {
			if _, isModelDir := modelNameSet[strings.ToLower(name)]; isModelDir {
				continue
			}
			displayName := strings.TrimSpace(name)
			candidates = append(candidates, localSourceCandidate{
				Name:             name,
				DisplayName:      displayName,
				Stem:             strings.ToLower(name),
				Path:             normalizedPath,
				Kind:             "directory",
				SyntheticProject: BuildQuestionBankLocalSyntheticProjectID(displayName),
			})
			continue
		}

		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".zip" && ext != ".7z" {
			continue
		}

		stem := strings.TrimSpace(strings.TrimSuffix(name, filepath.Ext(name)))
		if stem == "" {
			stem = name
		}
		if _, hasDirectory := dirStemSet[strings.ToLower(stem)]; hasDirectory {
			skipped = append(skipped, ImportLocalSourceDetail{
				Name:    name,
				Kind:    "archive",
				Path:    normalizedPath,
				Status:  "skipped",
				Message: "检测到同名已解压目录，按目录优先规则跳过压缩包",
			})
			continue
		}

		candidates = append(candidates, localSourceCandidate{
			Name:             name,
			DisplayName:      stem,
			Stem:             strings.ToLower(stem),
			Path:             normalizedPath,
			Kind:             "archive",
			SyntheticProject: BuildQuestionBankLocalSyntheticProjectID(stem),
		})
	}

	archivesDirCandidates, err := discoverUntrackedArchivesInQuestionBankRoot(questionBankRoot, trackedPaths)
	if err != nil {
		return nil, nil, err
	}
	candidates = append(candidates, archivesDirCandidates...)

	sort.SliceStable(candidates, func(i, j int) bool {
		leftName := strings.ToLower(candidates[i].Name)
		rightName := strings.ToLower(candidates[j].Name)
		if leftName != rightName {
			return leftName < rightName
		}
		return candidates[i].Kind < candidates[j].Kind
	})

	return candidates, skipped, nil
}

// discoverUntrackedArchivesInQuestionBankRoot scans question_bank/archives/ for
// any .zip/.7z files that aren't yet recorded in the question bank. This
// catches archives that the import flow copied into archives/ but failed to
// finalize (e.g. extraction error), as well as archives a user drops directly
// into the folder.
func discoverUntrackedArchivesInQuestionBankRoot(
	questionBankRoot string,
	trackedPaths map[string]struct{},
) ([]localSourceCandidate, error) {
	archivesDir := filepath.Join(questionBankRoot, util.QuestionBankArchivesFolderName)
	entries, err := os.ReadDir(util.ExpandTilde(archivesDir))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	result := make([]localSourceCandidate, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if name == "" || strings.HasPrefix(name, ".") {
			continue
		}
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".zip" && ext != ".7z" {
			continue
		}
		normalizedPath := util.NormalizePath(filepath.Join(archivesDir, name))
		if _, tracked := trackedPaths[normalizedPath]; tracked {
			continue
		}
		stem := strings.TrimSpace(strings.TrimSuffix(name, filepath.Ext(name)))
		if stem == "" {
			stem = name
		}
		displayName := stripArchivesManagedPrefix(stem)
		result = append(result, localSourceCandidate{
			Name:             name,
			DisplayName:      displayName,
			Stem:             strings.ToLower(stem),
			Path:             normalizedPath,
			Kind:             "archive",
			SyntheticProject: BuildQuestionBankLocalSyntheticProjectID(displayName),
		})
	}
	return result, nil
}

// stripArchivesManagedPrefix removes the "{SyntheticProject}-" prefix that
// scanLocalSourceCandidateToQuestionBank adds to finalized archive filenames,
// so re-scanning a leftover staging artifact recovers the original display
// name. Falls back to the raw stem when no prefix is present.
func stripArchivesManagedPrefix(stem string) string {
	idx := strings.Index(stem, "-")
	if idx <= 0 {
		return stem
	}
	head := stem[:idx]
	for _, r := range head {
		if r < '0' || r > '9' {
			return stem
		}
	}
	rest := strings.TrimSpace(stem[idx+1:])
	if rest == "" {
		return stem
	}
	return rest
}

func (s *GitService) scanLocalSourceCandidateToQuestionBank(
	project store.Project,
	candidate localSourceCandidate,
) (ImportLocalSourceDetail, store.QuestionBankItem, error) {
	finalSourcePath := util.NormalizePath(util.BuildQuestionBankSourcePath(project.CloneBasePath, candidate.SyntheticProject))
	stagingSourcePath := finalSourcePath + "._pinru_tmp"
	finalArchivePath := ""
	if candidate.Kind == "archive" {
		archiveBase := filepath.Base(candidate.Path)
		ext := filepath.Ext(archiveBase)
		stem := strings.TrimSuffix(archiveBase, ext)
		cleanedStem := stripArchivesManagedPrefix(stem)
		finalArchivePath = util.NormalizePath(filepath.Join(
			util.BuildQuestionBankArchivesPath(project.CloneBasePath),
			fmt.Sprintf("%d-%s%s", candidate.SyntheticProject, cleanedStem, ext),
		))
	}
	archiveStagingPath := ""
	directoryMoved := false
	archiveMoved := false
	finalized := false

	if managedDirectoryExists(finalSourcePath) {
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, fmt.Errorf(errs.FmtTargetDirExists, filepath.Base(finalSourcePath))
	}
	if candidate.Kind == "archive" && finalArchivePath != "" {
		if _, err := os.Stat(util.ExpandTilde(finalArchivePath)); err == nil {
			return ImportLocalSourceDetail{}, store.QuestionBankItem{}, fmt.Errorf(errs.FmtTargetDirExists, filepath.Base(finalArchivePath))
		}
	}

	if err := os.MkdirAll(filepath.Dir(util.ExpandTilde(stagingSourcePath)), 0o755); err != nil {
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
	}
	if err := os.RemoveAll(util.ExpandTilde(stagingSourcePath)); err != nil {
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
	}

	defer func() {
		if finalized {
			return
		}
		_ = os.RemoveAll(util.ExpandTilde(stagingSourcePath))
		_ = os.RemoveAll(util.ExpandTilde(finalSourcePath))
		if archiveStagingPath != "" {
			if _, err := os.Stat(util.ExpandTilde(archiveStagingPath)); err == nil {
				_ = os.Rename(util.ExpandTilde(archiveStagingPath), util.ExpandTilde(candidate.Path))
			}
		}
		if finalArchivePath != "" {
			if _, err := os.Stat(util.ExpandTilde(finalArchivePath)); err == nil {
				_ = os.Rename(util.ExpandTilde(finalArchivePath), util.ExpandTilde(candidate.Path))
			}
		}
		if directoryMoved {
			if _, err := os.Stat(util.ExpandTilde(stagingSourcePath)); err == nil {
				_ = os.Rename(util.ExpandTilde(stagingSourcePath), util.ExpandTilde(candidate.Path))
				return
			}
			if _, err := os.Stat(util.ExpandTilde(finalSourcePath)); err == nil {
				_ = os.Rename(util.ExpandTilde(finalSourcePath), util.ExpandTilde(candidate.Path))
			}
		}
	}()

	switch candidate.Kind {
	case "directory":
		if err := os.Rename(util.ExpandTilde(candidate.Path), util.ExpandTilde(stagingSourcePath)); err != nil {
			return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
		}
		directoryMoved = true
	case "archive":
		if err := os.MkdirAll(filepath.Dir(util.ExpandTilde(finalArchivePath)), 0o755); err != nil {
			return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
		}
		archiveStagingPath = finalArchivePath + "._pinru_tmp"
		if err := os.RemoveAll(util.ExpandTilde(archiveStagingPath)); err != nil {
			return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
		}
		if err := os.Rename(util.ExpandTilde(candidate.Path), util.ExpandTilde(archiveStagingPath)); err != nil {
			return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
		}
		archiveMoved = true
		if err := extractArchiveByExtension(archiveStagingPath, candidate.Path, stagingSourcePath); err != nil {
			return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
		}
	default:
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, fmt.Errorf("不支持的本地题源类型：%s", candidate.Kind)
	}

	if err := ensureLocalImportSourceReady(stagingSourcePath); err != nil {
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
	}
	if _, err := gitops.EnsureSnapshotRepository(context.Background(), stagingSourcePath, stagingSourcePath); err != nil {
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
	}
	if err := os.Rename(util.ExpandTilde(stagingSourcePath), util.ExpandTilde(finalSourcePath)); err != nil {
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
	}
	if archiveMoved {
		if err := os.Rename(util.ExpandTilde(archiveStagingPath), util.ExpandTilde(finalArchivePath)); err != nil {
			return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
		}
	}

	item := store.QuestionBankItem{
		ProjectConfigID: project.ID,
		QuestionID:      candidate.SyntheticProject,
		DisplayName:     candidate.DisplayName,
		SourceKind:      questionBankSourceKind(candidate.Kind),
		SourcePath:      finalSourcePath,
		OriginRef:       fmt.Sprintf("local:%s", strings.ToLower(candidate.DisplayName)),
		Status:          "ready",
	}
	if finalArchivePath != "" {
		archivePath := finalArchivePath
		item.ArchivePath = &archivePath
	}
	if err := s.store.UpsertQuestionBankItem(item); err != nil {
		return ImportLocalSourceDetail{}, store.QuestionBankItem{}, err
	}

	finalized = true
	message := "已迁移到 question_bank"
	if candidate.Kind == "archive" {
		message = "已归档压缩包并写入 question_bank"
	} else {
		message = "已迁移目录并写入 question_bank"
	}
	return ImportLocalSourceDetail{
		Name:    candidate.Name,
		Kind:    candidate.Kind,
		Path:    candidate.Path,
		Status:  "imported",
		Message: message,
	}, item, nil
}

func (s *GitService) syncGitLabQuestionBank(projectID string, questionIDs []int64, force bool) (*QuestionBankSyncResult, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, errors.New(errs.MsgProjectRequired)
	}
	project, err := s.store.GetProject(projectID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, fmt.Errorf(errs.FmtStoreProjectNotFound, projectID)
	}

	configuredIDs, err := parseConfiguredQuestionBankProjectIDs(project.QuestionBankProjectIDs)
	if err != nil {
		return nil, err
	}
	requestedSet := make(map[int64]struct{}, len(questionIDs))
	for _, id := range questionIDs {
		if id > 0 {
			requestedSet[id] = struct{}{}
		}
	}

	targetIDs := make([]int64, 0, len(configuredIDs))
	for _, id := range configuredIDs {
		if len(requestedSet) == 0 {
			targetIDs = append(targetIDs, id)
			continue
		}
		if _, ok := requestedSet[id]; ok {
			targetIDs = append(targetIDs, id)
		}
	}

	if len(requestedSet) > 0 && len(targetIDs) == 0 {
		return nil, errors.New(errs.MsgQuestionBankProjectIDsInvalid)
	}

	url, token, skipTLSVerify, err := s.resolveProjectGitLabArchiveCredentials(*project)
	if err != nil {
		return nil, err
	}
	existingItems, err := s.store.ListQuestionBankItems(project.ID)
	if err != nil {
		return nil, err
	}
	existingByID := make(map[int64]store.QuestionBankItem, len(existingItems))
	for _, item := range existingItems {
		existingByID[item.QuestionID] = item
	}

	result := &QuestionBankSyncResult{
		ProjectID:   project.ID,
		ProjectName: project.Name,
		Details:     make([]QuestionBankSyncDetail, 0, len(targetIDs)),
	}

	for _, questionID := range targetIDs {
		existing := existingByID[questionID]
		targetSourcePath := util.NormalizePath(util.BuildQuestionBankSourcePath(project.CloneBasePath, questionID))
		if !force && strings.TrimSpace(existing.SourceKind) == "gitlab" && managedDirectoryExists(existing.SourcePath) {
			result.Details = append(result.Details, QuestionBankSyncDetail{
				QuestionID:  questionID,
				DisplayName: firstNonEmpty(existing.DisplayName, fmt.Sprintf("%d", questionID)),
				Status:      "skipped",
				Message:     "题库源码已存在，跳过同步",
			})
			result.SkippedCount++
			continue
		}

		displayName := fmt.Sprintf("%d", questionID)
		projectInfo, fetchErr := gl.FetchProject(strconv.FormatInt(questionID, 10), url, token, skipTLSVerify)
		if fetchErr == nil && projectInfo != nil && strings.TrimSpace(projectInfo.Name) != "" {
			displayName = strings.TrimSpace(projectInfo.Name)
		}

		if fetchErr != nil {
			if existing.QuestionID == 0 {
				sourcePath := targetSourcePath
				errorMessage := fetchErr.Error()
				_ = s.store.UpsertQuestionBankItem(store.QuestionBankItem{
					ProjectConfigID: project.ID,
					QuestionID:      questionID,
					DisplayName:     displayName,
					SourceKind:      "gitlab",
					SourcePath:      sourcePath,
					OriginRef:       strconv.FormatInt(questionID, 10),
					Status:          "error",
					ErrorMessage:    &errorMessage,
				})
			}
			result.Details = append(result.Details, QuestionBankSyncDetail{
				QuestionID:  questionID,
				DisplayName: displayName,
				Status:      "error",
				Message:     fetchErr.Error(),
			})
			result.ErrorCount++
			continue
		}

		syncErr := s.syncSingleGitLabQuestionBankItem(*project, questionID, displayName, url, token, skipTLSVerify)
		if syncErr != nil {
			result.Details = append(result.Details, QuestionBankSyncDetail{
				QuestionID:  questionID,
				DisplayName: displayName,
				Status:      "error",
				Message:     syncErr.Error(),
			})
			result.ErrorCount++
			continue
		}

		result.Details = append(result.Details, QuestionBankSyncDetail{
			QuestionID:  questionID,
			DisplayName: displayName,
			Status:      "synced",
			Message:     "已同步到 question_bank",
		})
		result.SyncedCount++
	}

	return result, nil
}

func (s *GitService) syncSingleGitLabQuestionBankItem(
	project store.Project,
	questionID int64,
	displayName,
	url,
	token string,
	skipTLSVerify bool,
) error {
	finalSourcePath := util.NormalizePath(util.BuildQuestionBankSourcePath(project.CloneBasePath, questionID))
	stagingSourcePath := finalSourcePath + "._pinru_tmp"
	if err := os.RemoveAll(util.ExpandTilde(stagingSourcePath)); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(util.ExpandTilde(stagingSourcePath)), 0o755); err != nil {
		return err
	}

	if err := gl.DownloadArchive(questionID, url, token, stagingSourcePath, nil, skipTLSVerify); err != nil {
		errorMessage := err.Error()
		_ = s.store.UpsertQuestionBankItem(store.QuestionBankItem{
			ProjectConfigID: project.ID,
			QuestionID:      questionID,
			DisplayName:     displayName,
			SourceKind:      "gitlab",
			SourcePath:      finalSourcePath,
			OriginRef:       strconv.FormatInt(questionID, 10),
			Status:          "error",
			ErrorMessage:    &errorMessage,
		})
		return fmt.Errorf(errs.FmtQuestionBankSyncFail, err)
	}
	defer os.RemoveAll(util.ExpandTilde(stagingSourcePath))

	if err := ensureLocalImportSourceReady(stagingSourcePath); err != nil {
		return err
	}
	if _, err := gitops.EnsureSnapshotRepository(context.Background(), stagingSourcePath, stagingSourcePath); err != nil {
		return err
	}
	if err := replaceManagedDirectory(stagingSourcePath, finalSourcePath); err != nil {
		return err
	}

	return s.store.UpsertQuestionBankItem(store.QuestionBankItem{
		ProjectConfigID: project.ID,
		QuestionID:      questionID,
		DisplayName:     displayName,
		SourceKind:      "gitlab",
		SourcePath:      finalSourcePath,
		OriginRef:       strconv.FormatInt(questionID, 10),
		Status:          "ready",
		ErrorMessage:    nil,
	})
}

func replaceManagedDirectory(stagingPath, finalPath string) error {
	if util.SamePath(stagingPath, finalPath) {
		return nil
	}

	backupPath := finalPath + "._pinru_prev"
	if err := os.RemoveAll(util.ExpandTilde(backupPath)); err != nil {
		return err
	}

	finalExists := managedDirectoryExists(finalPath)
	if finalExists {
		if err := os.Rename(util.ExpandTilde(finalPath), util.ExpandTilde(backupPath)); err != nil {
			return err
		}
	}
	if err := os.Rename(util.ExpandTilde(stagingPath), util.ExpandTilde(finalPath)); err != nil {
		if finalExists {
			_ = os.Rename(util.ExpandTilde(backupPath), util.ExpandTilde(finalPath))
		}
		return err
	}
	if finalExists {
		if err := os.RemoveAll(util.ExpandTilde(backupPath)); err != nil {
			return err
		}
	}
	return nil
}

func questionBankSourceKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "archive":
		return "local_archive"
	case "directory":
		return "local_directory"
	default:
		return strings.TrimSpace(kind)
	}
}

func extractArchiveByExtension(archivePath, originalPath, destination string) error {
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(originalPath))) {
	case ".zip":
		return extractZipArchive(archivePath, destination)
	case ".7z":
		return extractSevenZipArchive(archivePath, destination)
	default:
		return fmt.Errorf("不支持的压缩包格式：%s", originalPath)
	}
}

func parseConfiguredQuestionBankProjectIDs(raw string) ([]int64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "[]" {
		return []int64{}, nil
	}

	var numeric []int64
	if err := json.Unmarshal([]byte(trimmed), &numeric); err == nil {
		ids := make([]int64, 0, len(numeric))
		seen := make(map[int64]struct{}, len(numeric))
		for _, id := range numeric {
			if id <= 0 {
				continue
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		return ids, nil
	}

	var stringsRaw []string
	if err := json.Unmarshal([]byte(trimmed), &stringsRaw); err == nil {
		ids := make([]int64, 0, len(stringsRaw))
		seen := make(map[int64]struct{}, len(stringsRaw))
		for _, rawID := range stringsRaw {
			value := strings.TrimSpace(rawID)
			if value == "" {
				continue
			}
			id, err := strconv.ParseInt(value, 10, 64)
			if err != nil || id <= 0 {
				return nil, fmt.Errorf(errs.FmtQuestionBankProjectIDInvalid, value)
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		return ids, nil
	}

	return nil, errors.New(errs.MsgQuestionBankProjectIDsInvalid)
}

func (s *GitService) resolveProjectGitLabArchiveCredentials(project store.Project) (url, token string, skipTLSVerify bool, err error) {
	url = strings.TrimSpace(project.GitLabURL)
	token = strings.TrimSpace(project.GitLabToken)
	if url == "" || token == "" {
		configuredURL, _, configuredToken, configuredSkipTLSVerify, loadErr := s.loadConfiguredGitLabCredentials()
		if loadErr != nil {
			return "", "", false, loadErr
		}
		if url == "" {
			url = configuredURL
		}
		if token == "" {
			token = configuredToken
		}
		skipTLSVerify = configuredSkipTLSVerify
	}
	if url == "" || token == "" {
		return "", "", false, errors.New(errs.MsgGitLabSettingsMissing)
	}
	return url, token, skipTLSVerify, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
