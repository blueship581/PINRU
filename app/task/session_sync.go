package task

import (
	"fmt"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/store"
)

const defaultSessionSyncTaskType = "未归类"

type SyncTaskSessionsTarget struct {
	ModelName      string `json:"modelName"`
	ModelRunID     string `json:"modelRunId"`
	SessionCount   int    `json:"sessionCount"`
	WorkspacePath  string `json:"workspacePath"`
	MatchedPath    string `json:"matchedPath"`
	UserID         string `json:"userId"`
	Username       string `json:"username"`
	LastActivityAt *int64 `json:"lastActivityAt"`
}

type SyncTaskSessionsResult struct {
	TaskID             string                   `json:"taskId"`
	CandidateCount     int                      `json:"candidateCount"`
	UpdatedTargetCount int                      `json:"updatedTargetCount"`
	Targets            []SyncTaskSessionsTarget `json:"targets"`
}

func (s *TaskService) SyncLatestTaskSessions(taskID string) (*SyncTaskSessionsResult, error) {
	task, err := s.store.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("题卡 %q 不存在", taskID)
	}

	modelRuns, err := s.store.ListModelRuns(taskID)
	if err != nil {
		return nil, err
	}

	extractResult, err := s.ExtractTaskSessions(taskID)
	if err != nil {
		return nil, err
	}

	result := &SyncTaskSessionsResult{
		TaskID:         taskID,
		CandidateCount: len(extractResult.Candidates),
		Targets:        []SyncTaskSessionsTarget{},
	}
	if len(extractResult.Candidates) == 0 {
		return result, nil
	}

	targetRuns, err := s.sessionSyncTargetRuns(task, modelRuns)
	if err != nil {
		return nil, err
	}

	if len(targetRuns) == 0 {
		bestCandidate := selectBestCandidateForPath(extractResult.Candidates, task.LocalPath)
		if bestCandidate == nil {
			return result, nil
		}

		nextSessions := buildTaskSessionsFromCandidate(*bestCandidate, task.SessionList, task.TaskType)
		if len(nextSessions) == 0 {
			return result, nil
		}
		if err := s.store.UpdateTaskSessionList(taskID, nextSessions); err != nil {
			return nil, err
		}

		result.UpdatedTargetCount = 1
		result.Targets = append(result.Targets, buildSyncTaskSessionsTarget("", "", *bestCandidate))
		return result, nil
	}

	for _, run := range targetRuns {
		bestCandidate := selectBestCandidateForPath(extractResult.Candidates, run.LocalPath)
		if bestCandidate == nil {
			continue
		}

		nextSessions := buildTaskSessionsFromCandidate(*bestCandidate, run.SessionList, task.TaskType)
		if len(nextSessions) == 0 {
			continue
		}
		if err := s.store.UpdateModelRunSessionList(taskID, run.ID, nextSessions); err != nil {
			return nil, err
		}

		result.UpdatedTargetCount += 1
		result.Targets = append(result.Targets, buildSyncTaskSessionsTarget(run.ModelName, run.ID, *bestCandidate))
	}

	return result, nil
}

func (s *TaskService) sessionSyncTargetRuns(task *store.Task, modelRuns []store.ModelRun) ([]store.ModelRun, error) {
	if len(modelRuns) == 0 {
		return nil, nil
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

	runsWithPath := make([]store.ModelRun, 0, len(modelRuns))
	executionRuns := make([]store.ModelRun, 0, len(modelRuns))
	for _, run := range modelRuns {
		if run.LocalPath == nil || strings.TrimSpace(*run.LocalPath) == "" {
			continue
		}

		runsWithPath = append(runsWithPath, run)
		if isOriginModelName(run.ModelName) || isSourceModelFolder(run.ModelName, sourceModelName) {
			continue
		}
		executionRuns = append(executionRuns, run)
	}

	if len(executionRuns) > 0 {
		return executionRuns, nil
	}
	return runsWithPath, nil
}

func selectBestCandidateForPath(
	candidates []ExtractTaskSessionCandidate,
	localPath *string,
) *ExtractTaskSessionCandidate {
	if localPath == nil || strings.TrimSpace(*localPath) == "" {
		return nil
	}

	for index := range candidates {
		if candidateMatchesLocalPath(candidates[index], *localPath) {
			return &candidates[index]
		}
	}
	return nil
}

func candidateMatchesLocalPath(candidate ExtractTaskSessionCandidate, localPath string) bool {
	targets := []string{strings.TrimSpace(localPath)}
	if targets[0] == "" {
		return false
	}

	if _, _, _, ok := bestTraeWorkspacePathMatch(candidate.WorkspacePath, targets); ok {
		return true
	}
	if candidate.MatchedPath != "" {
		if _, _, _, ok := bestTraeWorkspacePathMatch(candidate.MatchedPath, targets); ok {
			return true
		}
	}
	return false
}

func buildTaskSessionsFromCandidate(
	candidate ExtractTaskSessionCandidate,
	previousSessions []store.TaskSession,
	fallbackTaskType string,
) []store.TaskSession {
	if len(candidate.Sessions) == 0 {
		return nil
	}

	normalizedTaskType := strings.TrimSpace(fallbackTaskType)
	if normalizedTaskType == "" {
		normalizedTaskType = defaultSessionSyncTaskType
	}

	extractedAt := time.Now().Unix()
	sessions := make([]store.TaskSession, 0, len(candidate.Sessions))
	for index, extractedSession := range candidate.Sessions {
		previousSession, hasPrevious := store.TaskSession{}, false
		if index < len(previousSessions) {
			previousSession = previousSessions[index]
			hasPrevious = true
		}

		taskType := normalizedTaskType
		if hasPrevious && strings.TrimSpace(previousSession.TaskType) != "" {
			taskType = strings.TrimSpace(previousSession.TaskType)
		}

		isCompleted := true
		if hasPrevious && previousSession.IsCompleted != nil {
			isCompleted = *previousSession.IsCompleted
		}
		isSatisfied := true
		if hasPrevious && previousSession.IsSatisfied != nil {
			isSatisfied = *previousSession.IsSatisfied
		}

		consumeQuota := index == 0
		if index > 0 && hasPrevious {
			consumeQuota = previousSession.ConsumeQuota
		}

		userConversation := strings.TrimSpace(extractedSession.UserConversation)
		if userConversation == "" && hasPrevious {
			userConversation = strings.TrimSpace(previousSession.UserConversation)
		}

		evaluation := ""
		if hasPrevious {
			evaluation = strings.TrimSpace(previousSession.Evaluation)
		}

		sessions = append(sessions, store.TaskSession{
			SessionID:        strings.TrimSpace(extractedSession.SessionID),
			TaskType:         taskType,
			ConsumeQuota:     consumeQuota,
			IsCompleted:      boolPtr(isCompleted),
			IsSatisfied:      boolPtr(isSatisfied),
			Evaluation:       evaluation,
			UserConversation: userConversation,
			Evidence:         buildTaskSessionEvidence(candidate, extractedSession, extractedAt),
		})
	}

	return sessions
}

func buildTaskSessionEvidence(
	candidate ExtractTaskSessionCandidate,
	extractedSession ExtractedTraeSession,
	extractedAt int64,
) *store.TaskSessionEvidence {
	username := strings.TrimSpace(candidate.Username)
	if username == "" {
		username = strings.TrimSpace(candidate.UserID)
	}

	extractedAtCopy := extractedAt
	var lastActivityAt *int64
	if extractedSession.LastActivityAt != nil {
		next := *extractedSession.LastActivityAt
		lastActivityAt = &next
	}

	return &store.TaskSessionEvidence{
		WorkspacePath:  strings.TrimSpace(candidate.WorkspacePath),
		MatchedPath:    strings.TrimSpace(candidate.MatchedPath),
		MatchKind:      strings.TrimSpace(candidate.MatchKind),
		UserID:         strings.TrimSpace(candidate.UserID),
		Username:       username,
		Summary:        strings.TrimSpace(candidate.Summary),
		IsCurrent:      extractedSession.IsCurrent,
		LastActivityAt: lastActivityAt,
		ExtractedAt:    &extractedAtCopy,
	}
}

func buildSyncTaskSessionsTarget(
	modelName string,
	modelRunID string,
	candidate ExtractTaskSessionCandidate,
) SyncTaskSessionsTarget {
	username := strings.TrimSpace(candidate.Username)
	if username == "" {
		username = strings.TrimSpace(candidate.UserID)
	}

	return SyncTaskSessionsTarget{
		ModelName:      strings.TrimSpace(modelName),
		ModelRunID:     strings.TrimSpace(modelRunID),
		SessionCount:   len(candidate.Sessions),
		WorkspacePath:  strings.TrimSpace(candidate.WorkspacePath),
		MatchedPath:    strings.TrimSpace(candidate.MatchedPath),
		UserID:         strings.TrimSpace(candidate.UserID),
		Username:       username,
		LastActivityAt: candidate.LastActivityAt,
	}
}

func isOriginModelName(modelName string) bool {
	return strings.EqualFold(strings.TrimSpace(modelName), "ORIGIN")
}

func isSourceModelFolder(modelName, sourceModelName string) bool {
	return strings.EqualFold(strings.TrimSpace(modelName), strings.TrimSpace(sourceModelName))
}

func boolPtr(value bool) *bool {
	next := value
	return &next
}
