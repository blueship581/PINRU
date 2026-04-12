package job

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	appcli "github.com/blueship581/pinru/app/cli"
	appgit "github.com/blueship581/pinru/app/git"
	appprompt "github.com/blueship581/pinru/app/prompt"
	appsubmit "github.com/blueship581/pinru/app/submit"
	apptask "github.com/blueship581/pinru/app/task"
	"github.com/blueship581/pinru/internal/store"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type JobService struct {
	store     *store.Store
	promptSvc *appprompt.PromptService
	gitSvc    *appgit.GitService
	submitSvc *appsubmit.SubmitService
	taskSvc   *apptask.TaskService
	cliSvc    *appcli.CliService
	mu        sync.Mutex
	running   map[string]context.CancelFunc
}

func New(
	st *store.Store,
	promptSvc *appprompt.PromptService,
	gitSvc *appgit.GitService,
	submitSvc *appsubmit.SubmitService,
	taskSvc *apptask.TaskService,
	cliSvc *appcli.CliService,
) *JobService {
	return &JobService{
		store:     st,
		promptSvc: promptSvc,
		gitSvc:    gitSvc,
		submitSvc: submitSvc,
		taskSvc:   taskSvc,
		cliSvc:    cliSvc,
		running:   make(map[string]context.CancelFunc),
	}
}

type SubmitJobRequest struct {
	JobType        string `json:"jobType"`
	TaskID         string `json:"taskId"`
	InputPayload   string `json:"inputPayload"`
	MaxRetries     int    `json:"maxRetries"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
}

type JobProgressEvent struct {
	ID              string  `json:"id"`
	JobType         string  `json:"jobType"`
	TaskID          *string `json:"taskId"`
	Status          string  `json:"status"`
	Progress        int     `json:"progress"`
	ProgressMessage *string `json:"progressMessage"`
	ErrorMessage    *string `json:"errorMessage"`
}

type jobExecutionResult struct {
	outputPayload *string
	finalMessage  *string
}

func (s *JobService) SubmitJob(req SubmitJobRequest) (*store.BackgroundJob, error) {
	if req.MaxRetries <= 0 {
		req.MaxRetries = 3
	}
	if req.TimeoutSeconds <= 0 {
		req.TimeoutSeconds = 300
	}

	id := uuid.New().String()
	now := time.Now().Unix()
	taskID := &req.TaskID
	if req.TaskID == "" {
		taskID = nil
	}

	job := store.BackgroundJob{
		ID:             id,
		JobType:        req.JobType,
		TaskID:         taskID,
		Status:         "pending",
		Progress:       0,
		InputPayload:   req.InputPayload,
		MaxRetries:     req.MaxRetries,
		TimeoutSeconds: req.TimeoutSeconds,
		CreatedAt:      now,
	}

	if err := s.store.CreateBackgroundJob(job); err != nil {
		return nil, fmt.Errorf("创建后台任务失败: %w", err)
	}

	go s.executeJob(id, req)

	created, _ := s.store.GetBackgroundJob(id)
	if created != nil {
		return created, nil
	}
	return &job, nil
}

func (s *JobService) ListJobs(filter *store.JobFilter) ([]store.BackgroundJob, error) {
	jobs, err := s.store.ListBackgroundJobs(filter)
	if err != nil {
		return nil, err
	}
	if jobs == nil {
		return []store.BackgroundJob{}, nil
	}
	return jobs, nil
}

func (s *JobService) GetJob(id string) (*store.BackgroundJob, error) {
	return s.store.GetBackgroundJob(id)
}

func (s *JobService) RetryJob(id string) (*store.BackgroundJob, error) {
	job, err := s.store.GetBackgroundJob(id)
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, fmt.Errorf("任务不存在: %s", id)
	}
	if job.Status != "error" {
		return nil, fmt.Errorf("只能重试失败的任务")
	}
	if job.RetryCount >= job.MaxRetries {
		return nil, fmt.Errorf("已达最大重试次数 (%d)", job.MaxRetries)
	}

	if err := s.store.IncrementBackgroundJobRetry(id); err != nil {
		return nil, err
	}

	taskID := ""
	if job.TaskID != nil {
		taskID = *job.TaskID
	}
	go s.executeJob(id, SubmitJobRequest{
		JobType:        job.JobType,
		TaskID:         taskID,
		InputPayload:   job.InputPayload,
		TimeoutSeconds: job.TimeoutSeconds,
	})

	return s.store.GetBackgroundJob(id)
}

func (s *JobService) CancelJob(id string) error {
	s.mu.Lock()
	cancel, ok := s.running[id]
	s.mu.Unlock()

	if ok {
		cancel()
	}
	return s.store.CancelBackgroundJob(id)
}

func (s *JobService) executeJob(id string, req SubmitJobRequest) {
	start := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(req.TimeoutSeconds)*time.Second)
	defer cancel()

	s.mu.Lock()
	s.running[id] = cancel
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, id)
		s.mu.Unlock()
	}()

	_ = s.store.StartBackgroundJob(id)
	// 尝试获取项目名称用于日志标识
	jobLabel := ""
	if req.TaskID != "" {
		if task, err := s.store.GetTask(req.TaskID); err == nil && task != nil {
			jobLabel = task.ProjectName
		}
	}

	slog.Info("job started",
		"job_id", id,
		"job_type", req.JobType,
		"project", jobLabel,
		"task_id", req.TaskID,
		"timeout_s", req.TimeoutSeconds,
	)

	if jobLabel != "" {
		s.emitProgress(id, req.JobType, req.TaskID, "running", 0, strPtr(fmt.Sprintf("[%s] 准备中…", jobLabel)), nil)
	} else {
		s.emitProgress(id, req.JobType, req.TaskID, "running", 0, strPtr("准备中…"), nil)
	}

	var (
		execErr    error
		execResult jobExecutionResult
	)
	switch req.JobType {
	case "prompt_generate":
		execResult, execErr = s.executePromptGenerate(ctx, id, req)
	case "session_sync":
		execResult, execErr = s.executeSessionSync(ctx, id, req)
	case "git_clone":
		execResult, execErr = s.executeGitClone(ctx, id, req)
	case "pr_submit":
		execResult, execErr = s.executePrSubmit(ctx, id, req)
	case "ai_review":
		execResult, execErr = s.executeAiReview(ctx, id, req)
	default:
		execErr = fmt.Errorf("未知的任务类型: %s", req.JobType)
	}

	if ctx.Err() == context.DeadlineExceeded {
		errMsg := "执行超时"
		_ = s.store.FailBackgroundJob(id, errMsg)
		s.emitProgress(id, req.JobType, req.TaskID, "error", 0, nil, &errMsg)
		slog.Error("job timeout",
			"job_id", id,
			"job_type", req.JobType,
			"project", jobLabel,
			"elapsed", time.Since(start).Round(time.Millisecond),
		)
		return
	}
	if ctx.Err() == context.Canceled {
		slog.Info("job cancelled",
			"job_id", id,
			"job_type", req.JobType,
			"project", jobLabel,
			"elapsed", time.Since(start).Round(time.Millisecond),
		)
		return
	}

	if execErr != nil {
		errMsg := execErr.Error()
		_ = s.store.FailBackgroundJob(id, errMsg)
		s.emitProgress(id, req.JobType, req.TaskID, "error", 0, nil, &errMsg)
		slog.Error("job failed",
			"job_id", id,
			"job_type", req.JobType,
			"project", jobLabel,
			"error", errMsg,
			"elapsed", time.Since(start).Round(time.Millisecond),
		)
		return
	}

	_ = s.store.CompleteBackgroundJob(id, execResult.outputPayload)
	finalMessage := execResult.finalMessage
	if finalMessage == nil {
		finalMessage = strPtr("已完成")
	}
	s.emitProgress(id, req.JobType, req.TaskID, "done", 100, finalMessage, nil)
	slog.Info("job completed",
		"job_id", id,
		"job_type", req.JobType,
		"project", jobLabel,
		"elapsed", time.Since(start).Round(time.Millisecond),
	)
}

func (s *JobService) executePromptGenerate(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	start := time.Now()

	var promptReq appprompt.GeneratePromptRequest
	if err := json.Unmarshal([]byte(req.InputPayload), &promptReq); err != nil {
		return jobExecutionResult{}, fmt.Errorf("解析提示词生成参数失败: %w", err)
	}

	// 获取项目名称用于日志标识
	projectLabel := req.TaskID
	if task, err := s.store.GetTask(req.TaskID); err == nil && task != nil {
		projectLabel = task.ProjectName
	}

	slog.Info("prompt generation started",
		"project", projectLabel,
		"task_type", promptReq.TaskType,
	)
	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 20, strPtr(fmt.Sprintf("[%s] 分析代码仓库…", projectLabel)), nil)

	res, err := s.promptSvc.GenerateTaskPromptWithContext(ctx, promptReq)
	if err != nil {
		slog.Error("prompt generation failed",
			"project", projectLabel,
			"error", err,
			"elapsed", time.Since(start).Round(time.Millisecond),
		)
		return jobExecutionResult{}, err
	}

	slog.Info("prompt generation completed",
		"project", projectLabel,
		"model", res.Model,
		"elapsed", time.Since(start).Round(time.Millisecond),
	)
	outputJSON, _ := json.Marshal(res)
	outputStr := string(outputJSON)
	return jobExecutionResult{
		outputPayload: &outputStr,
		finalMessage:  strPtr(fmt.Sprintf("[%s] 提示词已生成", projectLabel)),
	}, nil
}

func (s *JobService) executeSessionSync(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	if strings.TrimSpace(req.TaskID) == "" {
		return jobExecutionResult{}, fmt.Errorf("session_sync 缺少 taskId")
	}
	if s.taskSvc == nil {
		return jobExecutionResult{}, fmt.Errorf("session_sync 服务未初始化")
	}

	projectLabel := req.TaskID
	if task, err := s.store.GetTask(req.TaskID); err == nil && task != nil {
		projectLabel = task.ProjectName
	}

	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 20, strPtr(fmt.Sprintf("[%s] 正在同步最新 Session…", projectLabel)), nil)

	type result struct {
		payload *apptask.SyncTaskSessionsResult
		err     error
	}
	ch := make(chan result, 1)
	go func() {
		payload, err := s.taskSvc.SyncLatestTaskSessions(req.TaskID)
		ch <- result{payload: payload, err: err}
	}()

	select {
	case <-ctx.Done():
		return jobExecutionResult{}, ctx.Err()
	case r := <-ch:
		if r.err != nil {
			return jobExecutionResult{}, r.err
		}

		if r.payload != nil {
			outputJSON, _ := json.Marshal(r.payload)
			outputStr := string(outputJSON)
			if r.payload.UpdatedTargetCount == 0 {
				return jobExecutionResult{
					outputPayload: &outputStr,
					finalMessage:  strPtr(fmt.Sprintf("[%s] 未找到可同步的 Session", projectLabel)),
				}, nil
			}
			return jobExecutionResult{
				outputPayload: &outputStr,
				finalMessage: strPtr(
					fmt.Sprintf("[%s] 已同步 %d 组 Session", projectLabel, r.payload.UpdatedTargetCount),
				),
			}, nil
		}

		return jobExecutionResult{finalMessage: strPtr(fmt.Sprintf("[%s] Session 同步完成", projectLabel))}, nil
	}
}

func (s *JobService) emitProgress(id, jobType, taskID, status string, progress int, message, errMsg *string) {
	if status == "running" {
		msg := ""
		if message != nil {
			msg = *message
		}
		_ = s.store.UpdateBackgroundJobProgress(id, progress, msg)
	}

	app := application.Get()
	if app == nil {
		return
	}
	var taskIDPtr *string
	if taskID != "" {
		taskIDPtr = &taskID
	}
	app.Event.Emit("job:progress", JobProgressEvent{
		ID:              id,
		JobType:         jobType,
		TaskID:          taskIDPtr,
		Status:          status,
		Progress:        progress,
		ProgressMessage: message,
		ErrorMessage:    errMsg,
	})
}

// GitClonePayload 描述一次 git_clone 任务的参数。
type GitClonePayload struct {
	CloneURL      string               `json:"cloneUrl"`
	SourcePath    string               `json:"sourcePath"`
	SourceModelID string               `json:"sourceModelId"`
	CopyTargets   []GitCloneCopyTarget `json:"copyTargets"`
}

type GitCloneCopyTarget struct {
	ModelID string `json:"modelId"`
	Path    string `json:"path"`
}

type GitCloneFailure struct {
	ModelID string `json:"modelId"`
	Message string `json:"message"`
}

type GitCloneResult struct {
	SourcePath       string            `json:"sourcePath"`
	SuccessfulModels []string          `json:"successfulModels"`
	FailedModels     []GitCloneFailure `json:"failedModels"`
}

func (s *JobService) executeGitClone(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	start := time.Now()

	var payload GitClonePayload
	if err := json.Unmarshal([]byte(req.InputPayload), &payload); err != nil {
		return jobExecutionResult{}, fmt.Errorf("解析 git_clone 参数失败: %w", err)
	}

	sourceModelID := payload.SourceModelID
	if sourceModelID == "" {
		sourceModelID = "ORIGIN"
	}
	resultPayload := GitCloneResult{
		SourcePath:       payload.SourcePath,
		SuccessfulModels: make([]string, 0, len(payload.CopyTargets)+1),
		FailedModels:     make([]GitCloneFailure, 0),
	}

	slog.Info("git clone started",
		"clone_url", payload.CloneURL,
		"source_model", sourceModelID,
		"copy_targets", len(payload.CopyTargets),
	)
	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 10, strPtr("准备拉取源码…"), nil)

	type result struct{ err error }
	ch := make(chan result, 1)
	go func() {
		err := s.gitSvc.CloneConfiguredProjectWithProgress(
			payload.CloneURL,
			payload.SourcePath,
			func(msg string) {
				s.emitProgress(jobID, req.JobType, req.TaskID, "running", 20, &msg, nil)
			},
		)
		ch <- result{err}
	}()

	select {
	case <-ctx.Done():
		return jobExecutionResult{}, ctx.Err()
	case r := <-ch:
		if r.err != nil {
			return jobExecutionResult{}, r.err
		}
	}
	resultPayload.SuccessfulModels = append(resultPayload.SuccessfulModels, sourceModelID)

	total := len(payload.CopyTargets)
	for i, target := range payload.CopyTargets {
		progress := 50 + (i+1)*45/(total+1)
		s.emitProgress(
			jobID,
			req.JobType,
			req.TaskID,
			"running",
			progress,
			strPtr(fmt.Sprintf("正在复制到 %s（%d/%d）…", target.ModelID, i+1, total)),
			nil,
		)

		type cpResult struct{ err error }
		cpCh := make(chan cpResult, 1)
		go func(src, dst string) {
			err := s.gitSvc.CopyProjectDirectory(src, dst)
			cpCh <- cpResult{err}
		}(payload.SourcePath, target.Path)

		select {
		case <-ctx.Done():
			return jobExecutionResult{}, ctx.Err()
		case r := <-cpCh:
			if r.err != nil {
				resultPayload.FailedModels = append(resultPayload.FailedModels, GitCloneFailure{
					ModelID: target.ModelID,
					Message: r.err.Error(),
				})
				continue
			}
			resultPayload.SuccessfulModels = append(resultPayload.SuccessfulModels, target.ModelID)
		}
	}

	outputJSON, _ := json.Marshal(resultPayload)
	outputStr := string(outputJSON)
	totalModels := len(payload.CopyTargets) + 1
	slog.Info("git clone completed",
		"clone_url", payload.CloneURL,
		"success_count", len(resultPayload.SuccessfulModels),
		"failed_count", len(resultPayload.FailedModels),
		"total", totalModels,
		"elapsed", time.Since(start).Round(time.Millisecond),
	)
	if len(resultPayload.FailedModels) > 0 {
		return jobExecutionResult{
			outputPayload: &outputStr,
			finalMessage: strPtr(
				fmt.Sprintf("部分完成：成功 %d/%d", len(resultPayload.SuccessfulModels), totalModels),
			),
		}, nil
	}
	return jobExecutionResult{
		outputPayload: &outputStr,
		finalMessage:  strPtr(fmt.Sprintf("拉取完成：共 %d 个副本", totalModels)),
	}, nil
}

// PrSubmitPayload 描述一次 pr_submit 任务的参数，与 appsubmit.SubmitAllRequest 对应。
type PrSubmitPayload struct {
	GitHubAccountID string   `json:"githubAccountId"`
	TaskID          string   `json:"taskId"`
	Models          []string `json:"models"`
	TargetRepo      string   `json:"targetRepo"`
	SourceModelName string   `json:"sourceModelName"`
	GitHubUsername  string   `json:"githubUsername"`
	GitHubToken     string   `json:"githubToken"`
}

func (s *JobService) executePrSubmit(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	start := time.Now()

	var payload PrSubmitPayload
	if err := json.Unmarshal([]byte(req.InputPayload), &payload); err != nil {
		return jobExecutionResult{}, fmt.Errorf("解析 pr_submit 参数失败: %w", err)
	}

	slog.Info("pr submit started",
		"task_id", payload.TaskID,
		"target_repo", payload.TargetRepo,
		"models", payload.Models,
	)
	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 20, strPtr("正在上传源码到 GitHub…"), nil)

	type result struct {
		res *appsubmit.SubmitAllResult
		err error
	}
	ch := make(chan result, 1)
	go func() {
		res, err := s.submitSvc.SubmitAll(appsubmit.SubmitAllRequest{
			GitHubAccountID: payload.GitHubAccountID,
			TaskID:          payload.TaskID,
			Models:          payload.Models,
			TargetRepo:      payload.TargetRepo,
			SourceModelName: payload.SourceModelName,
			GitHubUsername:  payload.GitHubUsername,
			GitHubToken:     payload.GitHubToken,
		})
		ch <- result{res, err}
	}()

	select {
	case <-ctx.Done():
		return jobExecutionResult{}, ctx.Err()
	case r := <-ch:
		if r.err != nil {
			slog.Error("pr submit failed",
				"task_id", payload.TaskID,
				"target_repo", payload.TargetRepo,
				"error", r.err,
				"elapsed", time.Since(start).Round(time.Millisecond),
			)
			return jobExecutionResult{}, r.err
		}
		if r.res != nil && r.res.RepoError != "" {
			err := fmt.Errorf("源码上传失败: %s", r.res.RepoError)
			slog.Error("pr submit failed",
				"task_id", payload.TaskID,
				"target_repo", payload.TargetRepo,
				"error", err,
				"elapsed", time.Since(start).Round(time.Millisecond),
			)
			return jobExecutionResult{}, err
		}
		s.emitProgress(jobID, req.JobType, req.TaskID, "running", 80, strPtr("源码已上传，正在创建模型 PR…"), nil)

		slog.Info("pr submit completed",
			"task_id", payload.TaskID,
			"target_repo", payload.TargetRepo,
			"elapsed", time.Since(start).Round(time.Millisecond),
		)
		if r.res != nil {
			outputJSON, _ := json.Marshal(r.res)
			outputStr := string(outputJSON)
			return jobExecutionResult{
				outputPayload: &outputStr,
				finalMessage:  strPtr("PR 提交完成"),
			}, nil
		}
		return jobExecutionResult{finalMessage: strPtr("PR 提交完成")}, nil
	}
}

// AiReviewPayload 描述一次 ai_review 任务的参数。
type AiReviewPayload struct {
	ModelRunID string `json:"modelRunId"`
	ModelName  string `json:"modelName"`
	LocalPath  string `json:"localPath"`
}

// AiReviewResult 记录一次 ai_review 任务的输出。
type AiReviewResult struct {
	ModelRunID   string `json:"modelRunId"`
	ModelName    string `json:"modelName"`
	ReviewStatus string `json:"reviewStatus"`
	ReviewRound  int    `json:"reviewRound"`
	ReviewNotes  string `json:"reviewNotes"`
	NextPrompt   string `json:"nextPrompt"`
}

const aiReviewMaxRounds = 2

func (s *JobService) executeAiReview(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	if s.cliSvc == nil {
		return jobExecutionResult{}, fmt.Errorf("cli 服务未初始化")
	}

	var payload AiReviewPayload
	if err := json.Unmarshal([]byte(req.InputPayload), &payload); err != nil {
		return jobExecutionResult{}, fmt.Errorf("解析 ai_review 参数失败: %w", err)
	}
	if strings.TrimSpace(payload.ModelRunID) == "" {
		return jobExecutionResult{}, fmt.Errorf("ai_review 缺少 modelRunId")
	}
	if strings.TrimSpace(payload.LocalPath) == "" {
		return jobExecutionResult{}, fmt.Errorf("ai_review 缺少 localPath")
	}

	label := payload.ModelName
	if label == "" {
		label = payload.ModelRunID
	}

	var lastResult *appcli.CodexReviewResult
	var finalRound int

	for round := 1; round <= aiReviewMaxRounds; round++ {
		finalRound = round
		roundLabel := fmt.Sprintf("第 %d/%d 轮", round, aiReviewMaxRounds)

		slog.Info("ai review round started",
			"job_id", jobID,
			"model_run", label,
			"round", round,
		)
		s.emitProgress(jobID, req.JobType, req.TaskID, "running",
			(round-1)*45,
			strPtr(fmt.Sprintf("[%s] 复审%s…", label, roundLabel)),
			nil,
		)
		_ = s.store.UpdateModelRunReview(payload.ModelRunID, "running", round, nil)

		var roundErr error
		type reviewOut struct {
			result *appcli.CodexReviewResult
			err    error
		}
		ch := make(chan reviewOut, 1)

		go func(r int) {
			res, err := s.cliSvc.RunCodexReview(ctx, payload.LocalPath, func(line string) {
				s.emitProgress(jobID, req.JobType, req.TaskID, "running",
					(r-1)*45+10,
					strPtr(fmt.Sprintf("[%s] %s", label, line)),
					nil,
				)
			})
			ch <- reviewOut{res, err}
		}(round)

		select {
		case <-ctx.Done():
			return jobExecutionResult{}, ctx.Err()
		case out := <-ch:
			roundErr = out.err
			lastResult = out.result
		}

		if roundErr != nil {
			slog.Error("ai review round failed",
				"job_id", jobID,
				"model_run", label,
				"round", round,
				"error", roundErr,
			)
			// On final round, surface error; otherwise try next round.
			if round == aiReviewMaxRounds {
				_ = s.store.UpdateModelRunReview(payload.ModelRunID, "warning", round, nil)
				return jobExecutionResult{}, roundErr
			}
			continue
		}

		passed := lastResult.IsCompleted && lastResult.IsSatisfied
		slog.Info("ai review round completed",
			"job_id", jobID,
			"model_run", label,
			"round", round,
			"is_completed", lastResult.IsCompleted,
			"is_satisfied", lastResult.IsSatisfied,
			"passed", passed,
		)

		if passed {
			notes := strPtr(lastResult.ReviewNotes)
			_ = s.store.UpdateModelRunReview(payload.ModelRunID, "pass", round, notes)
			result := AiReviewResult{
				ModelRunID:   payload.ModelRunID,
				ModelName:    payload.ModelName,
				ReviewStatus: "pass",
				ReviewRound:  round,
				ReviewNotes:  lastResult.ReviewNotes,
				NextPrompt:   lastResult.NextPrompt,
			}
			outputJSON, _ := json.Marshal(result)
			outputStr := string(outputJSON)
			return jobExecutionResult{
				outputPayload: &outputStr,
				finalMessage:  strPtr(fmt.Sprintf("[%s] 复审通过（第 %d 轮）", label, round)),
			}, nil
		}

		// Not passed — if more rounds remain, continue.
		if round < aiReviewMaxRounds {
			s.emitProgress(jobID, req.JobType, req.TaskID, "running",
				round*45,
				strPtr(fmt.Sprintf("[%s] 第 %d 轮未通过，准备第 %d 轮…", label, round, round+1)),
				nil,
			)
		}
	}

	// Exhausted all rounds without passing → warning.
	var notes *string
	if lastResult != nil && lastResult.ReviewNotes != "" {
		notes = strPtr(lastResult.ReviewNotes)
	}
	_ = s.store.UpdateModelRunReview(payload.ModelRunID, "warning", finalRound, notes)

	result := AiReviewResult{
		ModelRunID:   payload.ModelRunID,
		ModelName:    payload.ModelName,
		ReviewStatus: "warning",
		ReviewRound:  finalRound,
	}
	if lastResult != nil {
		result.ReviewNotes = lastResult.ReviewNotes
		result.NextPrompt = lastResult.NextPrompt
	}
	outputJSON, _ := json.Marshal(result)
	outputStr := string(outputJSON)
	return jobExecutionResult{
		outputPayload: &outputStr,
		finalMessage:  strPtr(fmt.Sprintf("[%s] 复审未通过（已复审 %d 轮）", label, finalRound)),
	}, nil
}

func strPtr(s string) *string {
	return &s
}
