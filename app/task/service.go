package task

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	appgit "github.com/blueship581/pinru/app/git"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	"github.com/google/uuid"
)

// Service manages task lifecycle and model runs.
type TaskService struct {
	store  *store.Store
	gitSvc *appgit.GitService
}

// NewService creates a new task service.
func New(store *store.Store, gitSvc *appgit.GitService) *TaskService {
	return &TaskService{store: store, gitSvc: gitSvc}
}

// CreateTaskRequest carries the parameters for creating a new task.
type CreateTaskRequest struct {
	GitLabProjectID int64    `json:"gitlabProjectId"`
	ProjectName     string   `json:"projectName"`
	TaskType        string   `json:"taskType"`
	LocalPath       *string  `json:"localPath"`
	SourceModelName *string  `json:"sourceModelName"`
	SourceLocalPath *string  `json:"sourceLocalPath"`
	Models          []string `json:"models"`
	ProjectConfigID *string  `json:"projectConfigId"`
}

// UpdateModelRunRequest carries parameters for updating a model run's status.
type UpdateModelRunRequest struct {
	TaskID     string  `json:"taskId"`
	ModelName  string  `json:"modelName"`
	Status     string  `json:"status"`
	BranchName *string `json:"branchName"`
	PrURL      *string `json:"prUrl"`
	StartedAt  *int64  `json:"startedAt"`
	FinishedAt *int64  `json:"finishedAt"`
}

// UpdateModelRunSessionRequest carries session metadata for a model run.
type UpdateModelRunSessionRequest struct {
	ID                 string  `json:"id"`
	SessionID          *string `json:"sessionId"`
	ConversationRounds int     `json:"conversationRounds"`
	ConversationDate   *int64  `json:"conversationDate"`
}

// UpdateTaskSessionListRequest carries session list updates for a task or model run.
type UpdateTaskSessionListRequest struct {
	ID          string              `json:"id"`
	ModelRunID  *string             `json:"modelRunId"`
	SessionList []store.TaskSession `json:"sessionList"`
}

// AddModelRunRequest adds a new model run to an existing task.
type AddModelRunRequest struct {
	TaskID    string  `json:"taskId"`
	ModelName string  `json:"modelName"`
	LocalPath *string `json:"localPath"`
}

var taskIdentityTokenPattern = regexp.MustCompile(`[^a-zA-Z0-9]+`)

func (s *TaskService) ListTasks(projectConfigID *string) ([]store.Task, error) {
	tasks, err := s.store.ListTasks(projectConfigID)
	if err != nil {
		return nil, err
	}
	return normalizeTaskPaths(tasks), nil
}

func (s *TaskService) GetTask(id string) (*store.Task, error) {
	task, err := s.store.GetTask(id)
	if err != nil || task == nil {
		return task, err
	}
	normalized := normalizeTaskPath(*task)
	return &normalized, nil
}

func (s *TaskService) CreateTask(req CreateTaskRequest) (*store.Task, error) {
	req = normalizeCreateTaskRequestPaths(req)
	taskID := buildTaskID(req)

	if existing, err := s.findExistingTask(req); err != nil {
		return nil, err
	} else if existing != nil {
		return nil, fmt.Errorf("当前项目下题卡已存在：%s", existing.ID)
	}

	task := store.Task{
		ID:              taskID,
		GitLabProjectID: req.GitLabProjectID,
		ProjectName:     req.ProjectName,
		TaskType:        req.TaskType,
		LocalPath:       req.LocalPath,
		ProjectConfigID: req.ProjectConfigID,
	}
	seenModels := make(map[string]struct{}, len(req.Models))
	modelRuns := make([]store.ModelRun, 0, len(req.Models))
	for _, model := range req.Models {
		normalizedModel := strings.TrimSpace(model)
		if normalizedModel == "" {
			return nil, fmt.Errorf("模型名称不能为空")
		}
		if _, exists := seenModels[normalizedModel]; exists {
			return nil, fmt.Errorf("模型 %q 重复", normalizedModel)
		}
		seenModels[normalizedModel] = struct{}{}

		modelRuns = append(modelRuns, store.ModelRun{
			ID:        uuid.New().String(),
			TaskID:    taskID,
			ModelName: normalizedModel,
			LocalPath: buildModelRunLocalPath(req, normalizedModel),
		})
	}

	if err := s.store.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		return nil, err
	}

	return s.store.GetTask(taskID)
}

func (s *TaskService) UpdateTaskStatus(id, status string) error {
	return s.store.UpdateTaskStatus(id, status)
}

func (s *TaskService) UpdateTaskType(id, taskType string) error {
	if err := s.store.UpdateTaskType(id, taskType); err != nil {
		return err
	}
	if s.gitSvc == nil {
		return nil
	}
	if _, err := s.gitSvc.NormalizeManagedSourceFolderByTaskID(id); err != nil {
		return fmt.Errorf("任务类型已更新，但本地目录归一失败: %w", err)
	}
	return nil
}

func (s *TaskService) UpdateTaskSessionList(req UpdateTaskSessionListRequest) error {
	if req.ModelRunID != nil && strings.TrimSpace(*req.ModelRunID) != "" {
		return s.store.UpdateModelRunSessionList(req.ID, strings.TrimSpace(*req.ModelRunID), req.SessionList)
	}
	return s.store.UpdateTaskSessionList(req.ID, req.SessionList)
}

func (s *TaskService) ListModelRuns(taskID string) ([]store.ModelRun, error) {
	runs, err := s.store.ListModelRuns(taskID)
	if err != nil {
		return nil, err
	}
	return normalizeModelRunPaths(runs), nil
}

func (s *TaskService) UpdateModelRun(req UpdateModelRunRequest) error {
	return s.store.UpdateModelRun(req.TaskID, req.ModelName, req.Status,
		req.BranchName, req.PrURL, req.StartedAt, req.FinishedAt)
}

func (s *TaskService) UpdateModelRunSessionInfo(req UpdateModelRunSessionRequest) error {
	return s.store.UpdateModelRunSession(req.ID, req.SessionID, req.ConversationRounds, req.ConversationDate)
}

func (s *TaskService) AddModelRun(req AddModelRunRequest) error {
	if req.TaskID == "" || req.ModelName == "" {
		return fmt.Errorf("taskId 和 modelName 不能为空")
	}
	if req.LocalPath != nil {
		normalized := util.NormalizePath(*req.LocalPath)
		req.LocalPath = &normalized
	}
	existing, err := s.store.GetModelRun(req.TaskID, req.ModelName)
	if err != nil {
		return err
	}
	if existing != nil {
		return fmt.Errorf("模型 %q 已存在", req.ModelName)
	}
	run := store.ModelRun{
		ID:        uuid.New().String(),
		TaskID:    req.TaskID,
		ModelName: req.ModelName,
		LocalPath: req.LocalPath,
	}
	return s.store.CreateModelRun(run)
}

func normalizeCreateTaskRequestPaths(req CreateTaskRequest) CreateTaskRequest {
	if req.LocalPath != nil {
		normalized := util.NormalizePath(*req.LocalPath)
		req.LocalPath = &normalized
	}
	if req.SourceLocalPath != nil {
		normalized := util.NormalizePath(*req.SourceLocalPath)
		req.SourceLocalPath = &normalized
	}
	return req
}

func normalizeTaskPaths(tasks []store.Task) []store.Task {
	if len(tasks) == 0 {
		return tasks
	}
	normalized := make([]store.Task, len(tasks))
	for i := range tasks {
		normalized[i] = normalizeTaskPath(tasks[i])
	}
	return normalized
}

func normalizeTaskPath(task store.Task) store.Task {
	if task.LocalPath != nil {
		normalized := util.NormalizePath(*task.LocalPath)
		task.LocalPath = &normalized
	}
	return task
}

func normalizeModelRunPaths(runs []store.ModelRun) []store.ModelRun {
	if len(runs) == 0 {
		return runs
	}
	normalized := make([]store.ModelRun, len(runs))
	for i := range runs {
		normalized[i] = runs[i]
		if runs[i].LocalPath != nil {
			path := util.NormalizePath(*runs[i].LocalPath)
			normalized[i].LocalPath = &path
		}
	}
	return normalized
}

func (s *TaskService) DeleteModelRun(taskID, modelName string) error {
	return s.store.DeleteModelRun(taskID, modelName)
}

func (s *TaskService) DeleteTask(id string) error {
	task, err := s.store.GetTask(id)
	if err != nil {
		return err
	}
	if task != nil {
		if err := s.removeManagedTaskDirectory(task); err != nil {
			return err
		}
	}
	return s.store.DeleteTask(id)
}

func (s *TaskService) OpenTaskLocalFolder(id string) error {
	taskID := strings.TrimSpace(id)
	if taskID == "" {
		return fmt.Errorf("任务不能为空")
	}

	task, err := s.store.GetTask(taskID)
	if err != nil {
		return err
	}
	if task == nil {
		return fmt.Errorf("未找到任务: %s", taskID)
	}

	targetPath, err := s.resolveTaskLocalFolder(task)
	if err != nil {
		return err
	}

	return openPathInFileManager(targetPath)
}

func (s *TaskService) removeManagedTaskDirectory(task *store.Task) error {
	if task == nil || task.LocalPath == nil || strings.TrimSpace(*task.LocalPath) == "" {
		return nil
	}
	if task.ProjectConfigID == nil || strings.TrimSpace(*task.ProjectConfigID) == "" {
		return nil
	}

	project, err := s.store.GetProject(strings.TrimSpace(*task.ProjectConfigID))
	if err != nil {
		return err
	}
	if project == nil {
		return nil
	}

	expectedPath := util.BuildManagedTaskFolderPath(project.CloneBasePath, task.ProjectName, task.TaskType)
	actualPath := strings.TrimSpace(*task.LocalPath)
	if !util.SamePath(expectedPath, actualPath) {
		return nil
	}
	if !util.IsWithinBasePath(project.CloneBasePath, actualPath) || util.SamePath(project.CloneBasePath, actualPath) {
		return fmt.Errorf("拒绝删除受管范围外的任务目录: %s", actualPath)
	}

	if err := os.RemoveAll(util.ExpandTilde(actualPath)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *TaskService) resolveTaskLocalFolder(task *store.Task) (string, error) {
	if task == nil {
		return "", fmt.Errorf("任务不能为空")
	}

	if localPath, ok := normalizeExistingDirectory(task.LocalPath); ok {
		return localPath, nil
	}

	modelRuns, err := s.store.ListModelRuns(task.ID)
	if err != nil {
		return "", err
	}

	existingPaths := make([]string, 0, len(modelRuns))
	for _, run := range modelRuns {
		if path, ok := normalizeExistingDirectory(run.LocalPath); ok {
			existingPaths = append(existingPaths, path)
		}
	}

	if len(existingPaths) == 0 {
		return "", fmt.Errorf("当前题目还没有可打开的本地目录")
	}

	if commonParent, ok := commonDirectoryParent(existingPaths); ok {
		return commonParent, nil
	}

	return existingPaths[0], nil
}

func normalizeExistingDirectory(pathValue *string) (string, bool) {
	if pathValue == nil {
		return "", false
	}

	trimmed := strings.TrimSpace(*pathValue)
	if trimmed == "" {
		return "", false
	}

	expanded := filepath.Clean(util.ExpandTilde(trimmed))
	info, err := os.Stat(expanded)
	if err != nil || !info.IsDir() {
		return "", false
	}

	return expanded, true
}

func commonDirectoryParent(paths []string) (string, bool) {
	if len(paths) < 2 {
		return "", false
	}

	parent := filepath.Dir(paths[0])
	if parent == "." || parent == string(filepath.Separator) {
		return "", false
	}

	for _, pathValue := range paths[1:] {
		if filepath.Dir(pathValue) != parent {
			return "", false
		}
	}

	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() {
		return "", false
	}

	return parent, true
}

func openPathInFileManager(pathValue string) error {
	targetPath := filepath.Clean(util.ExpandTilde(strings.TrimSpace(pathValue)))
	if targetPath == "" {
		return fmt.Errorf("目录不能为空")
	}

	info, err := os.Stat(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("本地目录不存在: %s", targetPath)
		}
		return err
	}

	if !info.IsDir() {
		targetPath = filepath.Dir(targetPath)
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", targetPath)
	case "windows":
		cmd = exec.Command("explorer", targetPath)
	default:
		cmd = exec.Command("xdg-open", targetPath)
	}

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("打开本地目录失败: %w", err)
	}

	return nil
}

func buildModelRunLocalPath(req CreateTaskRequest, model string) *string {
	sourceModelName := "ORIGIN"
	if req.SourceModelName != nil && strings.TrimSpace(*req.SourceModelName) != "" {
		sourceModelName = strings.TrimSpace(*req.SourceModelName)
	}
	if req.SourceLocalPath != nil && strings.TrimSpace(*req.SourceLocalPath) != "" && strings.EqualFold(strings.TrimSpace(model), sourceModelName) {
		path := strings.TrimSpace(*req.SourceLocalPath)
		return &path
	}
	if req.LocalPath == nil || strings.TrimSpace(*req.LocalPath) == "" {
		return nil
	}
	path := filepath.Join(strings.TrimSpace(*req.LocalPath), model)
	return &path
}

func (s *TaskService) findExistingTask(req CreateTaskRequest) (*store.Task, error) {
	if req.ProjectConfigID != nil && strings.TrimSpace(*req.ProjectConfigID) != "" {
		return s.store.FindTaskByProjectConfigAndGitLabProjectID(strings.TrimSpace(*req.ProjectConfigID), req.GitLabProjectID)
	}

	return s.store.GetTask(legacyTaskID(req.GitLabProjectID))
}

func buildTaskID(req CreateTaskRequest) string {
	legacyID := legacyTaskID(req.GitLabProjectID)
	if req.ProjectConfigID == nil {
		return legacyID
	}

	projectConfigToken := normalizeTaskIdentityToken(*req.ProjectConfigID)
	if projectConfigToken == "" {
		return legacyID
	}

	return fmt.Sprintf("p%s__%s", projectConfigToken, legacyID)
}

func legacyTaskID(gitLabProjectID int64) string {
	return fmt.Sprintf("label-%05d", gitLabProjectID)
}

func normalizeTaskIdentityToken(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	trimmed = strings.TrimPrefix(trimmed, "project-")
	normalized := taskIdentityTokenPattern.ReplaceAllString(trimmed, "-")
	return strings.Trim(normalized, "-")
}

// BatchUpdateTasksRequest carries parameters for bulk-updating tasks.
type BatchUpdateTasksRequest struct {
	TaskIDs []string `json:"taskIds"`
	Field   string   `json:"field"` // "status" | "taskType"
	Value   string   `json:"value"`
}

// BatchUpdateFailure records a single failed update.
type BatchUpdateFailure struct {
	TaskID string `json:"taskId"`
	Error  string `json:"error"`
}

// BatchUpdateResult summarises the outcome of a bulk update.
type BatchUpdateResult struct {
	Total     int                  `json:"total"`
	Succeeded int                  `json:"succeeded"`
	Failed    []BatchUpdateFailure `json:"failed"`
}

func (s *TaskService) BatchUpdateTasks(req BatchUpdateTasksRequest) (*BatchUpdateResult, error) {
	result := &BatchUpdateResult{
		Total:  len(req.TaskIDs),
		Failed: []BatchUpdateFailure{},
	}
	for _, id := range req.TaskIDs {
		var err error
		switch req.Field {
		case "status":
			err = s.UpdateTaskStatus(id, req.Value)
		case "taskType":
			err = s.UpdateTaskType(id, req.Value)
		default:
			err = fmt.Errorf("不支持的字段: %s", req.Field)
		}
		if err != nil {
			result.Failed = append(result.Failed, BatchUpdateFailure{TaskID: id, Error: err.Error()})
		} else {
			result.Succeeded++
		}
	}
	return result, nil
}
