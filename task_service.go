package main

import (
	"fmt"
	"os"

	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	"github.com/google/uuid"
)

type TaskService struct {
	store *store.Store
}

type CreateTaskRequest struct {
	GitLabProjectID int64    `json:"gitlabProjectId"`
	ProjectName     string   `json:"projectName"`
	LocalPath       *string  `json:"localPath"`
	Models          []string `json:"models"`
	ProjectConfigID *string  `json:"projectConfigId"`
}

type UpdateModelRunRequest struct {
	TaskID     string  `json:"taskId"`
	ModelName  string  `json:"modelName"`
	Status     string  `json:"status"`
	BranchName *string `json:"branchName"`
	PrURL      *string `json:"prUrl"`
	StartedAt  *int64  `json:"startedAt"`
	FinishedAt *int64  `json:"finishedAt"`
}

type UpdateModelRunSessionRequest struct {
	ID                 string  `json:"id"`
	SessionID          *string `json:"sessionId"`
	ConversationRounds int     `json:"conversationRounds"`
	ConversationDate   *int64  `json:"conversationDate"`
}

func (s *TaskService) ListTasks(projectConfigID *string) ([]store.Task, error) {
	return s.store.ListTasks(projectConfigID)
}

func (s *TaskService) GetTask(id string) (*store.Task, error) {
	return s.store.GetTask(id)
}

func (s *TaskService) CreateTask(req CreateTaskRequest) (*store.Task, error) {
	taskID := fmt.Sprintf("label-%05d", req.GitLabProjectID)
	task := store.Task{
		ID:              taskID,
		GitLabProjectID: req.GitLabProjectID,
		ProjectName:     req.ProjectName,
		LocalPath:       req.LocalPath,
		ProjectConfigID: req.ProjectConfigID,
	}
	if err := s.store.CreateTask(task); err != nil {
		return nil, err
	}

	for _, model := range req.Models {
		var localPath *string
		if req.LocalPath != nil {
			p := *req.LocalPath + "/" + model
			localPath = &p
		}
		run := store.ModelRun{
			ID:        uuid.New().String(),
			TaskID:    taskID,
			ModelName: model,
			LocalPath: localPath,
		}
		if err := s.store.CreateModelRun(run); err != nil {
			return nil, err
		}
	}

	return s.store.GetTask(taskID)
}

func (s *TaskService) UpdateTaskStatus(id, status string) error {
	return s.store.UpdateTaskStatus(id, status)
}

func (s *TaskService) ListModelRuns(taskID string) ([]store.ModelRun, error) {
	return s.store.ListModelRuns(taskID)
}

func (s *TaskService) UpdateModelRun(req UpdateModelRunRequest) error {
	return s.store.UpdateModelRun(req.TaskID, req.ModelName, req.Status,
		req.BranchName, req.PrURL, req.StartedAt, req.FinishedAt)
}

func (s *TaskService) UpdateModelRunSessionInfo(req UpdateModelRunSessionRequest) error {
	return s.store.UpdateModelRunSession(req.ID, req.SessionID, req.ConversationRounds, req.ConversationDate)
}

type AddModelRunRequest struct {
	TaskID    string  `json:"taskId"`
	ModelName string  `json:"modelName"`
	LocalPath *string `json:"localPath"`
}

func (s *TaskService) AddModelRun(req AddModelRunRequest) error {
	if req.TaskID == "" || req.ModelName == "" {
		return fmt.Errorf("taskId 和 modelName 不能为空")
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

func (s *TaskService) DeleteModelRun(taskID, modelName string) error {
	return s.store.DeleteModelRun(taskID, modelName)
}

func (s *TaskService) DeleteTask(id string) error {
	task, err := s.store.GetTask(id)
	if err != nil {
		return err
	}
	if task != nil && task.LocalPath != nil {
		os.RemoveAll(util.ExpandTilde(*task.LocalPath))
	}
	return s.store.DeleteTask(id)
}
