package git

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	iofs "io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/gitops"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	"github.com/bodgit/sevenzip"
	"github.com/google/uuid"
)

const (
	localImportDefaultTaskType       = "未归类"
	localImportSourceModel           = "ORIGIN"
	localImportIDOffset        int64 = 8_000_000_000_000_000
	localImportIDRange         int64 = 1_000_000_000_000_000
)

var localImportIdentityTokenPattern = regexp.MustCompile(`[^a-zA-Z0-9]+`)

func IsLocalSyntheticProjectID(projectID int64) bool {
	return projectID >= localImportIDOffset && projectID < localImportIDOffset+localImportIDRange
}

func BuildQuestionBankLocalSyntheticProjectID(displayName string) int64 {
	return buildLocalImportSyntheticProjectID("local:" + strings.ToLower(strings.TrimSpace(displayName)))
}

func BuildLegacyDirectorySyntheticProjectID(displayName string) int64 {
	return buildLocalImportSyntheticProjectID("dir:" + strings.ToLower(strings.TrimSpace(displayName)))
}

func BuildLegacyArchiveSyntheticProjectID(displayName string) int64 {
	return buildLocalImportSyntheticProjectID("archive:" + strings.ToLower(strings.TrimSpace(displayName)))
}

type ImportLocalSourceDetail struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Path    string `json:"path"`
	Status  string `json:"status"`
	Message string `json:"message"`
	TaskID  string `json:"taskId,omitempty"`
}

type ImportLocalSourcesResult struct {
	ProjectID     string                    `json:"projectId"`
	ProjectName   string                    `json:"projectName"`
	ImportedCount int                       `json:"importedCount"`
	SkippedCount  int                       `json:"skippedCount"`
	ErrorCount    int                       `json:"errorCount"`
	RemovedCount  int                       `json:"removedCount"`
	Details       []ImportLocalSourceDetail `json:"details"`
}

type localSourceCandidate struct {
	Name             string
	DisplayName      string
	Stem             string
	Path             string
	Kind             string
	SyntheticProject int64
}

type localTrackedState struct {
	paths           map[string]struct{}
	existingTaskIDs map[int64]string
}

func (s *GitService) legacyImportLocalSources(projectID string) (*ImportLocalSourcesResult, error) {
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

	trackedState, err := s.collectLocalImportTrackedState(project.ID)
	if err != nil {
		return nil, err
	}

	models := parseLocalImportModels(project.Models, project.SourceModelFolder)
	sourceModelName := resolveLocalImportSourceModel(project.SourceModelFolder)
	candidates, skippedDetails, err := discoverLocalSourceCandidates(basePath, trackedState.paths, models)
	if err != nil {
		return nil, err
	}

	result := &ImportLocalSourcesResult{
		ProjectID:   project.ID,
		ProjectName: project.Name,
		Details:     make([]ImportLocalSourceDetail, 0, len(candidates)+len(skippedDetails)),
	}
	result.Details = append(result.Details, skippedDetails...)
	result.SkippedCount += len(skippedDetails)

	for _, candidate := range candidates {
		if existingTaskID, ok := trackedState.existingTaskIDs[candidate.SyntheticProject]; ok {
			result.Details = append(result.Details, ImportLocalSourceDetail{
				Name:    candidate.Name,
				Kind:    candidate.Kind,
				Path:    candidate.Path,
				Status:  "skipped",
				Message: fmt.Sprintf("已存在题卡 %s，跳过重复接管", existingTaskID),
				TaskID:  existingTaskID,
			})
			result.SkippedCount++
			continue
		}

		detail, taskID, importErr := s.importLocalSourceCandidate(*project, candidate, models, sourceModelName)
		if importErr != nil {
			result.Details = append(result.Details, ImportLocalSourceDetail{
				Name:    candidate.Name,
				Kind:    candidate.Kind,
				Path:    candidate.Path,
				Status:  "error",
				Message: importErr.Error(),
			})
			result.ErrorCount++
			continue
		}

		trackedState.existingTaskIDs[candidate.SyntheticProject] = taskID
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

func (s *GitService) importLocalSourceCandidate(
	project store.Project,
	candidate localSourceCandidate,
	models []string,
	sourceModelName string,
) (ImportLocalSourceDetail, string, error) {
	plans, err := s.PlanManagedClaimPaths(
		project.CloneBasePath,
		candidate.DisplayName,
		candidate.SyntheticProject,
		localImportDefaultTaskType,
		1,
		project.ID,
	)
	if err != nil {
		return ImportLocalSourceDetail{}, "", err
	}
	if len(plans) == 0 {
		return ImportLocalSourceDetail{}, "", errors.New("未生成可用的接管路径")
	}

	plan := plans[0]
	finalTaskPath := util.NormalizePath(plan.TaskPath)
	finalSourcePath := util.NormalizePath(plan.SourcePath)
	stagingTaskPath := finalTaskPath + "._pinru_tmp"
	stagingSourcePath := filepath.Join(stagingTaskPath, filepath.Base(finalSourcePath))

	if managedDirectoryExists(finalTaskPath) {
		return ImportLocalSourceDetail{}, "", fmt.Errorf(errs.FmtTargetDirExists, filepath.Base(finalTaskPath))
	}

	if err := os.RemoveAll(util.ExpandTilde(stagingTaskPath)); err != nil {
		return ImportLocalSourceDetail{}, "", err
	}
	if err := os.MkdirAll(util.ExpandTilde(stagingTaskPath), 0o755); err != nil {
		return ImportLocalSourceDetail{}, "", err
	}

	finalized := false
	defer func() {
		if !finalized {
			_ = os.RemoveAll(util.ExpandTilde(stagingTaskPath))
			_ = os.RemoveAll(util.ExpandTilde(finalTaskPath))
		}
	}()

	switch candidate.Kind {
	case "directory":
		if err := gitops.CopyProjectDirectory(context.Background(), candidate.Path, stagingSourcePath); err != nil {
			return ImportLocalSourceDetail{}, "", err
		}
	case "archive":
		if err := extractLocalSourceArchive(candidate.Path, stagingSourcePath); err != nil {
			return ImportLocalSourceDetail{}, "", err
		}
	default:
		return ImportLocalSourceDetail{}, "", fmt.Errorf("不支持的本地题源类型：%s", candidate.Kind)
	}

	if err := ensureLocalImportSourceReady(stagingSourcePath); err != nil {
		return ImportLocalSourceDetail{}, "", err
	}
	if _, err := gitops.EnsureSnapshotRepository(context.Background(), stagingSourcePath, stagingSourcePath); err != nil {
		return ImportLocalSourceDetail{}, "", fmt.Errorf(errs.FmtSourceBaseFail, err)
	}

	for _, modelName := range models {
		if strings.EqualFold(strings.TrimSpace(modelName), sourceModelName) {
			continue
		}
		modelPath := filepath.Join(stagingTaskPath, strings.TrimSpace(modelName))
		if err := gitops.CopyProjectDirectory(context.Background(), stagingSourcePath, modelPath); err != nil {
			return ImportLocalSourceDetail{}, "", err
		}
	}

	if err := os.Rename(util.ExpandTilde(stagingTaskPath), util.ExpandTilde(finalTaskPath)); err != nil {
		return ImportLocalSourceDetail{}, "", fmt.Errorf(errs.FmtMoveCloneDirFail, err)
	}

	taskID := buildLocalImportTaskID(project.ID, candidate.SyntheticProject, plan.Sequence)
	taskLocalPath := finalTaskPath
	projectID := project.ID
	task := store.Task{
		ID:              taskID,
		GitLabProjectID: candidate.SyntheticProject,
		ProjectName:     candidate.DisplayName,
		TaskType:        localImportDefaultTaskType,
		LocalPath:       &taskLocalPath,
		ProjectConfigID: &projectID,
	}
	modelRuns := buildLocalImportModelRuns(taskID, finalTaskPath, finalSourcePath, models, sourceModelName)

	if err := s.store.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		return ImportLocalSourceDetail{}, "", err
	}
	finalized = true

	message := "已完成本地题源接管"
	if candidate.Kind == "archive" {
		message = "已解压并接管本地压缩包"
	} else {
		message = "已迁移并接管本地目录"
		if err := os.RemoveAll(util.ExpandTilde(candidate.Path)); err != nil && !os.IsNotExist(err) {
			message = fmt.Sprintf("%s；原目录清理失败，请手动删除：%v", message, err)
		}
	}

	return ImportLocalSourceDetail{
		Name:    candidate.Name,
		Kind:    candidate.Kind,
		Path:    candidate.Path,
		Status:  "imported",
		Message: message,
		TaskID:  taskID,
	}, taskID, nil
}

func (s *GitService) collectLocalImportTrackedState(projectID string) (*localTrackedState, error) {
	tasks, err := s.store.ListTasks(&projectID)
	if err != nil {
		return nil, err
	}

	state := &localTrackedState{
		paths:           make(map[string]struct{}),
		existingTaskIDs: make(map[int64]string),
	}

	for _, task := range tasks {
		if task.LocalPath != nil && strings.TrimSpace(*task.LocalPath) != "" {
			state.paths[util.NormalizePath(*task.LocalPath)] = struct{}{}
		}
		state.existingTaskIDs[task.GitLabProjectID] = task.ID

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

	return state, nil
}

func discoverLocalSourceCandidates(
	basePath string,
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
		if name == "" {
			continue
		}
		normalizedPath := util.NormalizePath(filepath.Join(basePath, name))

		if strings.HasPrefix(name, ".") {
			continue
		}

		if entry.IsDir() {
			if _, tracked := trackedPaths[normalizedPath]; tracked {
				continue
			}
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
				SyntheticProject: buildLocalImportSyntheticProjectID("dir:" + strings.ToLower(displayName)),
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
			SyntheticProject: buildLocalImportSyntheticProjectID("archive:" + strings.ToLower(name)),
		})
	}

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

func entryKindLabel(entry os.DirEntry) string {
	if entry.IsDir() {
		return "directory"
	}
	return "file"
}

func parseLocalImportModels(rawModels, sourceModelFolder string) []string {
	sourceModelName := resolveLocalImportSourceModel(sourceModelFolder)
	seen := map[string]struct{}{
		strings.ToLower(sourceModelName): {},
	}
	models := []string{sourceModelName}

	normalized := strings.NewReplacer("\r\n", "\n", "\r", "\n", ",", "\n").Replace(rawModels)
	for _, segment := range strings.Split(normalized, "\n") {
		modelName := strings.TrimSpace(segment)
		if modelName == "" {
			continue
		}
		key := strings.ToLower(modelName)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		models = append(models, modelName)
	}

	return models
}

func resolveLocalImportSourceModel(sourceModelFolder string) string {
	sourceModelName := strings.TrimSpace(sourceModelFolder)
	if sourceModelName == "" {
		return localImportSourceModel
	}
	return sourceModelName
}

func buildLocalImportSyntheticProjectID(identity string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(strings.ToLower(strings.TrimSpace(identity))))
	return localImportIDOffset + int64(h.Sum64()%uint64(localImportIDRange))
}

func buildLocalImportTaskID(projectConfigID string, projectID int64, claimSequence int) string {
	claimID := fmt.Sprintf("label-%05d", projectID)
	if claimSequence > 0 {
		claimID = fmt.Sprintf("%s-%d", claimID, claimSequence)
	}

	token := normalizeLocalImportTaskIdentityToken(projectConfigID)
	if token == "" {
		return claimID
	}
	return fmt.Sprintf("p%s__%s", token, claimID)
}

func normalizeLocalImportTaskIdentityToken(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	trimmed = strings.TrimPrefix(trimmed, "project-")
	normalized := localImportIdentityTokenPattern.ReplaceAllString(trimmed, "-")
	return strings.Trim(normalized, "-")
}

func buildLocalImportModelRuns(
	taskID,
	taskPath,
	sourcePath string,
	models []string,
	sourceModelName string,
) []store.ModelRun {
	runs := make([]store.ModelRun, 0, len(models))
	for _, modelName := range models {
		trimmedModelName := strings.TrimSpace(modelName)
		if trimmedModelName == "" {
			continue
		}

		localPath := sourcePath
		if !strings.EqualFold(trimmedModelName, sourceModelName) {
			localPath = filepath.Join(taskPath, trimmedModelName)
		}
		pathValue := localPath
		runs = append(runs, store.ModelRun{
			ID:        uuid.New().String(),
			TaskID:    taskID,
			ModelName: trimmedModelName,
			LocalPath: &pathValue,
		})
	}
	return runs
}

func extractLocalSourceArchive(archivePath, destination string) error {
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(archivePath))) {
	case ".zip":
		return extractZipArchive(archivePath, destination)
	case ".7z":
		return extractSevenZipArchive(archivePath, destination)
	default:
		return fmt.Errorf("不支持的压缩包格式：%s", archivePath)
	}
}

func extractZipArchive(archivePath, destination string) error {
	reader, err := zip.OpenReader(util.ExpandTilde(archivePath))
	if err != nil {
		return err
	}
	defer reader.Close()

	if err := os.MkdirAll(util.ExpandTilde(destination), 0o755); err != nil {
		return err
	}

	writtenCount := 0
	for _, file := range reader.File {
		ignore, targetPath, err := resolveArchiveEntryPath(destination, file.Name)
		if err != nil {
			return err
		}
		if ignore {
			continue
		}

		mode := file.Mode()
		switch {
		case mode.IsDir():
			if err := os.MkdirAll(util.ExpandTilde(targetPath), 0o755); err != nil {
				return err
			}
			continue
		case mode&iofs.ModeSymlink != 0:
			continue
		case !mode.IsRegular():
			continue
		}

		rc, err := file.Open()
		if err != nil {
			return err
		}
		if err := writeArchiveEntry(rc, targetPath, file.Mode().Perm()); err != nil {
			_ = rc.Close()
			return err
		}
		if err := rc.Close(); err != nil {
			return err
		}
		writtenCount++
	}

	if writtenCount == 0 {
		return errors.New("压缩包为空，未发现可导入内容")
	}
	return flattenSingleArchiveWrapperDirectory(destination)
}

func extractSevenZipArchive(archivePath, destination string) error {
	reader, err := sevenzip.OpenReader(util.ExpandTilde(archivePath))
	if err != nil {
		return err
	}
	defer reader.Close()

	if err := os.MkdirAll(util.ExpandTilde(destination), 0o755); err != nil {
		return err
	}

	writtenCount := 0
	for _, file := range reader.File {
		ignore, targetPath, err := resolveArchiveEntryPath(destination, file.Name)
		if err != nil {
			return err
		}
		if ignore {
			continue
		}

		mode := file.Mode()
		switch {
		case mode.IsDir():
			if err := os.MkdirAll(util.ExpandTilde(targetPath), 0o755); err != nil {
				return err
			}
			continue
		case mode&iofs.ModeSymlink != 0:
			continue
		case !mode.IsRegular():
			continue
		}

		rc, err := file.Open()
		if err != nil {
			return err
		}
		if err := writeArchiveEntry(rc, targetPath, mode.Perm()); err != nil {
			_ = rc.Close()
			return err
		}
		if err := rc.Close(); err != nil {
			return err
		}
		writtenCount++
	}

	if writtenCount == 0 {
		return errors.New("压缩包为空，未发现可导入内容")
	}
	return flattenSingleArchiveWrapperDirectory(destination)
}

func resolveArchiveEntryPath(basePath, entryName string) (bool, string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(entryName), "\\", "/")
	if normalized == "" {
		return true, "", nil
	}
	cleaned := path.Clean(normalized)
	if cleaned == "." {
		return true, "", nil
	}
	if shouldIgnoreArchiveEntry(cleaned) {
		return true, "", nil
	}
	if path.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return false, "", fmt.Errorf("压缩包存在非法路径：%s", entryName)
	}

	targetPath := util.NormalizePath(filepath.Join(basePath, filepath.FromSlash(cleaned)))
	if !util.IsWithinBasePath(basePath, targetPath) {
		return false, "", fmt.Errorf("压缩包存在路径穿越：%s", entryName)
	}
	return false, targetPath, nil
}

func shouldIgnoreArchiveEntry(name string) bool {
	segments := strings.Split(name, "/")
	for _, segment := range segments {
		if segment == "__MACOSX" {
			return true
		}
	}
	return path.Base(name) == ".DS_Store"
}

func writeArchiveEntry(reader io.Reader, targetPath string, perm iofs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(util.ExpandTilde(targetPath)), 0o755); err != nil {
		return err
	}
	if perm == 0 {
		perm = 0o644
	}

	file, err := os.OpenFile(util.ExpandTilde(targetPath), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, perm)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := io.Copy(file, reader); err != nil {
		return err
	}
	return nil
}

func flattenSingleArchiveWrapperDirectory(destination string) error {
	entries, err := os.ReadDir(util.ExpandTilde(destination))
	if err != nil {
		return err
	}

	visibleEntries := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if shouldIgnoreArchiveEntry(entry.Name()) {
			continue
		}
		visibleEntries = append(visibleEntries, entry)
	}

	if len(visibleEntries) != 1 || !visibleEntries[0].IsDir() {
		return nil
	}

	wrapperPath := filepath.Join(util.ExpandTilde(destination), visibleEntries[0].Name())
	children, err := os.ReadDir(wrapperPath)
	if err != nil {
		return err
	}
	for _, child := range children {
		sourcePath := filepath.Join(wrapperPath, child.Name())
		targetPath := filepath.Join(util.ExpandTilde(destination), child.Name())
		if _, err := os.Stat(targetPath); err == nil {
			return fmt.Errorf(errs.FmtTargetDirExists, child.Name())
		} else if !os.IsNotExist(err) {
			return err
		}
		if err := os.Rename(sourcePath, targetPath); err != nil {
			return err
		}
	}
	return os.RemoveAll(wrapperPath)
}

func ensureLocalImportSourceReady(sourcePath string) error {
	info, err := os.Stat(util.ExpandTilde(sourcePath))
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf(errs.FmtSourceDirNotExist, sourcePath)
		}
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf(errs.FmtTargetPathNotDir, sourcePath)
	}

	entries, err := os.ReadDir(util.ExpandTilde(sourcePath))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if shouldIgnoreArchiveEntry(entry.Name()) {
			continue
		}
		return nil
	}

	return errors.New("题源目录为空，未发现可接管内容")
}
