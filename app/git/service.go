package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	appprompt "github.com/blueship581/pinru/app/prompt"
	"github.com/blueship581/pinru/internal/errs"
	gl "github.com/blueship581/pinru/internal/gitlab"
	"github.com/blueship581/pinru/internal/gitops"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Service wraps git and GitLab operations.
type GitService struct {
	store *store.Store
}

// NewService creates a new git service.
func New(store *store.Store) *GitService {
	return &GitService{store: store}
}

// GitLabProjectLookupResult bundles a project reference with its resolved data or error.
type GitLabProjectLookupResult struct {
	ProjectRef string      `json:"projectRef"`
	Project    *gl.Project `json:"project"`
	Error      *string     `json:"error"`
}

// NormalizeManagedSourceFolderDetail describes the outcome for a single task.
type NormalizeManagedSourceFolderDetail struct {
	TaskID              string `json:"taskId"`
	ProjectName         string `json:"projectName"`
	SourceModelName     string `json:"sourceModelName"`
	PreviousPath        string `json:"previousPath"`
	CurrentPath         string `json:"currentPath"`
	GitInitializedCount int    `json:"gitInitializedCount"`
	Status              string `json:"status"`
	Message             string `json:"message"`
}

// NormalizeManagedSourceFoldersResult summarises a bulk normalisation run.
type NormalizeManagedSourceFoldersResult struct {
	ProjectID           string                               `json:"projectId"`
	ProjectName         string                               `json:"projectName"`
	TotalTasks          int                                  `json:"totalTasks"`
	RenamedCount        int                                  `json:"renamedCount"`
	UpdatedCount        int                                  `json:"updatedCount"`
	SkippedCount        int                                  `json:"skippedCount"`
	ErrorCount          int                                  `json:"errorCount"`
	GitInitializedCount int                                  `json:"gitInitializedCount"`
	Details             []NormalizeManagedSourceFolderDetail `json:"details"`
}

// DirectoryInspectionResult describes what was found at a given path.
type DirectoryInspectionResult struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Exists  bool   `json:"exists"`
	IsDir   bool   `json:"isDir"`
	IsEmpty bool   `json:"isEmpty"`
}

type ManagedClaimPathPlan struct {
	Sequence   int    `json:"sequence"`
	TaskPath   string `json:"taskPath"`
	SourcePath string `json:"sourcePath"`
}

func (s *GitService) FetchGitLabProject(projectRef, url, token string) (*gl.Project, error) {
	return gl.FetchProject(projectRef, url, token, false)
}

func (s *GitService) FetchGitLabProjects(projectRefs []string, url, token string) []GitLabProjectLookupResult {
	return s.fetchGitLabProjects(projectRefs, url, token, false)
}

func (s *GitService) fetchGitLabProjects(projectRefs []string, url, token string, skipTLSVerify bool) []GitLabProjectLookupResult {
	results := make([]GitLabProjectLookupResult, len(projectRefs))
	sem := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for i, ref := range projectRefs {
		wg.Add(1)
		go func(idx int, r string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			p, err := gl.FetchProject(r, url, token, skipTLSVerify)
			result := GitLabProjectLookupResult{ProjectRef: r, Project: p}
			if err != nil {
				errStr := err.Error()
				result.Error = &errStr
			}
			results[idx] = result
		}(i, ref)
	}
	wg.Wait()
	return results
}

func (s *GitService) FetchConfiguredGitLabProjects(projectRefs []string) ([]GitLabProjectLookupResult, error) {
	url, _, token, skipTLSVerify, err := s.loadConfiguredGitLabCredentials()
	if err != nil {
		return nil, err
	}
	return s.fetchGitLabProjects(projectRefs, url, token, skipTLSVerify), nil
}

func (s *GitService) cloneProjectWithProgress(
	ctx context.Context,
	cloneURL,
	path,
	username,
	token string,
	skipTLSVerify bool,
	onProgress func(string),
) error {
	progress := onProgress
	if progress == nil {
		progress = func(string) {}
	}
	return gitops.CloneWithProgress(ctx, cloneURL, path, username, token, skipTLSVerify, progress)
}

func (s *GitService) CloneProject(cloneURL, path, username, token string) error {
	app := application.Get()
	return s.cloneProjectWithProgress(context.Background(), cloneURL, path, username, token, false, func(msg string) {
		app.Event.Emit("clone-progress", msg)
	})
}

func (s *GitService) CloneProjectWithProgress(
	cloneURL,
	path,
	username,
	token string,
	onProgress func(string),
) error {
	return s.cloneProjectWithProgress(context.Background(), cloneURL, path, username, token, false, onProgress)
}

func (s *GitService) CloneConfiguredProject(cloneURL, path string) error {
	return s.CloneConfiguredProjectWithProgress(cloneURL, path, nil)
}

func (s *GitService) CloneConfiguredProjectWithProgress(
	cloneURL,
	path string,
	onProgress func(string),
) error {
	return s.CloneConfiguredProjectWithContext(context.Background(), cloneURL, path, onProgress)
}

func (s *GitService) CloneConfiguredProjectWithContext(
	ctx context.Context,
	cloneURL,
	path string,
	onProgress func(string),
) error {
	_, username, token, skipTLSVerify, err := s.loadConfiguredGitLabCredentials()
	if err != nil {
		return err
	}
	return s.cloneProjectWithProgress(ctx, cloneURL, path, username, token, skipTLSVerify, onProgress)
}

func (s *GitService) DownloadGitLabProject(projectID int64, url, token, destination string, sha *string) error {
	return gl.DownloadArchive(projectID, url, token, destination, sha, false)
}

func (s *GitService) CopyProjectDirectory(ctx context.Context, sourcePath, destinationPath string) error {
	return gitops.CopyProjectDirectory(ctx, sourcePath, destinationPath)
}

func (s *GitService) CheckPathsExist(paths []string) []string {
	return gitops.CheckPathsExist(paths)
}

// sanitizeInspectPath 清洗用户/系统传入的目录路径：
// - 去除前后空白字符（含零宽空格）
// - 去除从 Windows 资源管理器"复制路径"或控制台粘贴时带的成对双引号/单引号
// - 去除末尾多余的路径分隔符，避免 filepath.Base 在 Windows 上返回空串导致项目名为空
func sanitizeInspectPath(raw string) string {
	trimmed := strings.TrimSpace(raw)
	// 去除前后可能存在的成对引号，例如 "C:\Users\Foo" 或 'C:\Users\Foo'
	if len(trimmed) >= 2 {
		first, last := trimmed[0], trimmed[len(trimmed)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			trimmed = strings.TrimSpace(trimmed[1 : len(trimmed)-1])
		}
	}
	// 统一去掉末尾多余的 / 和 \ （保留 Windows 盘符根如 C:\ 由 filepath.Clean 处理）
	for len(trimmed) > 3 && (strings.HasSuffix(trimmed, "/") || strings.HasSuffix(trimmed, "\\")) {
		trimmed = trimmed[:len(trimmed)-1]
	}
	return trimmed
}

func (s *GitService) InspectDirectory(path string) (*DirectoryInspectionResult, error) {
	trimmed := sanitizeInspectPath(path)
	if trimmed == "" {
		return nil, errors.New(errs.MsgDirRequired)
	}

	expanded := filepath.Clean(util.ExpandTilde(trimmed))
	result := &DirectoryInspectionResult{
		Path: expanded,
		Name: filepath.Base(expanded),
	}

	info, err := os.Stat(expanded)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return nil, err
	}

	result.Exists = true
	result.IsDir = info.IsDir()
	if !info.IsDir() {
		return result, nil
	}

	entries, err := os.ReadDir(expanded)
	if err != nil {
		return nil, err
	}
	result.IsEmpty = len(entries) == 0
	return result, nil
}

func (s *GitService) PlanManagedClaimPaths(
	basePath,
	projectName string,
	projectID int64,
	taskType string,
	count int,
	projectConfigID string,
) ([]ManagedClaimPathPlan, error) {
	trimmedBasePath := strings.TrimSpace(basePath)
	if trimmedBasePath == "" {
		return nil, errors.New(errs.MsgRootDirRequired)
	}
	if count <= 0 {
		return nil, errors.New(errs.MsgSetCountInvalid)
	}

	normalizedBasePath := filepath.Clean(util.ExpandTilde(trimmedBasePath))
	projectFolderPrefix := util.NormalizeManagedProjectFolderName(projectName)

	folderSequences, err := collectManagedFolderGlobalSequenceSet(normalizedBasePath, projectFolderPrefix)
	if err != nil {
		return nil, err
	}

	taskSequences, err := s.collectManagedTaskSequenceSet(projectConfigID, projectID, taskType)
	if err != nil {
		return nil, err
	}

	usedSequences := make(map[int]struct{}, len(folderSequences)+len(taskSequences))
	for seq := range folderSequences {
		usedSequences[seq] = struct{}{}
	}
	for seq := range taskSequences {
		usedSequences[seq] = struct{}{}
	}

	sequences := resolveManagedClaimSequences(usedSequences, count)

	plans := make([]ManagedClaimPathPlan, 0, count)
	for _, sequence := range sequences {
		taskPath := util.BuildManagedTaskFolderPathWithSequence(normalizedBasePath, projectName, taskType, sequence)
		sourcePath := util.BuildManagedSourceFolderPathWithSequence(taskPath, projectID, taskType, sequence)
		plans = append(plans, ManagedClaimPathPlan{
			Sequence:   sequence,
			TaskPath:   taskPath,
			SourcePath: sourcePath,
		})
	}

	return plans, nil
}

func (s *GitService) NormalizeManagedSourceFolders(projectID string) (*NormalizeManagedSourceFoldersResult, error) {
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

	tasks, err := s.store.ListTasks(&projectID)
	if err != nil {
		return nil, err
	}

	sourceModelName := strings.TrimSpace(project.SourceModelFolder)
	if sourceModelName == "" {
		sourceModelName = "ORIGIN"
	}

	result := &NormalizeManagedSourceFoldersResult{
		ProjectID:   project.ID,
		ProjectName: project.Name,
		TotalTasks:  len(tasks),
		Details:     make([]NormalizeManagedSourceFolderDetail, 0, len(tasks)),
	}

	for _, task := range tasks {
		detail := NormalizeManagedSourceFolderDetail{
			TaskID:      task.ID,
			ProjectName: task.ProjectName,
		}

		if err := s.normalizeManagedSourceFolder(task, sourceModelName, &detail); err != nil {
			detail.Status = "error"
			detail.Message = err.Error()
		}

		switch detail.Status {
		case "renamed":
			result.RenamedCount++
		case "updated":
			result.UpdatedCount++
		case "skipped":
			result.SkippedCount++
		default:
			result.ErrorCount++
		}
		result.GitInitializedCount += detail.GitInitializedCount

		result.Details = append(result.Details, detail)
	}

	return result, nil
}

// NormalizeManagedSourceFolderByTaskID normalises the folder layout for a
// single task. Exported so that app/task can call it when changing task type.
func (s *GitService) NormalizeManagedSourceFolderByTaskID(taskID string) (*NormalizeManagedSourceFolderDetail, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, errors.New(errs.MsgTaskRequired)
	}

	task, err := s.store.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf(errs.FmtTaskNotFound, taskID)
	}

	sourceModelName := "ORIGIN"
	if task.ProjectConfigID != nil && strings.TrimSpace(*task.ProjectConfigID) != "" {
		project, err := s.store.GetProject(strings.TrimSpace(*task.ProjectConfigID))
		if err != nil {
			return nil, err
		}
		if project != nil && strings.TrimSpace(project.SourceModelFolder) != "" {
			sourceModelName = strings.TrimSpace(project.SourceModelFolder)
		}
	}

	detail := &NormalizeManagedSourceFolderDetail{
		TaskID:      task.ID,
		ProjectName: task.ProjectName,
	}
	if err := s.normalizeManagedSourceFolder(*task, sourceModelName, detail); err != nil {
		return nil, err
	}
	return detail, nil
}

func (s *GitService) normalizeManagedSourceFolder(task store.Task, preferredSourceModel string, detail *NormalizeManagedSourceFolderDetail) error {
	runs, err := s.store.ListModelRuns(task.ID)
	if err != nil {
		return err
	}

	sourceRun := pickSourceRun(runs, preferredSourceModel)
	if sourceRun != nil {
		detail.SourceModelName = sourceRun.ModelName
	}

	claimSequence := inferManagedClaimSequence(task, sourceRun)

	basePath := ""
	if task.LocalPath != nil && strings.TrimSpace(*task.LocalPath) != "" {
		basePath = strings.TrimSpace(*task.LocalPath)
	}
	if basePath == "" && sourceRun != nil && sourceRun.LocalPath != nil && strings.TrimSpace(*sourceRun.LocalPath) != "" {
		basePath = filepath.Dir(strings.TrimSpace(*sourceRun.LocalPath))
	}
	if basePath == "" {
		detail.Status = "skipped"
		detail.Message = "缺少任务工作目录"
		if sourceRun == nil {
			detail.Message = joinNormalizeMessages(detail.Message, "未找到源码模型记录")
		}
		return nil
	}

	currentPath := ""
	if sourceRun != nil && sourceRun.LocalPath != nil {
		currentPath = strings.TrimSpace(*sourceRun.LocalPath)
		detail.PreviousPath = currentPath
	}

	baseRoot := filepath.Dir(basePath)
	desiredBasePath := util.BuildManagedTaskFolderPathWithSequence(baseRoot, task.ProjectName, task.TaskType, claimSequence)
	baseStatus, baseMessage, err := normalizeManagedDirectoryOnDisk(basePath, desiredBasePath, "任务目录")
	if err != nil {
		return err
	}

	if !util.SamePath(basePath, desiredBasePath) {
		if err := s.rewriteModelRunBasePaths(task.ID, runs, basePath, desiredBasePath); err != nil {
			return err
		}
		currentPath = rewriteManagedPathBase(currentPath, basePath, desiredBasePath)
	}

	if task.LocalPath == nil || !util.SamePath(*task.LocalPath, desiredBasePath) {
		desiredBase := desiredBasePath
		if err := s.store.UpdateTaskLocalPath(task.ID, &desiredBase); err != nil {
			return err
		}
		if baseStatus == "skipped" {
			baseStatus = "updated"
			if baseMessage == "" {
				baseMessage = "已回写任务工作目录"
			}
		}
	}

	promptStatus, promptMessage, err := s.syncTaskPromptArtifact(task, desiredBasePath)
	if err != nil {
		return err
	}

	if sourceRun == nil {
		gitStatus, gitMessage, gitInitializedCount, err := s.ensureTaskModelRunGitRepositories(task.ID, preferredSourceModel)
		if err != nil {
			return err
		}
		detail.GitInitializedCount = gitInitializedCount
		detail.Status = mergeNormalizeStatuses(baseStatus, promptStatus, gitStatus)
		detail.Message = joinNormalizeMessages(baseMessage, promptMessage, gitMessage, "未找到源码模型记录")
		if detail.Message == "" {
			switch detail.Status {
			case "renamed":
				detail.Message = "已完成目录归一"
			case "updated":
				detail.Message = "已完成目录路径回写"
			default:
				detail.Message = "未找到源码模型记录"
			}
		}
		return nil
	}

	desiredPath := util.BuildManagedSourceFolderPathWithSequence(desiredBasePath, task.GitLabProjectID, task.TaskType, claimSequence)
	detail.CurrentPath = desiredPath

	status, message, err := normalizeManagedDirectoryOnDisk(currentPath, desiredPath, "源码目录")
	if err != nil {
		return err
	}

	if currentPath == "" || !util.SamePath(currentPath, desiredPath) {
		desired := desiredPath
		if err := s.store.UpdateModelRunLocalPath(task.ID, sourceRun.ModelName, &desired); err != nil {
			return err
		}
	}

	gitStatus, gitMessage, gitInitializedCount, err := s.ensureTaskModelRunGitRepositories(task.ID, preferredSourceModel)
	if err != nil {
		return err
	}
	detail.GitInitializedCount = gitInitializedCount
	detail.Status = mergeNormalizeStatuses(baseStatus, promptStatus, status, gitStatus)
	detail.Message = joinNormalizeMessages(baseMessage, promptMessage, message, gitMessage)
	if detail.Message == "" {
		switch detail.Status {
		case "renamed":
			detail.Message = "已完成目录归一"
		case "updated":
			detail.Message = "已完成目录路径回写"
		case "skipped":
			detail.Message = "目录已符合当前规则"
		}
	}

	return nil
}

func (s *GitService) ensureTaskModelRunGitRepositories(taskID, preferredSourceModel string) (string, string, int, error) {
	runs, err := s.store.ListModelRuns(taskID)
	if err != nil {
		return "", "", 0, err
	}
	if len(runs) == 0 {
		return "", "", 0, nil
	}

	sourceRun := pickSourceRun(runs, preferredSourceModel)
	referencePath := ""
	initializedModels := make([]string, 0)
	if sourceRun != nil {
		sourcePath := trimmedModelRunPath(*sourceRun)
		if managedDirectoryExists(sourcePath) {
			initialized, err := gitops.EnsureSnapshotRepository(context.Background(), sourcePath, sourcePath)
			if err != nil {
				return "", "", 0, fmt.Errorf(errs.FmtSourceBaseFail, err)
			}
			if initialized {
				initializedModels = append(initializedModels, sourceRun.ModelName)
			}
			referencePath = sourcePath
		}
	}

	for _, run := range runs {
		runPath := trimmedModelRunPath(run)
		if !managedDirectoryExists(runPath) {
			continue
		}

		refPath := referencePath
		if refPath == "" {
			refPath = runPath
		}

		initialized, err := gitops.EnsureSnapshotRepository(context.Background(), refPath, runPath)
		if err != nil {
			return "", "", len(initializedModels), fmt.Errorf(errs.FmtModelBaseFail, run.ModelName, err)
		}
		if initialized {
			initializedModels = append(initializedModels, run.ModelName)
			if sourceRun != nil && strings.EqualFold(run.ModelName, sourceRun.ModelName) {
				referencePath = runPath
			}
		}
	}

	if len(initializedModels) == 0 {
		return "", "", 0, nil
	}
	return "updated", buildGitInitializationMessage(initializedModels), len(initializedModels), nil
}

func trimmedModelRunPath(run store.ModelRun) string {
	if run.LocalPath == nil {
		return ""
	}
	return strings.TrimSpace(*run.LocalPath)
}

func buildGitInitializationMessage(modelNames []string) string {
	if len(modelNames) == 0 {
		return ""
	}
	if len(modelNames) <= 3 {
		return fmt.Sprintf("已为 %s 补 Git 基线", strings.Join(modelNames, "、"))
	}
	return fmt.Sprintf("已为 %d 个模型目录补 Git 基线", len(modelNames))
}

func (s *GitService) loadConfiguredGitLabCredentials() (url, username, token string, skipTLSVerify bool, err error) {
	url, err = s.store.GetConfig("gitlab_url")
	if err != nil {
		return "", "", "", false, err
	}
	token, err = s.store.GetConfig("gitlab_token")
	if err != nil {
		return "", "", "", false, err
	}
	username, err = s.store.GetConfig("gitlab_username")
	if err != nil {
		return "", "", "", false, err
	}
	skipTLSVerifyValue, err := s.store.GetConfig("gitlab_skip_tls_verify")
	if err != nil {
		return "", "", "", false, err
	}
	skipTLSVerify, _ = strconv.ParseBool(strings.TrimSpace(skipTLSVerifyValue))

	url = strings.TrimSpace(url)
	token = strings.TrimSpace(token)
	username = strings.TrimSpace(username)
	if username == "" {
		username = "oauth2"
	}
	if url == "" || token == "" {
		return "", "", "", false, errors.New(errs.MsgGitLabSettingsMissing)
	}

	return url, username, token, skipTLSVerify, nil
}

func (s *GitService) syncTaskPromptArtifact(task store.Task, taskBasePath string) (string, string, error) {
	basePath := strings.TrimSpace(taskBasePath)
	if basePath == "" {
		return "", "", nil
	}

	promptPath := appprompt.PromptArtifactPath(util.ExpandTilde(basePath))
	content, err := os.ReadFile(promptPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", nil
		}
		return "", "", fmt.Errorf(errs.FmtReadTaskPromptFail, err)
	}

	promptText := strings.TrimSpace(string(content))
	if promptText == "" {
		return "", "任务提示词文件为空，已跳过同步", nil
	}
	if !taskPromptNeedsSync(task, promptText) {
		return "", "", nil
	}

	if err := s.store.SyncTaskPromptFromArtifact(task.ID, promptText); err != nil {
		return "", "", fmt.Errorf(errs.FmtSyncTaskPromptFail, err)
	}
	return "updated", "已同步任务提示词", nil
}

func taskPromptNeedsSync(task store.Task, promptText string) bool {
	if task.PromptText == nil || strings.TrimSpace(*task.PromptText) != promptText {
		return true
	}
	if task.PromptGenerationStatus != "done" || task.PromptGenerationError != nil {
		return true
	}
	return task.Status != "PromptReady" && task.Status != "ExecutionCompleted" && task.Status != "Submitted"
}

func collectManagedFolderSequenceInfo(basePath, folderBaseName string) (int, bool, error) {
	entries, err := os.ReadDir(util.ExpandTilde(basePath))
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, err
	}

	maxSequence := 0
	hasMatch := false
	for _, entry := range entries {
		sequence, ok := util.ParseManagedFolderSequence(entry.Name(), folderBaseName)
		if !ok {
			continue
		}
		hasMatch = true
		if sequence > maxSequence {
			maxSequence = sequence
		}
	}

	return maxSequence, hasMatch, nil
}

// collectManagedFolderGlobalSequenceSet 扫描 basePath 下所有以 projectFolderPrefix+"-" 开头的文件夹，
// 返回全部已使用序号的集合，用于保证同一 GitLab 项目跨任务类型的序号不冲突，并支持空位复用。
func collectManagedFolderGlobalSequenceSet(basePath, projectFolderPrefix string) (map[int]struct{}, error) {
	entries, err := os.ReadDir(util.ExpandTilde(basePath))
	if err != nil {
		if os.IsNotExist(err) {
			return map[int]struct{}{}, nil
		}
		return nil, err
	}

	prefix := projectFolderPrefix + "-"
	sequences := make(map[int]struct{})
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		// 尝试提取末尾数字序号：name = prefix + suffix，suffix 可能是 "tasktype" 或 "tasktype-N"
		lastDash := strings.LastIndex(name, "-")
		if lastDash <= len(prefix)-1 {
			// 无数字后缀，视为序号 1
			sequences[1] = struct{}{}
			continue
		}
		seq, convErr := strconv.Atoi(name[lastDash+1:])
		if convErr != nil || seq <= 0 {
			// 末尾不是数字，视为序号 1
			sequences[1] = struct{}{}
			continue
		}
		sequences[seq] = struct{}{}
	}

	return sequences, nil
}

// resolveManagedClaimSequences 从已使用序号集合中找出 count 个最小可用正整数序号，
// 优先复用已删除任务留下的空位。
func resolveManagedClaimSequences(usedSequences map[int]struct{}, count int) []int {
	result := make([]int, 0, count)
	seq := 1
	for len(result) < count {
		if _, used := usedSequences[seq]; !used {
			result = append(result, seq)
		}
		seq++
	}
	return result
}

func managedClaimSequenceFromTask(task store.Task) (int, bool) {
	if task.LocalPath != nil && strings.TrimSpace(*task.LocalPath) != "" {
		baseName := filepath.Base(util.ExpandTilde(strings.TrimSpace(*task.LocalPath)))
		if sequence, ok := util.ParseManagedTaskFolderSequence(baseName, task.ProjectName, task.TaskType); ok {
			return sequence, true
		}
		if sequence, ok := parseTrailingClaimSequence(baseName); ok {
			return sequence, true
		}
	}
	return 0, false
}

func inferManagedClaimSequence(task store.Task, sourceRun *store.ModelRun) int {
	if sequence, ok := managedClaimSequenceFromTask(task); ok {
		return sequence
	}

	if sourceRun != nil && sourceRun.LocalPath != nil && strings.TrimSpace(*sourceRun.LocalPath) != "" {
		baseName := filepath.Base(util.ExpandTilde(strings.TrimSpace(*sourceRun.LocalPath)))
		if sequence, ok := util.ParseManagedSourceFolderSequence(baseName, task.GitLabProjectID, task.TaskType); ok {
			return sequence
		}
		if sequence, ok := parseTrailingClaimSequence(baseName); ok {
			return sequence
		}
	}

	if sequence, ok := parseTaskIDClaimSequence(task.ID, task.GitLabProjectID); ok {
		return sequence
	}

	return 0
}

func parseTaskIDClaimSequence(taskID string, projectID int64) (int, bool) {
	trimmedTaskID := strings.TrimSpace(taskID)
	if trimmedTaskID == "" {
		return 0, false
	}
	if separatorIndex := strings.LastIndex(trimmedTaskID, "__"); separatorIndex >= 0 {
		trimmedTaskID = trimmedTaskID[separatorIndex+2:]
	}
	return util.ParseManagedFolderSequence(trimmedTaskID, fmt.Sprintf("label-%05d", projectID))
}

func parseTrailingClaimSequence(name string) (int, bool) {
	trimmedName := strings.TrimSpace(name)
	lastDash := strings.LastIndex(trimmedName, "-")
	if lastDash < 0 || lastDash >= len(trimmedName)-1 {
		return 0, false
	}
	sequence, err := strconv.Atoi(trimmedName[lastDash+1:])
	if err != nil || sequence <= 0 {
		return 0, false
	}
	return sequence, true
}

func (s *GitService) collectManagedTaskSequenceSet(projectConfigID string, projectID int64, taskType string) (map[int]struct{}, error) {
	if s.store == nil {
		return map[int]struct{}{}, nil
	}

	trimmedProjectConfigID := strings.TrimSpace(projectConfigID)
	var (
		tasks []store.Task
		err   error
	)
	if trimmedProjectConfigID != "" {
		tasks, err = s.store.ListTasks(&trimmedProjectConfigID)
	} else {
		tasks, err = s.store.ListTasks(nil)
	}
	if err != nil {
		return nil, err
	}

	sequences := make(map[int]struct{})
	for _, task := range tasks {
		if trimmedProjectConfigID == "" {
			if task.ProjectConfigID != nil && strings.TrimSpace(*task.ProjectConfigID) != "" {
				continue
			}
		} else if task.ProjectConfigID == nil || !strings.EqualFold(strings.TrimSpace(*task.ProjectConfigID), trimmedProjectConfigID) {
			continue
		}

		if task.GitLabProjectID != projectID {
			continue
		}

		if sequence, ok := managedClaimSequenceFromTask(task); ok {
			sequences[sequence] = struct{}{}
			continue
		}
		if sequence, ok := parseTaskIDClaimSequence(task.ID, task.GitLabProjectID); ok {
			sequences[sequence] = struct{}{}
		}
	}

	return sequences, nil
}

func normalizeManagedDirectoryOnDisk(currentPath, desiredPath, directoryLabel string) (string, string, error) {
	desiredPath = strings.TrimSpace(desiredPath)
	if desiredPath == "" {
		return "", "", errors.New(errs.MsgTargetDirRequired)
	}

	currentPath = strings.TrimSpace(currentPath)
	if util.SamePath(currentPath, desiredPath) {
		if managedDirectoryExists(desiredPath) {
			return "skipped", "", nil
		}
		return "", "", fmt.Errorf(errs.FmtDirLabelNotExist, directoryLabel, desiredPath)
	}

	currentExists := managedDirectoryExists(currentPath)
	desiredExists := managedDirectoryExists(desiredPath)

	switch {
	case currentPath == "":
		if desiredExists {
			return "updated", "已按目标目录回写路径", nil
		}
		return "", "", fmt.Errorf(errs.FmtNormalizeNotFound, directoryLabel)
	case currentExists && desiredExists:
		return "", "", fmt.Errorf(errs.FmtNormalizeTargetExists, desiredPath)
	case currentExists && !desiredExists:
		if err := os.MkdirAll(filepath.Dir(util.ExpandTilde(desiredPath)), 0o755); err != nil {
			return "", "", err
		}
		if err := os.Rename(util.ExpandTilde(currentPath), util.ExpandTilde(desiredPath)); err != nil {
			return "", "", err
		}
		return "renamed", fmt.Sprintf("%s已重命名为 %s", directoryLabel, filepath.Base(util.ExpandTilde(desiredPath))), nil
	case !currentExists && desiredExists:
		return "updated", "目标目录已存在，已回写数据库路径", nil
	default:
		return "", "", fmt.Errorf(errs.FmtDirLabelNotExist, directoryLabel, currentPath)
	}
}

func (s *GitService) rewriteModelRunBasePaths(taskID string, runs []store.ModelRun, previousBasePath, currentBasePath string) error {
	for _, run := range runs {
		if run.LocalPath == nil {
			continue
		}

		rewrittenPath := rewriteManagedPathBase(strings.TrimSpace(*run.LocalPath), previousBasePath, currentBasePath)
		if rewrittenPath == "" || util.SamePath(rewrittenPath, strings.TrimSpace(*run.LocalPath)) {
			continue
		}

		nextPath := rewrittenPath
		if err := s.store.UpdateModelRunLocalPath(taskID, run.ModelName, &nextPath); err != nil {
			return err
		}
	}

	return nil
}

func rewriteManagedPathBase(path, previousBasePath, currentBasePath string) string {
	trimmedPath := strings.TrimSpace(path)
	trimmedPreviousBase := strings.TrimSpace(previousBasePath)
	trimmedCurrentBase := strings.TrimSpace(currentBasePath)
	if trimmedPath == "" || trimmedPreviousBase == "" || trimmedCurrentBase == "" || util.SamePath(trimmedPreviousBase, trimmedCurrentBase) {
		return trimmedPath
	}

	expandedPreviousBase := util.ExpandTilde(trimmedPreviousBase)
	expandedPath := util.ExpandTilde(trimmedPath)
	rel, err := filepath.Rel(expandedPreviousBase, expandedPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return trimmedPath
	}
	if rel == "." {
		return trimmedCurrentBase
	}
	return filepath.Join(trimmedCurrentBase, rel)
}

func mergeNormalizeStatuses(statuses ...string) string {
	result := "skipped"
	for _, status := range statuses {
		switch status {
		case "renamed":
			return "renamed"
		case "updated":
			result = "updated"
		}
	}
	return result
}

func joinNormalizeMessages(messages ...string) string {
	nonEmpty := make([]string, 0, len(messages))
	for _, message := range messages {
		if trimmed := strings.TrimSpace(message); trimmed != "" {
			nonEmpty = append(nonEmpty, trimmed)
		}
	}
	return strings.Join(nonEmpty, "；")
}

func pickSourceRun(runs []store.ModelRun, preferredSourceModel string) *store.ModelRun {
	preferred := strings.TrimSpace(preferredSourceModel)
	if preferred == "" {
		preferred = "ORIGIN"
	}

	for i := range runs {
		if strings.EqualFold(runs[i].ModelName, preferred) {
			return &runs[i]
		}
	}
	for i := range runs {
		if runHasGitMetadata(runs[i]) {
			return &runs[i]
		}
	}
	for i := range runs {
		if strings.EqualFold(runs[i].ModelName, "ORIGIN") {
			return &runs[i]
		}
	}
	if len(runs) == 0 {
		return nil
	}
	return &runs[0]
}

func runHasGitMetadata(run store.ModelRun) bool {
	if run.LocalPath == nil || strings.TrimSpace(*run.LocalPath) == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(util.ExpandTilde(*run.LocalPath), ".git"))
	return err == nil
}

func managedDirectoryExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(util.ExpandTilde(path))
	return err == nil && info.IsDir()
}
