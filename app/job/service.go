package job

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	appcli "github.com/blueship581/pinru/app/cli"
	appgit "github.com/blueship581/pinru/app/git"
	appprompt "github.com/blueship581/pinru/app/prompt"
	appsubmit "github.com/blueship581/pinru/app/submit"
	apptask "github.com/blueship581/pinru/app/task"
	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	gitCloneConcurrencyLimit = 3
	gitCloneRetryAttempts    = 3
	gitCloneRetryBackoff     = 2 * time.Second
	gitCloneIdleTimeout      = 30 * time.Second
)

var errGitCloneIdleTimeout = fmt.Errorf(errs.FmtJobGitCloneIdleTimeout, gitCloneIdleTimeout)

type JobService struct {
	store     *store.Store
	promptSvc *appprompt.PromptService
	gitSvc    *appgit.GitService
	submitSvc *appsubmit.SubmitService
	taskSvc   *apptask.TaskService
	cliSvc    *appcli.CliService
	mu        sync.Mutex
	running   map[string]context.CancelFunc
	cloneSem  chan struct{}
	// aiReviewMaterials 保存 SubmitJob 阶段预采集的 AI 复审素材，
	// key 为 jobID。executeAiReview 取出后 Delete，避免内存泄漏。
	// 进程重启或直接重试时可能未命中缓存，此时执行阶段会自行兜底采集。
	aiReviewMaterials sync.Map
}

// aiReviewMaterials 聚合任务发起阶段预采集的 AI 复审素材。
type aiReviewMaterials struct {
	ReviewContext *appcli.PgCodeProjectContext
	RoundHistory  []appcli.AiReviewHistoryEntry
	ParentNotes   string
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
		cloneSem:  make(chan struct{}, gitCloneConcurrencyLimit),
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
	// 先做 ai_review 去重（重复点击时短路返回已有 job）：避免无意义的素材采集
	if req.JobType == "ai_review" {
		s.mu.Lock()
		existing, err := s.findActiveJobLocked(req)
		s.mu.Unlock()
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
	}

	var preparedMaterials *aiReviewMaterials
	if req.JobType == "ai_review" {
		payload, ok := parseAiReviewPayloadForDedup(req.InputPayload)
		if !ok {
			return nil, errors.New(errs.MsgJobAiReviewParseFail)
		}
		// 前置校验：拉取任务原始提示词 / 多轮历史 / 项目上下文 / 代码变更；
		// 任何一项缺失直接返回 error，不创建 round、不持久化 job。
		materials, err := s.validateAndCollectAiReviewMaterials(context.Background(), req.TaskID, payload)
		if err != nil {
			return nil, err
		}
		preparedPayload, err := s.prepareAiReviewPayload(req.TaskID, payload)
		if err != nil {
			return nil, err
		}
		payloadJSON, err := json.Marshal(preparedPayload)
		if err != nil {
			return nil, fmt.Errorf(errs.FmtJobSerializeAiReview, err)
		}
		req.InputPayload = string(payloadJSON)
		preparedMaterials = materials
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

	s.mu.Lock()
	// 二次 dedup：覆盖两次校验之间并发提交同一目标的竞态
	existing, err := s.findActiveJobLocked(req)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	if existing != nil {
		s.mu.Unlock()
		return existing, nil
	}
	if err := s.store.CreateBackgroundJob(job); err != nil {
		s.mu.Unlock()
		return nil, fmt.Errorf(errs.FmtJobCreateFail, err)
	}
	s.mu.Unlock()

	if preparedMaterials != nil {
		s.aiReviewMaterials.Store(id, preparedMaterials)
	}

	go s.executeJob(id, req)

	created, _ := s.store.GetBackgroundJob(id)
	if created != nil {
		return created, nil
	}
	return &job, nil
}

func (s *JobService) findActiveJobLocked(req SubmitJobRequest) (*store.BackgroundJob, error) {
	if req.JobType != "ai_review" || strings.TrimSpace(req.TaskID) == "" {
		return nil, nil
	}

	currentPayload, ok := parseAiReviewPayloadForDedup(req.InputPayload)
	if !ok {
		return nil, nil
	}
	if len(aiReviewTargetKeys(currentPayload)) == 0 {
		return nil, nil
	}

	filter := &store.JobFilter{TaskID: &req.TaskID}
	jobs, err := s.store.ListBackgroundJobs(filter)
	if err != nil {
		return nil, fmt.Errorf(errs.FmtJobQueryFail, err)
	}

	for _, job := range jobs {
		if job.JobType != "ai_review" {
			continue
		}
		if job.Status != "pending" && job.Status != "running" {
			continue
		}
		payload, ok := parseAiReviewPayloadForDedup(job.InputPayload)
		if !ok {
			continue
		}
		if sameAiReviewTarget(currentPayload, payload) {
			existing := job
			return &existing, nil
		}
	}

	return nil, nil
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
		return nil, fmt.Errorf(errs.FmtTaskNotFound, id)
	}
	if job.Status != "error" {
		return nil, errors.New(errs.MsgJobRetryOnlyFailed)
	}
	if job.RetryCount >= job.MaxRetries {
		return nil, fmt.Errorf(errs.FmtJobMaxRetryReached, job.MaxRetries)
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
	job, err := s.store.GetBackgroundJob(id)
	if err != nil {
		return err
	}
	if job == nil {
		return fmt.Errorf(errs.FmtTaskNotFound, id)
	}

	s.mu.Lock()
	cancel, ok := s.running[id]
	s.mu.Unlock()

	if ok {
		cancel()
	}
	if err := s.store.CancelBackgroundJob(id); err != nil {
		return err
	}
	if err := s.restoreAiReviewRoundAfterCancellation(job); err != nil {
		return err
	}

	taskID := ""
	if job.TaskID != nil {
		taskID = *job.TaskID
	}
	s.emitProgress(id, job.JobType, taskID, "cancelled", job.Progress, strPtr("已取消"), nil)
	return nil
}

func (s *JobService) DeleteAiReviewJob(id string) error {
	job, err := s.store.GetBackgroundJob(id)
	if err != nil {
		return err
	}
	if job == nil {
		return fmt.Errorf(errs.FmtTaskNotFound, id)
	}
	if job.JobType != "ai_review" {
		return errors.New(errs.MsgJobDeleteOnlyReview)
	}
	if job.Status == "pending" || job.Status == "running" {
		return errors.New(errs.MsgJobReviewStillRunning)
	}
	if err := s.store.DeleteBackgroundJob(id); err != nil {
		return err
	}

	return nil
}

func (s *JobService) DeleteAiReviewRound(roundID string) error {
	roundID = strings.TrimSpace(roundID)
	if roundID == "" {
		return errors.New(errs.MsgReviewRoundIDRequired)
	}

	round, err := s.store.GetAiReviewRound(roundID)
	if err != nil {
		return err
	}
	if round == nil {
		return fmt.Errorf(errs.FmtJobReviewRoundNotFound, roundID)
	}

	if round.Status == "running" {
		return errors.New(errs.MsgJobReviewStillRunning)
	}
	if round.JobID != nil {
		jobID := strings.TrimSpace(*round.JobID)
		if jobID != "" {
			job, err := s.store.GetBackgroundJob(jobID)
			if err != nil {
				return err
			}
			if job != nil && (job.Status == "pending" || job.Status == "running") {
				return errors.New(errs.MsgJobReviewStillRunning)
			}
		}
	}

	modelRunID, err := s.store.DeleteAiReviewRoundWithJob(roundID)
	if err != nil {
		return err
	}
	if modelRunID != nil {
		runID := strings.TrimSpace(*modelRunID)
		if runID != "" {
			return s.syncModelRunAiReviewSummaryFromRounds(runID)
		}
	}
	return nil
}

func (s *JobService) restoreAiReviewRoundAfterCancellation(job *store.BackgroundJob) error {
	if job == nil || job.JobType != "ai_review" || job.TaskID == nil {
		return nil
	}

	payload, ok := parseAiReviewPayloadForDedup(job.InputPayload)
	if !ok || payload.ReviewRoundID == nil || strings.TrimSpace(*payload.ReviewRoundID) == "" {
		return nil
	}

	round, err := s.store.GetAiReviewRound(strings.TrimSpace(*payload.ReviewRoundID))
	if err != nil || round == nil {
		return err
	}
	if round.JobID == nil || strings.TrimSpace(*round.JobID) != job.ID {
		return nil
	}

	// 取消时恢复到 none 状态
	previousStatus := "none"
	if payload.RoundSnapshot != nil {
		previousStatus = firstNonEmpty(payload.RoundSnapshot.Status, "none")
	}
	if err := s.store.UpdateAiReviewRoundStatus(round.ID, previousStatus, nil); err != nil {
		return err
	}

	if round.ModelRunID != nil && strings.TrimSpace(*round.ModelRunID) != "" {
		return s.syncModelRunAiReviewSummaryFromRounds(strings.TrimSpace(*round.ModelRunID))
	}
	return nil
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

	if s.isJobCancelled(id) {
		slog.Info("job skipped because it was already cancelled",
			"job_id", id,
			"job_type", req.JobType,
			"task_id", req.TaskID,
		)
		return
	}

	if err := s.store.StartBackgroundJob(id); err != nil {
		slog.Error("failed to mark job as started", "job_id", id, "error", err)
	}
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
	case "question_bank_materialize":
		execResult, execErr = s.executeQuestionBankMaterialize(ctx, id, req)
	case "pr_submit":
		execResult, execErr = s.executePrSubmit(ctx, id, req)
	case "ai_review":
		execResult, execErr = s.executeAiReview(ctx, id, req)
	default:
		execErr = fmt.Errorf(errs.FmtJobUnknownType, req.JobType)
	}

	if ctx.Err() == context.DeadlineExceeded {
		if s.isJobCancelled(id) {
			return
		}
		errMsg := "执行超时"
		if err := s.store.FailBackgroundJob(id, errMsg); err != nil {
			slog.Error("failed to mark job as failed (timeout)", "job_id", id, "error", err)
		}
		if !s.isJobCancelled(id) {
			s.emitProgress(id, req.JobType, req.TaskID, "error", 0, nil, &errMsg)
		}
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
		if s.isJobCancelled(id) {
			return
		}
		errMsg := execErr.Error()
		if err := s.store.FailBackgroundJob(id, errMsg); err != nil {
			slog.Error("failed to mark job as failed", "job_id", id, "error", err)
		}
		if !s.isJobCancelled(id) {
			s.emitProgress(id, req.JobType, req.TaskID, "error", 0, nil, &errMsg)
		}
		slog.Error("job failed",
			"job_id", id,
			"job_type", req.JobType,
			"project", jobLabel,
			"error", errMsg,
			"elapsed", time.Since(start).Round(time.Millisecond),
		)
		return
	}

	if s.isJobCancelled(id) {
		return
	}
	if err := s.store.CompleteBackgroundJob(id, execResult.outputPayload); err != nil {
		slog.Error("failed to mark job as complete", "job_id", id, "error", err)
	}
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
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobParsePromptGenParam, err)
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
		return jobExecutionResult{}, errors.New(errs.MsgJobSessionSyncNoTask)
	}
	if s.taskSvc == nil {
		return jobExecutionResult{}, errors.New(errs.MsgJobSessionSyncNoService)
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
	if status == "running" && s.isJobCancelled(id) {
		return
	}

	if status == "running" {
		msg := ""
		if message != nil {
			msg = *message
		}
		if err := s.store.UpdateBackgroundJobProgress(id, progress, msg); err != nil {
			slog.Error("failed to update job progress", "job_id", id, "error", err)
		}
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

func (s *JobService) isJobCancelled(id string) bool {
	job, err := s.store.GetBackgroundJob(id)
	if err != nil || job == nil {
		return false
	}
	return job.Status == "cancelled"
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

type QuestionBankMaterializePayload struct {
	BankSourcePath string               `json:"bankSourcePath"`
	TargetSourcePath string             `json:"targetSourcePath"`
	SourceModelID string                `json:"sourceModelId"`
	CopyTargets   []GitCloneCopyTarget  `json:"copyTargets"`
}

func (s *JobService) executeGitClone(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	start := time.Now()

	var payload GitClonePayload
	if err := json.Unmarshal([]byte(req.InputPayload), &payload); err != nil {
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobParseGitCloneParam, err)
	}

	sourceModelID := payload.SourceModelID
	if sourceModelID == "" {
		sourceModelID = "ORIGIN"
	}

	slog.Info("git clone started",
		"clone_url", payload.CloneURL,
		"source_model", sourceModelID,
		"copy_targets", len(payload.CopyTargets),
	)
	if err := s.ensureGitCloneTargetsAvailable(payload); err != nil {
		return jobExecutionResult{}, err
	}

	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 5, strPtr("等待空闲拉取槽位…"), nil)
	release, err := s.acquireGitCloneSlot(ctx)
	if err != nil {
		return jobExecutionResult{}, err
	}
	defer release()

	var lastErr error
	for attempt := 1; attempt <= gitCloneRetryAttempts; attempt++ {
		result, err := s.executeGitCloneAttempt(ctx, jobID, req, payload, sourceModelID, attempt, start)
		if err == nil {
			return result, nil
		}
		if contextErr := gitCloneContextErr(ctx); contextErr != nil {
			return jobExecutionResult{}, cleanupGitCloneTargetsAfterAbort(payload, contextErr)
		}
		lastErr = err
		if attempt == gitCloneRetryAttempts {
			break
		}

		retryMsg := fmt.Sprintf(
			"第 %d/%d 次拉取失败：%s；%s后重试",
			attempt,
			gitCloneRetryAttempts,
			summarizeGitCloneError(err),
			gitCloneRetryBackoff,
		)
		s.emitProgress(jobID, req.JobType, req.TaskID, "running", 12, &retryMsg, nil)
		if cleanupErr := cleanupGitCloneTargets(payload); cleanupErr != nil {
			return jobExecutionResult{}, fmt.Errorf(errs.FmtJobCleanRetryDirFail, cleanupErr)
		}
		select {
		case <-ctx.Done():
			return jobExecutionResult{}, gitCloneContextErr(ctx)
		case <-time.After(gitCloneRetryBackoff):
		}
	}

	if lastErr == nil {
		lastErr = errors.New(errs.MsgGitCloneFailed)
	}
	if cleanupErr := cleanupGitCloneTargets(payload); cleanupErr != nil {
		lastErr = errors.Join(lastErr, fmt.Errorf(errs.FmtJobCleanFailedDirFail, cleanupErr))
	}
	return jobExecutionResult{}, fmt.Errorf(errs.FmtJobGitCloneRetriesFailed, gitCloneRetryAttempts, lastErr)
}

func (s *JobService) executeQuestionBankMaterialize(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	var payload QuestionBankMaterializePayload
	if err := json.Unmarshal([]byte(req.InputPayload), &payload); err != nil {
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobParseGitCloneParam, err)
	}

	sourceModelID := payload.SourceModelID
	if sourceModelID == "" {
		sourceModelID = "ORIGIN"
	}

	targetPaths := targetPathsFromSourceAndCopies(payload.TargetSourcePath, payload.CopyTargets)
	if err := s.ensureTargetPathsAvailable(targetPaths); err != nil {
		return jobExecutionResult{}, err
	}

	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 5, strPtr("等待空闲复制槽位…"), nil)
	release, err := s.acquireGitCloneSlot(ctx)
	if err != nil {
		return jobExecutionResult{}, err
	}
	defer release()

	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 20, strPtr("正在从 question_bank 复制源码…"), nil)
	if err := s.gitSvc.CopyProjectDirectory(ctx, payload.BankSourcePath, payload.TargetSourcePath); err != nil {
		if cleanupErr := cleanupTargetPaths(targetPaths); cleanupErr != nil {
			return jobExecutionResult{}, errors.Join(err, fmt.Errorf(errs.FmtJobCleanFailedDirFail, cleanupErr))
		}
		return jobExecutionResult{}, err
	}

	resultPayload := GitCloneResult{
		SourcePath:       payload.TargetSourcePath,
		SuccessfulModels: []string{sourceModelID},
		FailedModels:     make([]GitCloneFailure, 0),
	}

	total := len(payload.CopyTargets)
	for i, target := range payload.CopyTargets {
		if contextErr := gitCloneContextErr(ctx); contextErr != nil {
			return jobExecutionResult{}, cleanupTargetPathsAfterAbort(targetPaths, contextErr)
		}
		progress := 55 + (i+1)*40/(total+1)
		s.emitProgress(
			jobID,
			req.JobType,
			req.TaskID,
			"running",
			progress,
			strPtr(fmt.Sprintf("正在复制到 %s（%d/%d）…", target.ModelID, i+1, total)),
			nil,
		)
		if err := s.gitSvc.CopyProjectDirectory(ctx, payload.TargetSourcePath, target.Path); err != nil {
			resultPayload.FailedModels = append(resultPayload.FailedModels, GitCloneFailure{
				ModelID: target.ModelID,
				Message: err.Error(),
			})
			continue
		}
		resultPayload.SuccessfulModels = append(resultPayload.SuccessfulModels, target.ModelID)
	}

	outputJSON, _ := json.Marshal(resultPayload)
	outputStr := string(outputJSON)
	totalModels := len(payload.CopyTargets) + 1
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
		finalMessage:  strPtr(fmt.Sprintf("题库复制完成：共 %d 个副本", totalModels)),
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
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobParsePrSubmitParam, err)
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
			err := fmt.Errorf(errs.FmtJobSourceUploadFail, r.res.RepoError)
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
	ReviewRoundID      *string              `json:"reviewRoundId,omitempty"`
	ModelRunID         *string              `json:"modelRunId"`
	ModelName          string               `json:"modelName"`
	LocalPath          string               `json:"localPath"`
	NextPromptOverride string               `json:"nextPromptOverride,omitempty"`
	RoundSnapshot      *AiReviewRoundSnapshot `json:"roundSnapshot,omitempty"`

	// Deprecated: 兼容旧版前端，映射到 ReviewRoundID
	ReviewNodeID *string `json:"reviewNodeId,omitempty"`
}

type AiReviewRoundSnapshot struct {
	Status      string `json:"status"`
	RoundNumber int    `json:"roundNumber"`
}

// AiReviewResult 记录一次 ai_review 任务的输出。
type AiReviewResult struct {
	ReviewRoundID string `json:"reviewRoundId"`
	ModelRunID    string `json:"modelRunId"`
	ModelName     string `json:"modelName"`
	ReviewStatus  string `json:"reviewStatus"`
	ReviewRound   int    `json:"reviewRound"`
	ReviewNotes   string `json:"reviewNotes"`
	NextPrompt    string `json:"nextPrompt"`
	IsCompleted   bool   `json:"isCompleted"`
	IsSatisfied   bool   `json:"isSatisfied"`
	ProjectType   string `json:"projectType"`
	ChangeScope   string `json:"changeScope"`
	KeyLocations  string `json:"keyLocations"`
}

func (s *JobService) executeAiReview(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
) (jobExecutionResult, error) {
	if s.cliSvc == nil {
		return jobExecutionResult{}, errors.New(errs.MsgJobCliUninitialized)
	}

	// 无论成功失败都释放 SubmitJob 阶段预采集缓存，避免内存泄漏。
	defer s.aiReviewMaterials.Delete(jobID)

	var payload AiReviewPayload
	if err := json.Unmarshal([]byte(req.InputPayload), &payload); err != nil {
		return jobExecutionResult{}, fmt.Errorf("%s：%w", errs.MsgJobAiReviewParseFail, err)
	}
	payload, err := s.prepareAiReviewPayload(req.TaskID, payload)
	if err != nil {
		return jobExecutionResult{}, err
	}
	if payload.ReviewRoundID == nil || strings.TrimSpace(*payload.ReviewRoundID) == "" {
		return jobExecutionResult{}, errors.New(errs.MsgJobAiReviewNoRound)
	}

	round, err := s.store.GetAiReviewRound(strings.TrimSpace(*payload.ReviewRoundID))
	if err != nil {
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobReadReviewRound, err)
	}
	if round == nil {
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobReviewRoundNotFound, strings.TrimSpace(*payload.ReviewRoundID))
	}

	modelRunID := ""
	if round.ModelRunID != nil {
		modelRunID = strings.TrimSpace(*round.ModelRunID)
	}

	label := normalizeAiReviewRoundLabel(*round)
	roundNumber := round.RoundNumber

	// 标记为 running
	if err := s.store.UpdateAiReviewRoundStatus(round.ID, "running", strPtr(jobID)); err != nil {
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobUpdateReviewRoundFail, err)
	}
	if modelRunID != "" {
		if err := s.syncModelRunAiReviewSummaryFromRounds(modelRunID); err != nil {
			slog.Error("failed to sync model run review summary", "model_run_id", modelRunID, "error", err)
		}
	}

	attemptLabel := fmt.Sprintf("第 %d 轮", roundNumber)
	slog.Info("ai review round started",
		"job_id", jobID,
		"review_round_id", round.ID,
		"review_label", label,
		"round_number", roundNumber,
	)
	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 10,
		strPtr(fmt.Sprintf("[%s] 复核%s…", label, attemptLabel)),
		nil,
	)

	type reviewOut struct {
		result *appcli.CodexReviewResult
		err    error
	}
	ch := make(chan reviewOut, 1)

	// 取出 SubmitJob 阶段预采集的素材；未命中（RetryJob / 进程重启）时
	// RunCodexReview 会自行回退到实时采集路径（hard error）。
	var cachedMaterials *aiReviewMaterials
	if cached, ok := s.aiReviewMaterials.Load(jobID); ok {
		if m, ok := cached.(*aiReviewMaterials); ok {
			cachedMaterials = m
		}
	}

	reviewReq := appcli.CodexReviewRequest{
		LocalPath:      payload.LocalPath,
		OriginalPrompt: strings.TrimSpace(round.OriginalPrompt),
		CurrentPrompt:  strings.TrimSpace(round.PromptText),
		IssueType:      "",
		IssueTitle:     "",
		ModelName:      strings.TrimSpace(round.ModelName),
	}
	if cachedMaterials != nil {
		reviewReq.PreCollectedContext = cachedMaterials.ReviewContext
		reviewReq.RoundHistory = cachedMaterials.RoundHistory
		reviewReq.ParentReviewNotes = cachedMaterials.ParentNotes
	}

	go func() {
		res, err := s.cliSvc.RunCodexReview(ctx, reviewReq, func(line string) {
			if isStructuredAiReviewLine(line) {
				return
			}
			s.emitProgress(jobID, req.JobType, req.TaskID, "running", 30,
				strPtr(fmt.Sprintf("[%s] %s", label, line)),
				nil,
			)
		})
		ch <- reviewOut{res, err}
	}()

	var lastResult *appcli.CodexReviewResult
	select {
	case <-ctx.Done():
		return jobExecutionResult{}, ctx.Err()
	case out := <-ch:
		if out.err != nil {
			slog.Error("ai review round failed",
				"job_id", jobID,
				"review_round_id", round.ID,
				"round_number", roundNumber,
				"error", out.err,
			)
			if err := s.store.FinalizeAiReviewRound(round.ID, "warning", nil, nil, "", "", "", "", ""); err != nil {
				slog.Error("failed to persist ai review round error state", "review_round_id", round.ID, "error", err)
			}
			if modelRunID != "" {
				if err := s.syncModelRunAiReviewSummaryFromRounds(modelRunID); err != nil {
					slog.Error("failed to sync model run review summary", "model_run_id", modelRunID, "error", err)
				}
			}
			return jobExecutionResult{}, out.err
		}
		lastResult = out.result
	}

	passed := lastResult.IsCompleted && lastResult.IsSatisfied
	slog.Info("ai review round completed",
		"job_id", jobID,
		"review_round_id", round.ID,
		"round_number", roundNumber,
		"is_completed", lastResult.IsCompleted,
		"is_satisfied", lastResult.IsSatisfied,
		"passed", passed,
	)

	finalStatus := "warning"
	if passed {
		finalStatus = "pass"
	}

	if err := s.store.FinalizeAiReviewRound(
		round.ID,
		finalStatus,
		boolPtr(lastResult.IsCompleted),
		boolPtr(lastResult.IsSatisfied),
		strings.TrimSpace(lastResult.ReviewNotes),
		strings.TrimSpace(lastResult.NextPrompt),
		strings.TrimSpace(lastResult.ProjectType),
		strings.TrimSpace(lastResult.ChangeScope),
		strings.TrimSpace(lastResult.KeyLocations),
	); err != nil {
		return jobExecutionResult{}, fmt.Errorf(errs.FmtJobSaveReviewResultFail, err)
	}
	if modelRunID != "" {
		if err := s.syncModelRunAiReviewSummaryFromRounds(modelRunID); err != nil {
			slog.Error("failed to sync model run review summary", "model_run_id", modelRunID, "error", err)
		}
	}

	// Sync projectType/changeScope from AI review to task level when task fields are empty.
	if req.TaskID != "" {
		aiPT := strings.TrimSpace(lastResult.ProjectType)
		aiCS := strings.TrimSpace(lastResult.ChangeScope)
		if aiPT != "" || aiCS != "" {
			if task, err := s.store.GetTask(req.TaskID); err == nil && task != nil {
				needSync := false
				pt := task.ProjectType
				cs := task.ChangeScope
				if pt == "" && aiPT != "" {
					pt = aiPT
					needSync = true
				}
				if cs == "" && aiCS != "" {
					cs = aiCS
					needSync = true
				}
				if needSync {
					if err := s.store.UpdateTaskReportFields(req.TaskID, pt, cs); err != nil {
						slog.Error("failed to sync ai review fields to task", "task_id", req.TaskID, "error", err)
					}
				}
			}
		}
	}

	result := AiReviewResult{
		ReviewRoundID: round.ID,
		ModelRunID:    modelRunID,
		ModelName:     payload.ModelName,
		ReviewStatus:  finalStatus,
		ReviewRound:   roundNumber,
		ReviewNotes:   strings.TrimSpace(lastResult.ReviewNotes),
		NextPrompt:    strings.TrimSpace(lastResult.NextPrompt),
		IsCompleted:   lastResult.IsCompleted,
		IsSatisfied:   lastResult.IsSatisfied,
		ProjectType:   strings.TrimSpace(lastResult.ProjectType),
		ChangeScope:   strings.TrimSpace(lastResult.ChangeScope),
		KeyLocations:  strings.TrimSpace(lastResult.KeyLocations),
	}
	outputJSON, _ := json.Marshal(result)
	outputStr := string(outputJSON)
	return jobExecutionResult{
		outputPayload: &outputStr,
		finalMessage:  strPtr(fmt.Sprintf("[%s] 复核%s（第 %d 轮）", label, ternaryAiReviewResultText(passed), roundNumber)),
	}, nil
}

func (s *JobService) prepareAiReviewPayload(taskID string, payload AiReviewPayload) (AiReviewPayload, error) {
	payload.ModelName = strings.TrimSpace(payload.ModelName)
	payload.LocalPath = normalizeAiReviewPath(payload.LocalPath)
	if payload.ModelRunID != nil {
		trimmed := strings.TrimSpace(*payload.ModelRunID)
		if trimmed == "" {
			payload.ModelRunID = nil
		} else {
			payload.ModelRunID = &trimmed
		}
	}
	// 兼容旧版前端: reviewNodeId → reviewRoundId
	if payload.ReviewRoundID == nil && payload.ReviewNodeID != nil {
		payload.ReviewRoundID = payload.ReviewNodeID
	}
	if payload.ReviewRoundID != nil {
		trimmed := strings.TrimSpace(*payload.ReviewRoundID)
		if trimmed == "" {
			payload.ReviewRoundID = nil
		} else {
			payload.ReviewRoundID = &trimmed
		}
	}

	round, err := s.ensureAiReviewRound(taskID, payload)
	if err != nil {
		return AiReviewPayload{}, err
	}

	payload.ReviewRoundID = &round.ID
	payload.ModelName = strings.TrimSpace(round.ModelName)
	payload.LocalPath = normalizeAiReviewPath(round.LocalPath)
	if round.ModelRunID != nil {
		modelRunID := strings.TrimSpace(*round.ModelRunID)
		payload.ModelRunID = &modelRunID
	} else {
		payload.ModelRunID = nil
	}
	snapshot := AiReviewRoundSnapshot{
		Status:      round.Status,
		RoundNumber: round.RoundNumber,
	}
	payload.RoundSnapshot = &snapshot
	return payload, nil
}

func parseAiReviewPayloadForDedup(raw string) (AiReviewPayload, bool) {
	var payload AiReviewPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return AiReviewPayload{}, false
	}

	payload.ModelName = strings.TrimSpace(payload.ModelName)
	payload.LocalPath = normalizeAiReviewPath(payload.LocalPath)
	// 兼容旧版
	if payload.ReviewRoundID == nil && payload.ReviewNodeID != nil {
		payload.ReviewRoundID = payload.ReviewNodeID
	}
	if payload.ReviewRoundID != nil {
		trimmed := strings.TrimSpace(*payload.ReviewRoundID)
		if trimmed == "" {
			payload.ReviewRoundID = nil
		} else {
			payload.ReviewRoundID = &trimmed
		}
	}
	if payload.ModelRunID != nil {
		trimmed := strings.TrimSpace(*payload.ModelRunID)
		if trimmed == "" {
			payload.ModelRunID = nil
		} else {
			payload.ModelRunID = &trimmed
		}
	}

	return payload, true
}

func buildAiReviewTargetKey(reviewRoundID, modelRunID *string, localPath string) string {
	if reviewRoundID != nil {
		if trimmed := strings.TrimSpace(*reviewRoundID); trimmed != "" {
			return "round:" + trimmed
		}
	}

	if modelRunID != nil {
		if trimmed := strings.TrimSpace(*modelRunID); trimmed != "" {
			return "run:" + trimmed
		}
	}

	if normalizedPath := normalizeAiReviewPath(localPath); normalizedPath != "" {
		return "path:" + normalizedPath
	}

	return ""
}

func aiReviewTargetKeys(payload AiReviewPayload) []string {
	keys := make([]string, 0, 3)
	if key := buildAiReviewTargetKey(payload.ReviewRoundID, nil, ""); key != "" {
		keys = append(keys, key)
	}
	if key := buildAiReviewTargetKey(nil, payload.ModelRunID, ""); key != "" {
		keys = append(keys, key)
	}
	if key := buildAiReviewTargetKey(nil, nil, payload.LocalPath); key != "" {
		keys = append(keys, key)
	}
	return keys
}

func sameAiReviewTarget(left, right AiReviewPayload) bool {
	leftKeys := aiReviewTargetKeys(left)
	rightKeys := aiReviewTargetKeys(right)
	if len(leftKeys) == 0 || len(rightKeys) == 0 {
		return false
	}

	rightSet := make(map[string]struct{}, len(rightKeys))
	for _, key := range rightKeys {
		rightSet[key] = struct{}{}
	}
	for _, key := range leftKeys {
		if _, ok := rightSet[key]; ok {
			return true
		}
	}
	return false
}

// validateAndCollectAiReviewMaterials 在 SubmitJob 阶段一次性完成：
//  1. 校验任务提示词存在；
//  2. 多轮时聚合历史轮次提示词规划与上一轮 review_notes；
//  3. 调用 Codex pg-code 脚本采集项目上下文；
//  4. 校验项目目录存在、代码有可核验的变更。
//
// 任一步骤失败直接返回 error，供 SubmitJob fail-fast。
func (s *JobService) validateAndCollectAiReviewMaterials(
	ctx context.Context,
	taskID string,
	payload AiReviewPayload,
) (*aiReviewMaterials, error) {
	normalizedTaskID := strings.TrimSpace(taskID)
	if normalizedTaskID == "" {
		return nil, errors.New(errs.MsgJobAiReviewNoTask)
	}

	// 1) 任务原始提示词
	task, err := s.store.GetTask(normalizedTaskID)
	if err != nil {
		return nil, fmt.Errorf("读取任务失败：%w", err)
	}
	originalPrompt := ""
	if task != nil && task.PromptText != nil {
		originalPrompt = strings.TrimSpace(*task.PromptText)
	}
	if originalPrompt == "" {
		return nil, errors.New(errs.MsgReviewTaskPromptMissing)
	}

	// 2) localPath：指定 ReviewRoundID 时从 round 读，否则取 payload
	localPath := normalizeAiReviewPath(payload.LocalPath)
	var modelRunIDForHistory *string
	if payload.ReviewRoundID != nil && strings.TrimSpace(*payload.ReviewRoundID) != "" {
		existing, err := s.store.GetAiReviewRound(strings.TrimSpace(*payload.ReviewRoundID))
		if err != nil {
			return nil, fmt.Errorf(errs.FmtJobReadReviewRound, err)
		}
		if existing == nil {
			return nil, fmt.Errorf(errs.FmtJobReviewRoundNotFound, strings.TrimSpace(*payload.ReviewRoundID))
		}
		localPath = normalizeAiReviewPath(existing.LocalPath)
		modelRunIDForHistory = existing.ModelRunID
	} else {
		modelRunIDForHistory = payload.ModelRunID
	}
	if localPath == "" {
		return nil, errors.New(errs.MsgJobAiReviewNoLocalPath)
	}

	// 3) 多轮历史：仅 nextRound > 1 时聚合
	nextRound, err := s.store.GetNextRoundNumber(modelRunIDForHistory, localPath)
	if err != nil {
		return nil, fmt.Errorf(errs.FmtJobNextRoundFail, err)
	}
	var history []appcli.AiReviewHistoryEntry
	parentNotes := ""
	if nextRound > 1 && modelRunIDForHistory != nil && strings.TrimSpace(*modelRunIDForHistory) != "" {
		rounds, err := s.store.ListAiReviewRoundsByModelRun(strings.TrimSpace(*modelRunIDForHistory))
		if err != nil {
			return nil, fmt.Errorf(errs.FmtJobReadPrevReviewFail, err)
		}
		sort.Slice(rounds, func(i, j int) bool {
			return rounds[i].RoundNumber < rounds[j].RoundNumber
		})
		for _, r := range rounds {
			if r.RoundNumber >= nextRound {
				continue
			}
			if strings.TrimSpace(r.PromptText) == "" {
				continue
			}
			history = append(history, appcli.AiReviewHistoryEntry{
				RoundNumber: r.RoundNumber,
				PromptText:  strings.TrimSpace(r.PromptText),
				ReviewNotes: strings.TrimSpace(r.ReviewNotes),
				NextPrompt:  strings.TrimSpace(r.NextPrompt),
			})
			parentNotes = strings.TrimSpace(r.ReviewNotes) // 保留最后一条的 review_notes
		}
		if len(history) == 0 {
			return nil, errors.New(errs.MsgReviewHistoryPromptMissing)
		}
	}

	// 4) 项目上下文采集
	project, err := s.cliSvc.CollectReviewContext(ctx, localPath)
	if err != nil {
		// 脚本缺失已经在 CollectReviewContext 里包裹成 MsgReviewContextScriptMissing；
		// 其他错误统一归为 MsgReviewContextCollectFailed。
		if strings.Contains(err.Error(), errs.MsgReviewContextScriptMissing) {
			return nil, err
		}
		return nil, fmt.Errorf("%s：%w", errs.MsgReviewContextCollectFailed, err)
	}
	if project == nil {
		return nil, errors.New(errs.MsgReviewContextCollectFailed)
	}
	if !project.Exists {
		return nil, errors.New(errs.MsgReviewProjectDirNotExist)
	}
	if len(project.Git.ChangedFiles) == 0 && len(project.RecentFiles) == 0 {
		return nil, errors.New(errs.MsgReviewNoCodeChanges)
	}

	return &aiReviewMaterials{
		ReviewContext: project,
		RoundHistory:  history,
		ParentNotes:   parentNotes,
	}, nil
}

func (s *JobService) ensureAiReviewRound(taskID string, payload AiReviewPayload) (*store.AiReviewRound, error) {
	normalizedTaskID := strings.TrimSpace(taskID)
	if normalizedTaskID == "" {
		return nil, errors.New(errs.MsgJobAiReviewNoTask)
	}

	// 如果指定了具体的 round ID，直接返回
	if payload.ReviewRoundID != nil && strings.TrimSpace(*payload.ReviewRoundID) != "" {
		round, err := s.store.GetAiReviewRound(strings.TrimSpace(*payload.ReviewRoundID))
		if err != nil {
			return nil, fmt.Errorf(errs.FmtJobReadReviewRound, err)
		}
		if round == nil {
			return nil, fmt.Errorf(errs.FmtJobReviewRoundNotFound, strings.TrimSpace(*payload.ReviewRoundID))
		}
		return round, nil
	}

	if payload.LocalPath == "" {
		return nil, errors.New(errs.MsgJobAiReviewNoLocalPath)
	}

	// 获取任务的原始提示词
	task, err := s.store.GetTask(normalizedTaskID)
	if err != nil {
		return nil, fmt.Errorf("读取任务失败：%w", err)
	}
	originalPrompt := ""
	if task != nil && task.PromptText != nil {
		originalPrompt = strings.TrimSpace(*task.PromptText)
	}

	// 确定 round_number 和本轮使用的提示词
	nextRound, err := s.store.GetNextRoundNumber(payload.ModelRunID, payload.LocalPath)
	if err != nil {
		return nil, fmt.Errorf(errs.FmtJobNextRoundFail, err)
	}

	promptText := originalPrompt
	if strings.TrimSpace(payload.NextPromptOverride) != "" {
		promptText = strings.TrimSpace(payload.NextPromptOverride)
	} else if nextRound > 1 {
		// 后续轮次：使用上一轮的 next_prompt，如果没有则用原始提示词
		prev, err := s.store.GetLatestAiReviewRound(payload.ModelRunID, payload.LocalPath)
		if err != nil {
			return nil, fmt.Errorf(errs.FmtJobReadPrevReviewFail, err)
		}
		if prev != nil {
			suggested := strings.TrimSpace(prev.NextPrompt)
			if suggested != "" && suggested != "无" {
				promptText = suggested
			}
		}
	}

	roundID := uuid.New().String()
	now := time.Now().Unix()
	round := store.AiReviewRound{
		ID:             roundID,
		TaskID:         normalizedTaskID,
		ModelRunID:     payload.ModelRunID,
		LocalPath:      payload.LocalPath,
		ModelName:      firstNonEmpty(strings.TrimSpace(payload.ModelName), filepath.Base(payload.LocalPath)),
		RoundNumber:    nextRound,
		OriginalPrompt: originalPrompt,
		PromptText:     promptText,
		Status:         "none",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.store.CreateAiReviewRound(round); err != nil {
		return nil, fmt.Errorf(errs.FmtJobCreateReviewRoundFail, err)
	}
	return s.store.GetAiReviewRound(roundID)
}

func (s *JobService) syncModelRunAiReviewSummaryFromRounds(modelRunID string) error {
	rounds, err := s.store.ListAiReviewRoundsByModelRun(modelRunID)
	if err != nil {
		return err
	}
	status, round, notes := store.SummarizeAiReviewRounds(rounds)
	return s.store.UpdateModelRunReview(modelRunID, status, round, notes)
}

func normalizeAiReviewRoundLabel(round store.AiReviewRound) string {
	modelName := strings.TrimSpace(round.ModelName)
	if modelName != "" {
		return modelName
	}
	if pathBase := filepath.Base(strings.TrimSpace(round.LocalPath)); pathBase != "" && pathBase != "." {
		return pathBase
	}
	return round.ID
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func ternaryAiReviewResultText(passed bool) string {
	if passed {
		return "通过"
	}
	return "未通过"
}

func normalizeAiReviewPath(localPath string) string {
	trimmed := strings.TrimSpace(localPath)
	if trimmed == "" {
		return ""
	}
	return filepath.Clean(trimmed)
}

func isStructuredAiReviewLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || !strings.HasPrefix(trimmed, "{") {
		return false
	}

	var result appcli.CodexReviewResult
	return json.Unmarshal([]byte(trimmed), &result) == nil
}

func strPtr(s string) *string {
	return &s
}

func boolPtr(value bool) *bool {
	return &value
}

func (s *JobService) cloneSemaphore() chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cloneSem == nil {
		s.cloneSem = make(chan struct{}, gitCloneConcurrencyLimit)
	}
	return s.cloneSem
}

func (s *JobService) acquireGitCloneSlot(ctx context.Context) (func(), error) {
	sem := s.cloneSemaphore()
	select {
	case sem <- struct{}{}:
		return func() { <-sem }, nil
	case <-ctx.Done():
		return nil, gitCloneContextErr(ctx)
	}
}

func (s *JobService) executeGitCloneAttempt(
	ctx context.Context,
	jobID string,
	req SubmitJobRequest,
	payload GitClonePayload,
	sourceModelID string,
	attempt int,
	start time.Time,
) (jobExecutionResult, error) {
	attemptMessage := fmt.Sprintf("准备拉取源码（第 %d/%d 次）…", attempt, gitCloneRetryAttempts)
	s.emitProgress(jobID, req.JobType, req.TaskID, "running", 10, &attemptMessage, nil)

	cloneCtx, stopCloneWatch, heartbeat := newGitCloneProgressContext(ctx, gitCloneIdleTimeout)
	defer stopCloneWatch()

	if err := s.gitSvc.CloneConfiguredProjectWithContext(
		cloneCtx,
		payload.CloneURL,
		payload.SourcePath,
		func(msg string) {
			heartbeat()
			progressMsg := msg
			s.emitProgress(jobID, req.JobType, req.TaskID, "running", 20, &progressMsg, nil)
		},
	); err != nil {
		return jobExecutionResult{}, err
	}

	resultPayload := GitCloneResult{
		SourcePath:       payload.SourcePath,
		SuccessfulModels: []string{sourceModelID},
		FailedModels:     make([]GitCloneFailure, 0),
	}

	total := len(payload.CopyTargets)
	for i, target := range payload.CopyTargets {
		if contextErr := gitCloneContextErr(ctx); contextErr != nil {
			return jobExecutionResult{}, contextErr
		}
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
		if err := s.gitSvc.CopyProjectDirectory(ctx, payload.SourcePath, target.Path); err != nil {
			resultPayload.FailedModels = append(resultPayload.FailedModels, GitCloneFailure{
				ModelID: target.ModelID,
				Message: err.Error(),
			})
			continue
		}
		resultPayload.SuccessfulModels = append(resultPayload.SuccessfulModels, target.ModelID)
	}

	outputJSON, _ := json.Marshal(resultPayload)
	outputStr := string(outputJSON)
	totalModels := len(payload.CopyTargets) + 1
	slog.Info("git clone completed",
		"clone_url", payload.CloneURL,
		"success_count", len(resultPayload.SuccessfulModels),
		"failed_count", len(resultPayload.FailedModels),
		"total", totalModels,
		"attempt", attempt,
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

func newGitCloneProgressContext(
	parent context.Context,
	idleTimeout time.Duration,
) (context.Context, func(), func()) {
	ctx, cancel := context.WithCancelCause(parent)
	heartbeatCh := make(chan struct{}, 1)

	go func() {
		timer := time.NewTimer(idleTimeout)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-heartbeatCh:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(idleTimeout)
			case <-timer.C:
				cancel(errGitCloneIdleTimeout)
				return
			}
		}
	}()

	heartbeat := func() {
		select {
		case heartbeatCh <- struct{}{}:
		default:
		}
	}

	stop := func() {
		cancel(nil)
	}
	return ctx, stop, heartbeat
}

func (s *JobService) ensureGitCloneTargetsAvailable(payload GitClonePayload) error {
	return s.ensureTargetPathsAvailable(gitCloneTargetPaths(payload))
}

func (s *JobService) ensureTargetPathsAvailable(paths []string) error {
	if len(paths) == 0 {
		return errors.New(errs.MsgJobMissingCloneTarget)
	}
	existing := s.gitSvc.CheckPathsExist(paths)
	if len(existing) == 0 {
		return nil
	}

	names := make([]string, 0, len(existing))
	for _, path := range existing {
		names = append(names, filepath.Base(util.NormalizePath(path)))
	}
	sort.Strings(names)
	return fmt.Errorf(errs.FmtJobDirConflict, strings.Join(names, ", "))
}

func cleanupGitCloneTargets(payload GitClonePayload) error {
	return cleanupTargetPaths(gitCloneTargetPaths(payload))
}

func cleanupTargetPaths(paths []string) error {
	sort.Slice(paths, func(i, j int) bool {
		return len(paths[i]) > len(paths[j])
	})
	for _, path := range paths {
		normalized := util.NormalizePath(path)
		if !isSafeGitCloneCleanupPath(normalized) {
			return fmt.Errorf(errs.FmtJobRefuseUnsafeClean, path)
		}
		if err := os.RemoveAll(normalized); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func cleanupGitCloneTargetsAfterAbort(payload GitClonePayload, abortErr error) error {
	if err := cleanupTargetPaths(gitCloneTargetPaths(payload)); err != nil {
		slog.Error("git clone cleanup after abort failed",
			"source_path", payload.SourcePath,
			"error", err,
		)
		return errors.Join(abortErr, fmt.Errorf(errs.FmtJobCleanAbortResidualFail, err))
	}
	return abortErr
}

func gitCloneTargetPaths(payload GitClonePayload) []string {
	return targetPathsFromSourceAndCopies(payload.SourcePath, payload.CopyTargets)
}

func cleanupTargetPathsAfterAbort(paths []string, abortErr error) error {
	if err := cleanupTargetPaths(paths); err != nil {
		return errors.Join(abortErr, fmt.Errorf(errs.FmtJobCleanAbortResidualFail, err))
	}
	return abortErr
}

func targetPathsFromSourceAndCopies(sourcePath string, copyTargets []GitCloneCopyTarget) []string {
	seen := make(map[string]struct{}, len(copyTargets)+1)
	paths := make([]string, 0, len(copyTargets)+1)
	appendPath := func(path string) {
		normalized := util.NormalizePath(path)
		if normalized == "" {
			return
		}
		if _, ok := seen[normalized]; ok {
			return
		}
		seen[normalized] = struct{}{}
		paths = append(paths, normalized)
	}

	appendPath(sourcePath)
	for _, target := range copyTargets {
		appendPath(target.Path)
	}
	return paths
}

func isSafeGitCloneCleanupPath(path string) bool {
	if path == "" || path == string(os.PathSeparator) || path == "." {
		return false
	}
	clean := filepath.Clean(path)
	if clean == string(os.PathSeparator) || clean == "." {
		return false
	}
	home, err := os.UserHomeDir()
	if err == nil && util.SamePath(clean, home) {
		return false
	}
	return len(strings.Split(clean, string(os.PathSeparator))) >= 4
}

func summarizeGitCloneError(err error) string {
	if err == nil {
		return "未知错误"
	}
	msg := strings.TrimSpace(err.Error())
	if len([]rune(msg)) <= 80 {
		return msg
	}
	runes := []rune(msg)
	return string(runes[:80]) + "..."
}

func gitCloneContextErr(ctx context.Context) error {
	if ctx == nil || ctx.Err() == nil {
		return nil
	}
	if cause := context.Cause(ctx); cause != nil && !errors.Is(cause, context.Canceled) {
		return cause
	}
	return ctx.Err()
}
