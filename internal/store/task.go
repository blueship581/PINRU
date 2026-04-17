package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/errs"
)

const defaultTaskType = "未归类"

type Task struct {
	ID                         string        `json:"id"`
	GitLabProjectID            int64         `json:"gitlabProjectId"`
	ProjectName                string        `json:"projectName"`
	Status                     string        `json:"status"`
	TaskType                   string        `json:"taskType"`
	SessionList                []TaskSession `json:"sessionList"`
	LocalPath                  *string       `json:"localPath"`
	PromptText                 *string       `json:"promptText"`
	PromptGenerationStatus     string        `json:"promptGenerationStatus"`
	PromptGenerationError      *string       `json:"promptGenerationError"`
	PromptGenerationStartedAt  *int64        `json:"promptGenerationStartedAt"`
	PromptGenerationFinishedAt *int64        `json:"promptGenerationFinishedAt"`
	Notes                      *string       `json:"notes"`
	ProjectConfigID            *string       `json:"projectConfigId"`
	ProjectType                string        `json:"projectType"`
	ChangeScope                string        `json:"changeScope"`
	CreatedAt                  int64         `json:"createdAt"`
	UpdatedAt                  int64         `json:"updatedAt"`
}

type TaskSessionEvidence struct {
	WorkspacePath  string `json:"workspacePath"`
	MatchedPath    string `json:"matchedPath"`
	MatchKind      string `json:"matchKind"`
	UserID         string `json:"userId"`
	Username       string `json:"username"`
	Summary        string `json:"summary"`
	IsCurrent      bool   `json:"isCurrent"`
	LastActivityAt *int64 `json:"lastActivityAt"`
	ExtractedAt    *int64 `json:"extractedAt"`
}

type TaskSession struct {
	SessionID        string               `json:"sessionId"`
	TaskType         string               `json:"taskType"`
	ConsumeQuota     bool                 `json:"consumeQuota"`
	IsCompleted      *bool                `json:"isCompleted"`
	IsSatisfied      *bool                `json:"isSatisfied"`
	Evaluation       string               `json:"evaluation"`
	UserConversation string               `json:"userConversation"`
	Evidence         *TaskSessionEvidence `json:"evidence"`
}

func cloneBoolPtr(value *bool) *bool {
	if value == nil {
		return nil
	}

	next := *value
	return &next
}

func cloneInt64Ptr(value *int64) *int64 {
	if value == nil {
		return nil
	}

	next := *value
	return &next
}

func cloneTaskSessionEvidence(value *TaskSessionEvidence) *TaskSessionEvidence {
	if value == nil {
		return nil
	}

	return &TaskSessionEvidence{
		WorkspacePath:  strings.TrimSpace(value.WorkspacePath),
		MatchedPath:    strings.TrimSpace(value.MatchedPath),
		MatchKind:      strings.TrimSpace(value.MatchKind),
		UserID:         strings.TrimSpace(value.UserID),
		Username:       strings.TrimSpace(value.Username),
		Summary:        strings.TrimSpace(value.Summary),
		IsCurrent:      value.IsCurrent,
		LastActivityAt: cloneInt64Ptr(value.LastActivityAt),
		ExtractedAt:    cloneInt64Ptr(value.ExtractedAt),
	}
}

func defaultTaskSessionList(taskType string) []TaskSession {
	normalizedTaskType := strings.TrimSpace(taskType)
	if normalizedTaskType == "" {
		normalizedTaskType = defaultTaskType
	}

	return []TaskSession{
		{
			SessionID:        "",
			TaskType:         normalizedTaskType,
			ConsumeQuota:     true,
			UserConversation: "",
		},
	}
}

func normalizeTaskSessionList(taskType string, sessions []TaskSession) ([]TaskSession, error) {
	normalizedTaskType := strings.TrimSpace(taskType)
	if normalizedTaskType == "" {
		normalizedTaskType = defaultTaskType
	}

	if len(sessions) == 0 {
		return defaultTaskSessionList(normalizedTaskType), nil
	}

	normalized := make([]TaskSession, 0, len(sessions))
	for index, session := range sessions {
		nextTaskType := strings.TrimSpace(session.TaskType)
		if nextTaskType == "" {
			if index == 0 {
				nextTaskType = normalizedTaskType
			} else {
				return nil, fmt.Errorf(errs.FmtSessionTypeRequired, index+1)
			}
		}

		normalized = append(normalized, TaskSession{
			SessionID:        strings.TrimSpace(session.SessionID),
			TaskType:         nextTaskType,
			ConsumeQuota:     index == 0 || session.ConsumeQuota,
			IsCompleted:      cloneBoolPtr(session.IsCompleted),
			IsSatisfied:      cloneBoolPtr(session.IsSatisfied),
			Evaluation:       strings.TrimSpace(session.Evaluation),
			UserConversation: strings.TrimSpace(session.UserConversation),
			Evidence:         cloneTaskSessionEvidence(session.Evidence),
		})
	}

	normalized[0].ConsumeQuota = true
	return normalized, nil
}

func parseTaskSessionListWithMode(rawSessionList, taskType string, emptyAsDefault bool) ([]TaskSession, error) {
	trimmed := strings.TrimSpace(rawSessionList)
	if trimmed == "" || trimmed == "[]" || strings.EqualFold(trimmed, "null") {
		if emptyAsDefault {
			return defaultTaskSessionList(taskType), nil
		}
		return []TaskSession{}, nil
	}

	var sessions []TaskSession
	if err := json.Unmarshal([]byte(trimmed), &sessions); err != nil {
		return nil, fmt.Errorf(errs.FmtStoreInvalidSessionListJSON, err)
	}

	return normalizeTaskSessionList(taskType, sessions)
}

func parseTaskSessionList(rawSessionList, taskType string) ([]TaskSession, error) {
	return parseTaskSessionListWithMode(rawSessionList, taskType, true)
}

func parseOptionalTaskSessionList(rawSessionList, taskType string) ([]TaskSession, error) {
	return parseTaskSessionListWithMode(rawSessionList, taskType, false)
}

func marshalTaskSessionList(taskType string, sessions []TaskSession) (string, []TaskSession, error) {
	normalized, err := normalizeTaskSessionList(taskType, sessions)
	if err != nil {
		return "", nil, err
	}

	payload, err := json.Marshal(normalized)
	if err != nil {
		return "", nil, err
	}

	return string(payload), normalized, nil
}

func validateTaskSessionReviewFields(sessions []TaskSession) error {
	for index, session := range sessions {
		if session.IsCompleted == nil {
			return fmt.Errorf(errs.FmtSessionDoneRequired, index+1)
		}
		if session.IsSatisfied == nil {
			return fmt.Errorf(errs.FmtSessionLikedReq, index+1)
		}
	}

	return nil
}

func countedTaskTypeSessions(sessions []TaskSession) map[string]int {
	counts := make(map[string]int)
	for _, session := range sessions {
		if !session.ConsumeQuota {
			continue
		}
		counts[session.TaskType]++
	}
	return counts
}

func applyTaskSessionQuotaDelta(quotas map[string]int, previousSessions, nextSessions []TaskSession, enforceLimit bool) error {
	previousCounts := countedTaskTypeSessions(previousSessions)
	nextCounts := countedTaskTypeSessions(nextSessions)

	taskTypes := make(map[string]struct{}, len(previousCounts)+len(nextCounts))
	for taskType := range previousCounts {
		taskTypes[taskType] = struct{}{}
	}
	for taskType := range nextCounts {
		taskTypes[taskType] = struct{}{}
	}

	for taskType := range taskTypes {
		delta := nextCounts[taskType] - previousCounts[taskType]
		if delta == 0 {
			continue
		}

		currentQuota, hasQuota := quotas[taskType]
		if !hasQuota {
			continue
		}

		if delta > 0 {
			if enforceLimit && currentQuota < delta {
				return fmt.Errorf(errs.FmtTaskTypeQuotaUsedUp, taskType)
			}
			quotas[taskType] = currentQuota - delta
			continue
		}

		quotas[taskType] = currentQuota - delta
	}

	return nil
}

func (s *Store) ListTasks(projectConfigID *string) ([]Task, error) {
	selectSQL := fmt.Sprintf(
		`SELECT id, gitlab_project_id, project_name, status, task_type, session_list, local_path, prompt_text,
		        prompt_generation_status, prompt_generation_error, %s, %s,
		        notes, project_config_id, project_type, change_scope, %s, %s FROM tasks`,
		nullableUnixTimestampExpr("prompt_generation_started_at"),
		nullableUnixTimestampExpr("prompt_generation_finished_at"),
		unixTimestampExpr("created_at"),
		unixTimestampExpr("updated_at"),
	)

	var rows *sql.Rows
	var err error
	if projectConfigID != nil && *projectConfigID != "" {
		rows, err = s.DB.Query(
			selectSQL+" WHERE project_config_id = ? ORDER BY created_at DESC",
			*projectConfigID)
	} else {
		rows, err = s.DB.Query(
			selectSQL + " ORDER BY created_at DESC")
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []Task
	for rows.Next() {
		var t Task
		var rawSessionList string
		if err := rows.Scan(
			&t.ID, &t.GitLabProjectID, &t.ProjectName, &t.Status, &t.TaskType, &rawSessionList, &t.LocalPath, &t.PromptText,
			&t.PromptGenerationStatus, &t.PromptGenerationError, &t.PromptGenerationStartedAt, &t.PromptGenerationFinishedAt,
			&t.Notes, &t.ProjectConfigID, &t.ProjectType, &t.ChangeScope, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		t.SessionList, err = parseTaskSessionList(rawSessionList, t.TaskType)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

func (s *Store) GetTask(id string) (*Task, error) {
	var t Task
	query := fmt.Sprintf(
		`SELECT id, gitlab_project_id, project_name, status, task_type, session_list, local_path, prompt_text,
		        prompt_generation_status, prompt_generation_error, %s, %s,
		        notes, project_config_id, project_type, change_scope, %s, %s FROM tasks WHERE id = ?`,
		nullableUnixTimestampExpr("prompt_generation_started_at"),
		nullableUnixTimestampExpr("prompt_generation_finished_at"),
		unixTimestampExpr("created_at"),
		unixTimestampExpr("updated_at"),
	)
	var rawSessionList string
	err := s.DB.QueryRow(query, id).
		Scan(
			&t.ID, &t.GitLabProjectID, &t.ProjectName, &t.Status, &t.TaskType, &rawSessionList, &t.LocalPath, &t.PromptText,
			&t.PromptGenerationStatus, &t.PromptGenerationError, &t.PromptGenerationStartedAt, &t.PromptGenerationFinishedAt,
			&t.Notes, &t.ProjectConfigID, &t.ProjectType, &t.ChangeScope, &t.CreatedAt, &t.UpdatedAt,
		)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.SessionList, err = parseTaskSessionList(rawSessionList, t.TaskType)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) FindTaskByProjectConfigAndGitLabProjectID(projectConfigID string, gitLabProjectID int64) (*Task, error) {
	projectConfigID = strings.TrimSpace(projectConfigID)
	if projectConfigID == "" {
		return nil, fmt.Errorf(errs.MsgProjectConfigIDReq)
	}

	var t Task
	query := fmt.Sprintf(
		`SELECT id, gitlab_project_id, project_name, status, task_type, session_list, local_path, prompt_text,
		        prompt_generation_status, prompt_generation_error, %s, %s,
		        notes, project_config_id, project_type, change_scope, %s, %s
		   FROM tasks
		  WHERE project_config_id = ? AND gitlab_project_id = ?
		  ORDER BY created_at DESC
		  LIMIT 1`,
		nullableUnixTimestampExpr("prompt_generation_started_at"),
		nullableUnixTimestampExpr("prompt_generation_finished_at"),
		unixTimestampExpr("created_at"),
		unixTimestampExpr("updated_at"),
	)

	var rawSessionList string
	err := s.DB.QueryRow(query, projectConfigID, gitLabProjectID).
		Scan(
			&t.ID, &t.GitLabProjectID, &t.ProjectName, &t.Status, &t.TaskType, &rawSessionList, &t.LocalPath, &t.PromptText,
			&t.PromptGenerationStatus, &t.PromptGenerationError, &t.PromptGenerationStartedAt, &t.PromptGenerationFinishedAt,
			&t.Notes, &t.ProjectConfigID, &t.ProjectType, &t.ChangeScope, &t.CreatedAt, &t.UpdatedAt,
		)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	t.SessionList, err = parseTaskSessionList(rawSessionList, t.TaskType)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Store) CreateTask(t Task) error {
	now := time.Now().Unix()
	taskType := t.TaskType
	if taskType == "" {
		taskType = defaultTaskType
	}
	sessionListJSON, _, err := marshalTaskSessionList(taskType, t.SessionList)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(
		"INSERT INTO tasks (id, gitlab_project_id, project_name, status, task_type, session_list, local_path, notes, project_config_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		t.ID, t.GitLabProjectID, t.ProjectName, "Claimed", taskType, sessionListJSON, t.LocalPath, t.Notes, t.ProjectConfigID, now, now)
	return err
}

func (s *Store) CreateTaskWithModelRuns(t Task, runs []ModelRun) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	now := time.Now().Unix()
	taskType := t.TaskType
	if taskType == "" {
		taskType = defaultTaskType
	}
	sessionListJSON, _, err := marshalTaskSessionList(taskType, t.SessionList)
	if err != nil {
		return err
	}

	if _, err = tx.Exec(
		"INSERT INTO tasks (id, gitlab_project_id, project_name, status, task_type, session_list, local_path, notes, project_config_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
		t.ID, t.GitLabProjectID, t.ProjectName, "Claimed", taskType, sessionListJSON, t.LocalPath, t.Notes, t.ProjectConfigID, now, now); err != nil {
		return err
	}

	for _, run := range runs {
		if _, err = tx.Exec(
			"INSERT INTO model_runs (id, task_id, model_name, local_path, status) VALUES (?,?,?,?,?)",
			run.ID, run.TaskID, run.ModelName, run.LocalPath, "pending"); err != nil {
			return err
		}
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (s *Store) UpdateTaskStatus(id, status string) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec("UPDATE tasks SET status=?, updated_at=? WHERE id=?", status, now, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}
	return nil
}

func (s *Store) UpdateTaskType(id, nextTaskType string) error {
	nextTaskType = strings.TrimSpace(nextTaskType)
	if nextTaskType == "" {
		return fmt.Errorf(errs.MsgStoreTaskTypeRequired)
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var (
		currentTaskType string
		projectConfigID sql.NullString
		rawSessionList  string
	)
	if err = tx.QueryRow("SELECT task_type, project_config_id, session_list FROM tasks WHERE id = ?", id).
		Scan(&currentTaskType, &projectConfigID, &rawSessionList); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
		}
		return err
	}

	currentSessions, parseErr := parseTaskSessionList(rawSessionList, currentTaskType)
	if parseErr != nil {
		err = parseErr
		return err
	}
	nextSessionList := make([]TaskSession, len(currentSessions))
	copy(nextSessionList, currentSessions)
	nextSessionList[0].TaskType = nextTaskType
	sessionListJSON, normalizedSessions, marshalErr := marshalTaskSessionList(nextTaskType, nextSessionList)
	if marshalErr != nil {
		err = marshalErr
		return err
	}

	if currentTaskType == nextTaskType {
		if err = tx.Commit(); err != nil {
			return err
		}
		committed = true
		return nil
	}

	now := time.Now().Unix()
	if projectConfigID.Valid && strings.TrimSpace(projectConfigID.String) != "" {
		var quotaJSON string
		projectErr := tx.QueryRow("SELECT task_type_quotas FROM projects WHERE id = ?", projectConfigID.String).
			Scan(&quotaJSON)
		if projectErr != nil && projectErr != sql.ErrNoRows {
			err = projectErr
			return err
		}
		if projectErr == nil {
			quotas, parseQuotaErr := parseTaskTypeCountMap(quotaJSON)
			if parseQuotaErr != nil {
				err = parseQuotaErr
				return err
			}

			if adjustErr := applyTaskSessionQuotaDelta(quotas, currentSessions, normalizedSessions, false); adjustErr != nil {
				err = adjustErr
				return err
			}

			updatedQuotaJSON, marshalErr := marshalTaskTypeCountMap(quotas)
			if marshalErr != nil {
				err = marshalErr
				return err
			}

			if _, execErr := tx.Exec(
				"UPDATE projects SET task_type_quotas=?, updated_at=? WHERE id=?",
				string(updatedQuotaJSON), now, projectConfigID.String,
			); execErr != nil {
				err = execErr
				return err
			}
		}
	}

	res, execErr := tx.Exec("UPDATE tasks SET task_type=?, session_list=?, updated_at=? WHERE id=?", nextTaskType, sessionListJSON, now, id)
	if execErr != nil {
		err = execErr
		return err
	}
	rowsAffected, rowsErr := res.RowsAffected()
	if rowsErr != nil {
		err = rowsErr
		return err
	}
	if rowsAffected == 0 {
		err = fmt.Errorf(errs.FmtStoreTaskNotFound, id)
		return err
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (s *Store) UpdateTaskReportFields(id, projectType, changeScope string) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec(
		"UPDATE tasks SET project_type=?, change_scope=?, updated_at=? WHERE id=?",
		strings.TrimSpace(projectType), strings.TrimSpace(changeScope), now, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}
	return nil
}

func (s *Store) UpdateTaskSessionList(id string, sessionList []TaskSession) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var (
		currentTaskType string
		projectConfigID sql.NullString
		rawSessionList  string
	)
	if err = tx.QueryRow("SELECT task_type, project_config_id, session_list FROM tasks WHERE id = ?", id).
		Scan(&currentTaskType, &projectConfigID, &rawSessionList); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
		}
		return err
	}

	currentSessions, parseErr := parseTaskSessionList(rawSessionList, currentTaskType)
	if parseErr != nil {
		return parseErr
	}

	sessionListJSON, normalizedSessions, marshalErr := marshalTaskSessionList(currentTaskType, sessionList)
	if marshalErr != nil {
		return marshalErr
	}
	if validateErr := validateTaskSessionReviewFields(normalizedSessions); validateErr != nil {
		return validateErr
	}

	nextTaskType := normalizedSessions[0].TaskType
	now := time.Now().Unix()

	if projectConfigID.Valid && strings.TrimSpace(projectConfigID.String) != "" {
		var quotaJSON string
		projectErr := tx.QueryRow("SELECT task_type_quotas FROM projects WHERE id = ?", projectConfigID.String).
			Scan(&quotaJSON)
		if projectErr != nil && projectErr != sql.ErrNoRows {
			return projectErr
		}
		if projectErr == nil {
			quotas, parseQuotaErr := parseTaskTypeCountMap(quotaJSON)
			if parseQuotaErr != nil {
				return parseQuotaErr
			}

			if adjustErr := applyTaskSessionQuotaDelta(quotas, currentSessions, normalizedSessions, false); adjustErr != nil {
				return adjustErr
			}

			updatedQuotaJSON, marshalQuotaErr := marshalTaskTypeCountMap(quotas)
			if marshalQuotaErr != nil {
				return marshalQuotaErr
			}

			if _, execErr := tx.Exec(
				"UPDATE projects SET task_type_quotas=?, updated_at=? WHERE id=?",
				string(updatedQuotaJSON), now, projectConfigID.String,
			); execErr != nil {
				return execErr
			}
		}
	}

	res, execErr := tx.Exec(
		"UPDATE tasks SET task_type=?, session_list=?, updated_at=? WHERE id=?",
		nextTaskType, sessionListJSON, now, id,
	)
	if execErr != nil {
		return execErr
	}
	rowsAffected, rowsErr := res.RowsAffected()
	if rowsErr != nil {
		return rowsErr
	}
	if rowsAffected == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func latestTaskSessionSummary(sessions []TaskSession, now int64) (*string, int, *int64) {
	conversationRounds := len(sessions)

	var sessionID *string
	for index := len(sessions) - 1; index >= 0; index -= 1 {
		trimmed := strings.TrimSpace(sessions[index].SessionID)
		if trimmed == "" {
			continue
		}
		next := trimmed
		sessionID = &next
		break
	}

	var conversationDate *int64
	if conversationRounds > 0 {
		next := now
		conversationDate = &next
	}

	return sessionID, conversationRounds, conversationDate
}

func (s *Store) UpdateModelRunSessionList(taskID, modelRunID string, sessionList []TaskSession) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var (
		currentTaskType string
		projectConfigID sql.NullString
	)
	if err = tx.QueryRow("SELECT task_type, project_config_id FROM tasks WHERE id = ?", taskID).
		Scan(&currentTaskType, &projectConfigID); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf(errs.FmtStoreTaskNotFound, taskID)
		}
		return err
	}

	var rawSessionList string
	if err = tx.QueryRow("SELECT session_list FROM model_runs WHERE id = ? AND task_id = ?", modelRunID, taskID).
		Scan(&rawSessionList); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf(errs.FmtStoreModelRunNotFound, modelRunID)
		}
		return err
	}

	currentSessions, parseErr := parseOptionalTaskSessionList(rawSessionList, currentTaskType)
	if parseErr != nil {
		return parseErr
	}

	sessionListJSON, normalizedSessions, marshalErr := marshalTaskSessionList(currentTaskType, sessionList)
	if marshalErr != nil {
		return marshalErr
	}
	if validateErr := validateTaskSessionReviewFields(normalizedSessions); validateErr != nil {
		return validateErr
	}

	nextTaskType := normalizedSessions[0].TaskType
	now := time.Now().Unix()

	if projectConfigID.Valid && strings.TrimSpace(projectConfigID.String) != "" {
		var quotaJSON string
		projectErr := tx.QueryRow("SELECT task_type_quotas FROM projects WHERE id = ?", projectConfigID.String).
			Scan(&quotaJSON)
		if projectErr != nil && projectErr != sql.ErrNoRows {
			return projectErr
		}
		if projectErr == nil {
			quotas, parseQuotaErr := parseTaskTypeCountMap(quotaJSON)
			if parseQuotaErr != nil {
				return parseQuotaErr
			}

			if adjustErr := applyTaskSessionQuotaDelta(quotas, currentSessions, normalizedSessions, false); adjustErr != nil {
				return adjustErr
			}

			updatedQuotaJSON, marshalQuotaErr := marshalTaskTypeCountMap(quotas)
			if marshalQuotaErr != nil {
				return marshalQuotaErr
			}

			if _, execErr := tx.Exec(
				"UPDATE projects SET task_type_quotas=?, updated_at=? WHERE id=?",
				string(updatedQuotaJSON), now, projectConfigID.String,
			); execErr != nil {
				return execErr
			}
		}
	}

	sessionID, conversationRounds, conversationDate := latestTaskSessionSummary(normalizedSessions, now)
	runRes, execErr := tx.Exec(
		`UPDATE model_runs
		    SET session_list=?, session_id=?, conversation_rounds=?, conversation_date=?
		  WHERE id=? AND task_id=?`,
		sessionListJSON, sessionID, conversationRounds, conversationDate, modelRunID, taskID,
	)
	if execErr != nil {
		return execErr
	}
	runRowsAffected, runRowsErr := runRes.RowsAffected()
	if runRowsErr != nil {
		return runRowsErr
	}
	if runRowsAffected == 0 {
		return fmt.Errorf(errs.FmtStoreModelRunNotFound, modelRunID)
	}

	taskRes, taskExecErr := tx.Exec(
		"UPDATE tasks SET task_type=?, updated_at=? WHERE id=?",
		nextTaskType, now, taskID,
	)
	if taskExecErr != nil {
		return taskExecErr
	}
	taskRowsAffected, taskRowsErr := taskRes.RowsAffected()
	if taskRowsErr != nil {
		return taskRowsErr
	}
	if taskRowsAffected == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, taskID)
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (s *Store) UpdateTaskPrompt(id, promptText string) error {
	now := time.Now().Unix()
	return s.CompleteTaskPromptGeneration(id, promptText, now)
}

func (s *Store) SyncTaskPromptFromArtifact(id, promptText string) error {
	promptText = strings.TrimSpace(promptText)
	if promptText == "" {
		return fmt.Errorf(errs.MsgStorePromptTextRequired)
	}

	now := time.Now().Unix()
	res, err := s.DB.Exec(
		`UPDATE tasks
		 SET prompt_text=?,
		     status=CASE WHEN status IN ('Submitted', 'ExecutionCompleted') THEN status ELSE 'PromptReady' END,
		     prompt_generation_status='done',
		     prompt_generation_error=NULL,
		     prompt_generation_started_at=COALESCE(prompt_generation_started_at, ?),
		     prompt_generation_finished_at=?,
		     updated_at=?
		 WHERE id=?`,
		promptText, now, now, now, id,
	)
	if err != nil {
		return err
	}
	rowsAffected, rowsErr := res.RowsAffected()
	if rowsErr != nil {
		return rowsErr
	}
	if rowsAffected == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}
	return nil
}

func (s *Store) StartTaskPromptGeneration(id string, startedAt int64) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec(
		`UPDATE tasks
		 SET prompt_generation_status='running',
		     prompt_generation_error=NULL,
		     prompt_generation_started_at=?,
		     prompt_generation_finished_at=NULL,
		     updated_at=?
		 WHERE id=?`,
		startedAt, now, id,
	)
	if err != nil {
		return err
	}
	rowsAffected, rowsErr := res.RowsAffected()
	if rowsErr != nil {
		return rowsErr
	}
	if rowsAffected == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}
	return nil
}

func (s *Store) CompleteTaskPromptGeneration(id, promptText string, startedAt int64) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec(
		`UPDATE tasks
		 SET prompt_text=?,
		     status=CASE WHEN status IN ('Submitted', 'ExecutionCompleted') THEN status ELSE 'PromptReady' END,
		     prompt_generation_status='done',
		     prompt_generation_error=NULL,
		     prompt_generation_started_at=?,
		     prompt_generation_finished_at=?,
		     updated_at=?
		 WHERE id=?`,
		promptText, startedAt, now, now, id,
	)
	if err != nil {
		return err
	}
	rowsAffected, rowsErr := res.RowsAffected()
	if rowsErr != nil {
		return rowsErr
	}
	if rowsAffected == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}
	return nil
}

func (s *Store) FailTaskPromptGeneration(id, errMsg string, startedAt int64) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec(
		`UPDATE tasks
		 SET prompt_generation_status='error',
		     prompt_generation_error=?,
		     prompt_generation_started_at=?,
		     prompt_generation_finished_at=?,
		     updated_at=?
		 WHERE id=?`,
		errMsg, startedAt, now, now, id,
	)
	if err != nil {
		return err
	}
	rowsAffected, rowsErr := res.RowsAffected()
	if rowsErr != nil {
		return rowsErr
	}
	if rowsAffected == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}
	return nil
}

func (s *Store) UpdateTaskLocalPath(id string, localPath *string) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec("UPDATE tasks SET local_path=?, updated_at=? WHERE id=?", localPath, now, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf(errs.FmtStoreTaskNotFound, id)
	}
	return nil
}

func (s *Store) CountTasksByProjectConfigGitLabProjectAndTaskType(projectConfigID string, gitLabProjectID int64, taskType string) (int, error) {
	projectConfigID = strings.TrimSpace(projectConfigID)
	taskType = strings.TrimSpace(taskType)
	if projectConfigID == "" {
		return 0, fmt.Errorf(errs.MsgProjectConfigIDReq)
	}

	var count int
	err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM tasks WHERE project_config_id = ? AND gitlab_project_id = ? AND task_type = ?`,
		projectConfigID, gitLabProjectID, taskType,
	).Scan(&count)
	return count, err
}

func (s *Store) DeleteTask(id string) error {
	_, err := s.DB.Exec("DELETE FROM tasks WHERE id = ?", id)
	return err
}
