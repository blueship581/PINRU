package task

import (
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	appgit "github.com/blueship581/pinru/app/git"
	"github.com/blueship581/pinru/internal/errs"
	internalprompt "github.com/blueship581/pinru/internal/prompt"
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
	ClaimSequence   *int     `json:"claimSequence"`
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

type TaskChildDirectory struct {
	Name         string  `json:"name"`
	Path         string  `json:"path"`
	ModelRunID   *string `json:"modelRunId"`
	ModelName    *string `json:"modelName"`
	ReviewStatus string  `json:"reviewStatus"`
	ReviewRound  int     `json:"reviewRound"`
	ReviewNotes  *string `json:"reviewNotes"`
	IsSource     bool    `json:"isSource"`
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
		return nil, fmt.Errorf(errs.FmtProjectTaskExists, existing.ID)
	}

	if err := s.enforceTaskTypeUpperLimit(req); err != nil {
		return nil, err
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
			return nil, errors.New(errs.MsgModelNameRequired)
		}
		if _, exists := seenModels[normalizedModel]; exists {
			return nil, fmt.Errorf(errs.FmtModelDuplicate, normalizedModel)
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
	if _, err := s.ensureTaskTypeChangeWithinUpperLimit(id, taskType); err != nil {
		return err
	}
	if err := s.store.UpdateTaskType(id, taskType); err != nil {
		return err
	}
	if s.gitSvc == nil {
		return nil
	}
	if _, err := s.gitSvc.NormalizeManagedSourceFolderByTaskID(id); err != nil {
		return fmt.Errorf(errs.FmtTaskTypeNormFail, err)
	}
	return nil
}

type UpdateTaskReportFieldsRequest struct {
	ID          string `json:"id"`
	ProjectType string `json:"projectType"`
	ChangeScope string `json:"changeScope"`
}

func (s *TaskService) UpdateTaskReportFields(req UpdateTaskReportFieldsRequest) error {
	return s.store.UpdateTaskReportFields(req.ID, req.ProjectType, req.ChangeScope)
}

func (s *TaskService) UpdateTaskSessionList(req UpdateTaskSessionListRequest) error {
	task, err := s.store.GetTask(req.ID)
	if err != nil {
		return err
	}
	if task == nil {
		return fmt.Errorf(errs.FmtTaskNotFound, req.ID)
	}

	if _, err := s.ensureTaskTypeChangeWithinUpperLimit(task.ID, resolvedTaskTypeForSessionList(task.TaskType, req.SessionList)); err != nil {
		return err
	}

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
	normalized := normalizeModelRunPaths(runs)
	if normalized == nil {
		return []store.ModelRun{}, nil
	}
	return normalized, nil
}

func (s *TaskService) UpdateModelRun(req UpdateModelRunRequest) error {
	return s.store.UpdateModelRun(req.TaskID, req.ModelName, req.Status,
		req.BranchName, req.PrURL, req.StartedAt, req.FinishedAt)
}

func (s *TaskService) ListAiReviewNodes(taskID string) ([]store.AiReviewNode, error) {
	nodes, err := s.store.ListAiReviewNodes(strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	if nodes == nil {
		return []store.AiReviewNode{}, nil
	}
	return nodes, nil
}

func (s *TaskService) ListAiReviewRounds(taskID string) ([]store.AiReviewRound, error) {
	rounds, err := s.store.ListAiReviewRoundsByTask(strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	if rounds == nil {
		return []store.AiReviewRound{}, nil
	}
	return rounds, nil
}

func (s *TaskService) UpdateModelRunSessionInfo(req UpdateModelRunSessionRequest) error {
	return s.store.UpdateModelRunSession(req.ID, req.SessionID, req.ConversationRounds, req.ConversationDate)
}

func (s *TaskService) AddModelRun(req AddModelRunRequest) error {
	if req.TaskID == "" || req.ModelName == "" {
		return errors.New(errs.MsgModelNameAndTaskIDReq)
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
		return fmt.Errorf(errs.FmtModelExists, req.ModelName)
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

func (s *TaskService) syncModelRunAiReviewSummary(modelRunID string) error {
	// 优先使用线性轮次模型
	rounds, err := s.store.ListAiReviewRoundsByModelRun(modelRunID)
	if err != nil {
		return err
	}
	if len(rounds) > 0 {
		status, round, notes := store.SummarizeAiReviewRounds(rounds)
		return s.store.UpdateModelRunReview(modelRunID, status, round, notes)
	}
	// 兼容旧数据
	nodes, err := s.store.ListAiReviewNodesByModelRun(modelRunID)
	if err != nil {
		return err
	}
	status, round, notes := store.SummarizeAiReviewNodes(nodes)
	return s.store.UpdateModelRunReview(modelRunID, status, round, notes)
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

func (s *TaskService) ListTaskChildDirectories(taskID string) ([]TaskChildDirectory, error) {
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

	modelRuns, err := s.store.ListModelRuns(taskID)
	if err != nil {
		return nil, err
	}

	rootPath, err := s.resolveTaskChildDirectoryRoot(task, modelRuns)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(rootPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []TaskChildDirectory{}, nil
		}
		return nil, err
	}

	sourceModelName, err := s.resolveTaskSourceModelName(task)
	if err != nil {
		return nil, err
	}

	runByPath := make(map[string]store.ModelRun, len(modelRuns))
	for _, run := range modelRuns {
		if pathValue, ok := normalizeExistingDirectory(run.LocalPath); ok {
			runByPath[util.NormalizePath(pathValue)] = run
		}
	}

	children := make([]TaskChildDirectory, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		name := strings.TrimSpace(entry.Name())
		if name == "" || strings.HasPrefix(name, ".") {
			continue
		}

		pathValue := util.NormalizePath(filepath.Join(rootPath, name))
		child := TaskChildDirectory{
			Name:         name,
			Path:         pathValue,
			ReviewStatus: "none",
		}

		if run, ok := runByPath[pathValue]; ok {
			runID := run.ID
			modelName := run.ModelName
			child.ModelRunID = &runID
			child.ModelName = &modelName
			if strings.TrimSpace(run.ReviewStatus) != "" {
				child.ReviewStatus = strings.TrimSpace(run.ReviewStatus)
			}
			child.ReviewRound = run.ReviewRound
			if run.ReviewNotes != nil {
				reviewNotes := strings.TrimSpace(*run.ReviewNotes)
				if reviewNotes != "" {
					child.ReviewNotes = &reviewNotes
				}
			}
			child.IsSource = isOriginModelName(run.ModelName) || isSourceModelFolder(run.ModelName, sourceModelName)
		}

		children = append(children, child)
	}

	sort.SliceStable(children, func(i, j int) bool {
		if children[i].IsSource != children[j].IsSource {
			return children[i].IsSource
		}
		iHasModel := children[i].ModelRunID != nil
		jHasModel := children[j].ModelRunID != nil
		if iHasModel != jHasModel {
			return iHasModel
		}
		return strings.ToLower(children[i].Name) < strings.ToLower(children[j].Name)
	})

	return children, nil
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

	actualPath := strings.TrimSpace(*task.LocalPath)
	sequence, ok := parseManagedTaskClaimSequence(actualPath, task.ProjectName, task.TaskType)
	if !ok {
		return nil
	}
	expectedPath := util.BuildManagedTaskFolderPathWithSequence(project.CloneBasePath, task.ProjectName, task.TaskType, sequence)
	if !util.SamePath(expectedPath, actualPath) {
		return nil
	}
	if !util.IsWithinBasePath(project.CloneBasePath, actualPath) || util.SamePath(project.CloneBasePath, actualPath) {
		return fmt.Errorf(errs.FmtRefuseDeleteOutside, actualPath)
	}

	if err := os.RemoveAll(util.ExpandTilde(actualPath)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *TaskService) resolveTaskLocalFolder(task *store.Task) (string, error) {
	if task == nil {
		return "", errors.New(errs.MsgTaskRequired)
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
		return "", errors.New(errs.MsgTaskNoLocalDir)
	}

	if commonParent, ok := commonDirectoryParent(existingPaths); ok {
		return commonParent, nil
	}

	return existingPaths[0], nil
}

func (s *TaskService) resolveTaskChildDirectoryRoot(task *store.Task, modelRuns []store.ModelRun) (string, error) {
	if task == nil {
		return "", errors.New(errs.MsgTaskRequired)
	}

	if localPath, ok := normalizeExistingDirectory(task.LocalPath); ok {
		return localPath, nil
	}

	existingPaths := make([]string, 0, len(modelRuns))
	for _, run := range modelRuns {
		if pathValue, ok := normalizeExistingDirectory(run.LocalPath); ok {
			existingPaths = append(existingPaths, pathValue)
		}
	}

	if len(existingPaths) == 0 {
		return "", errors.New(errs.MsgTaskNoReviewSubdir)
	}

	if commonParent, ok := commonDirectoryParent(existingPaths); ok {
		return commonParent, nil
	}

	if len(existingPaths) == 1 {
		parent := filepath.Dir(existingPaths[0])
		if info, err := os.Stat(parent); err == nil && info.IsDir() {
			return parent, nil
		}
	}

	return "", errors.New(errs.MsgTaskNoReviewSubdir)
}

func (s *TaskService) resolveTaskSourceModelName(task *store.Task) (string, error) {
	sourceModelName := "ORIGIN"
	if task == nil || task.ProjectConfigID == nil || strings.TrimSpace(*task.ProjectConfigID) == "" {
		return sourceModelName, nil
	}

	project, err := s.store.GetProject(strings.TrimSpace(*task.ProjectConfigID))
	if err != nil {
		return "", err
	}
	if project != nil && strings.TrimSpace(project.SourceModelFolder) != "" {
		sourceModelName = strings.TrimSpace(project.SourceModelFolder)
	}
	return sourceModelName, nil
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
		return errors.New(errs.MsgDirRequired)
	}

	info, err := os.Stat(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf(errs.FmtLocalDirNotExist, targetPath)
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
		return fmt.Errorf("%s：%w", errs.MsgOpenLocalDirFail, err)
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

// enforceTaskTypeUpperLimit 检查同一 GitLab 项目在当前任务类型下的已创建任务数是否已达上限。
// 上限由项目配置 task_type_quotas 中对应类型的值决定，留空或为 0 表示不限。
func (s *TaskService) enforceTaskTypeUpperLimit(req CreateTaskRequest) error {
	if req.ProjectConfigID == nil || strings.TrimSpace(*req.ProjectConfigID) == "" {
		return nil
	}
	taskType := internalprompt.NormalizeTaskType(req.TaskType)
	if taskType == "" {
		return nil
	}

	project, err := s.store.GetProject(strings.TrimSpace(*req.ProjectConfigID))
	if err != nil {
		return err
	}
	if project == nil {
		return nil
	}

	// 解析 task_type_quotas，找到该类型的单题上限
	quotasJSON := strings.TrimSpace(project.TaskTypeQuotas)
	if quotasJSON == "" || quotasJSON == "{}" {
		return nil
	}

	var quotas map[string]int
	if err := json.Unmarshal([]byte(quotasJSON), &quotas); err != nil {
		return err
	}

	limit, hasLimit := quotas[taskType]
	if !hasLimit || limit <= 0 {
		return nil
	}

	count, err := s.store.CountTasksByProjectConfigGitLabProjectAndTaskType(
		strings.TrimSpace(*req.ProjectConfigID), req.GitLabProjectID, taskType,
	)
	if err != nil {
		return err
	}

	if count >= limit {
		return fmt.Errorf(errs.FmtGitLabQuotaReached, req.GitLabProjectID, taskType, limit)
	}
	return nil
}

func (s *TaskService) ensureTaskTypeChangeWithinUpperLimit(taskID, nextTaskType string) (*store.Task, error) {
	task, err := s.store.GetTask(strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf(errs.FmtTaskNotFound, taskID)
	}

	currentTaskType := internalprompt.NormalizeTaskType(task.TaskType)
	normalizedNextTaskType := internalprompt.NormalizeTaskType(nextTaskType)
	if normalizedNextTaskType == "" || normalizedNextTaskType == currentTaskType {
		return task, nil
	}

	req := CreateTaskRequest{
		GitLabProjectID: task.GitLabProjectID,
		ProjectName:     task.ProjectName,
		TaskType:        normalizedNextTaskType,
		ProjectConfigID: task.ProjectConfigID,
	}
	if err := s.enforceTaskTypeUpperLimit(req); err != nil {
		return nil, err
	}

	return task, nil
}

func resolvedTaskTypeForSessionList(currentTaskType string, sessions []store.TaskSession) string {
	if len(sessions) == 0 {
		return currentTaskType
	}

	nextTaskType := internalprompt.NormalizeTaskType(sessions[0].TaskType)
	if nextTaskType == "" {
		return currentTaskType
	}

	return nextTaskType
}

func (s *TaskService) findExistingTask(req CreateTaskRequest) (*store.Task, error) {
	if req.ClaimSequence != nil || claimSequenceForRequest(req) > 0 {
		task, err := s.store.GetTask(buildTaskID(req))
		if err != nil || task != nil {
			return task, err
		}
		// 向后兼容：用旧格式 ID 回退查找，并验证 task type 一致
		if buildTaskTypeIDToken(req.TaskType) != "" {
			legacyTask, legacyErr := s.store.GetTask(buildLegacyTaskID(req))
			if legacyErr != nil {
				return nil, legacyErr
			}
			if legacyTask != nil && strings.EqualFold(strings.TrimSpace(legacyTask.TaskType), strings.TrimSpace(req.TaskType)) {
				return legacyTask, nil
			}
		}
		return nil, nil
	}

	if req.ProjectConfigID != nil && strings.TrimSpace(*req.ProjectConfigID) != "" {
		return s.store.FindTaskByProjectConfigAndGitLabProjectID(strings.TrimSpace(*req.ProjectConfigID), req.GitLabProjectID)
	}

	return s.store.GetTask(legacyTaskID(req.GitLabProjectID))
}

func buildTaskID(req CreateTaskRequest) string {
	claimID := buildClaimTaskID(req.GitLabProjectID, claimSequenceForRequest(req))
	if req.ProjectConfigID == nil {
		return claimID
	}

	projectConfigToken := normalizeTaskIdentityToken(*req.ProjectConfigID)
	if projectConfigToken == "" {
		return claimID
	}

	typeToken := buildTaskTypeIDToken(req.TaskType)
	if typeToken == "" {
		return fmt.Sprintf("p%s__%s", projectConfigToken, claimID)
	}

	return fmt.Sprintf("p%s__%s__%s", projectConfigToken, typeToken, claimID)
}

// buildLegacyTaskID 生成不含 task type token 的旧格式 ID，用于向后兼容查找。
func buildLegacyTaskID(req CreateTaskRequest) string {
	claimID := buildClaimTaskID(req.GitLabProjectID, claimSequenceForRequest(req))
	if req.ProjectConfigID == nil {
		return claimID
	}
	projectConfigToken := normalizeTaskIdentityToken(*req.ProjectConfigID)
	if projectConfigToken == "" {
		return claimID
	}
	return fmt.Sprintf("p%s__%s", projectConfigToken, claimID)
}

// buildTaskTypeIDToken 将任务类型名称映射为短 ASCII 标记，用于生成 task ID。
// 默认类型（未归类）返回空字符串，以保持向后兼容。
func buildTaskTypeIDToken(taskType string) string {
	normalized := strings.TrimSpace(taskType)
	if normalized == "" || strings.EqualFold(normalized, "未归类") {
		return ""
	}

	knownTokens := map[string]string{
		"bug修复":     "bug",
		"feature迭代": "feat",
		"代码生成":      "gen",
		"代码理解":      "cmp",
		"代码重构":      "ref",
		"工程化":       "eng",
		"代码测试":      "test",
	}

	key := strings.ToLower(strings.ReplaceAll(normalized, " ", ""))
	if token, ok := knownTokens[key]; ok {
		return token
	}

	// 未知/自定义类型：用 FNV32 哈希生成稳定的短标记
	h := fnv.New32a()
	h.Write([]byte(key))
	return fmt.Sprintf("h%06x", h.Sum32()&0xFFFFFF)
}

func legacyTaskID(gitLabProjectID int64) string {
	return fmt.Sprintf("label-%05d", gitLabProjectID)
}

func buildClaimTaskID(gitLabProjectID int64, claimSequence int) string {
	baseID := legacyTaskID(gitLabProjectID)
	if claimSequence <= 0 {
		return baseID
	}
	return fmt.Sprintf("%s-%d", baseID, claimSequence)
}

func claimSequenceForRequest(req CreateTaskRequest) int {
	if req.ClaimSequence != nil && *req.ClaimSequence > 0 {
		return *req.ClaimSequence
	}

	if req.LocalPath != nil {
		if sequence, ok := parseManagedTaskClaimSequence(*req.LocalPath, req.ProjectName, req.TaskType); ok {
			return sequence
		}
	}

	if req.SourceLocalPath != nil {
		baseName := filepath.Base(util.ExpandTilde(strings.TrimSpace(*req.SourceLocalPath)))
		if sequence, ok := util.ParseManagedSourceFolderSequence(baseName, req.GitLabProjectID, req.TaskType); ok {
			return sequence
		}
	}

	return 0
}

func parseManagedTaskClaimSequence(pathValue, projectName, taskType string) (int, bool) {
	trimmedPath := strings.TrimSpace(pathValue)
	if trimmedPath == "" {
		return 0, false
	}
	baseName := filepath.Base(util.ExpandTilde(trimmedPath))
	return util.ParseManagedTaskFolderSequence(baseName, projectName, taskType)
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

func (s *TaskService) BatchDeleteTasks(taskIDs []string) (*BatchUpdateResult, error) {
	result := &BatchUpdateResult{
		Total:  len(taskIDs),
		Failed: []BatchUpdateFailure{},
	}
	for _, id := range taskIDs {
		if err := s.DeleteTask(id); err != nil {
			result.Failed = append(result.Failed, BatchUpdateFailure{TaskID: id, Error: err.Error()})
		} else {
			result.Succeeded++
		}
	}
	return result, nil
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
			err = fmt.Errorf(errs.FmtUnsupportedField, req.Field)
		}
		if err != nil {
			result.Failed = append(result.Failed, BatchUpdateFailure{TaskID: id, Error: err.Error()})
		} else {
			result.Succeeded++
		}
	}
	return result, nil
}

// SaveAiReviewRoundNotes 保存复审轮次的结论和下一轮提示词。
func (s *TaskService) SaveAiReviewRoundNotes(roundID, reviewNotes, nextPrompt string) error {
	if strings.TrimSpace(roundID) == "" {
		return errors.New(errs.MsgReviewRoundIDRequired)
	}
	return s.store.UpdateAiReviewRoundNotes(roundID, reviewNotes, nextPrompt)
}
