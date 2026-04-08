package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Task struct {
	ID              string        `json:"id"`
	GitLabProjectID int64         `json:"gitlabProjectId"`
	ProjectName     string        `json:"projectName"`
	Status          string        `json:"status"`
	TaskType        string        `json:"taskType"`
	SessionList     []TaskSession `json:"sessionList"`
	LocalPath       *string       `json:"localPath"`
	PromptText      *string       `json:"promptText"`
	Notes           *string       `json:"notes"`
	ProjectConfigID *string       `json:"projectConfigId"`
	CreatedAt       int64         `json:"createdAt"`
	UpdatedAt       int64         `json:"updatedAt"`
}

type TaskSession struct {
	SessionID    string `json:"sessionId"`
	TaskType     string `json:"taskType"`
	ConsumeQuota bool   `json:"consumeQuota"`
}

func defaultTaskSessionList(taskType string) []TaskSession {
	normalizedTaskType := strings.TrimSpace(taskType)
	if normalizedTaskType == "" {
		normalizedTaskType = "Feature迭代"
	}

	return []TaskSession{
		{
			SessionID:    "",
			TaskType:     normalizedTaskType,
			ConsumeQuota: true,
		},
	}
}

func normalizeTaskSessionList(taskType string, sessions []TaskSession) ([]TaskSession, error) {
	normalizedTaskType := strings.TrimSpace(taskType)
	if normalizedTaskType == "" {
		normalizedTaskType = "Feature迭代"
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
				return nil, fmt.Errorf("第 %d 个 session 的任务类型不能为空", index+1)
			}
		}

		normalized = append(normalized, TaskSession{
			SessionID:    strings.TrimSpace(session.SessionID),
			TaskType:     nextTaskType,
			ConsumeQuota: index == 0 || session.ConsumeQuota,
		})
	}

	normalized[0].ConsumeQuota = true
	return normalized, nil
}

func parseTaskSessionList(rawSessionList, taskType string) ([]TaskSession, error) {
	trimmed := strings.TrimSpace(rawSessionList)
	if trimmed == "" || trimmed == "[]" || strings.EqualFold(trimmed, "null") {
		return defaultTaskSessionList(taskType), nil
	}

	var sessions []TaskSession
	if err := json.Unmarshal([]byte(trimmed), &sessions); err != nil {
		return nil, fmt.Errorf("invalid session_list JSON: %w", err)
	}

	return normalizeTaskSessionList(taskType, sessions)
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

func applyTaskSessionQuotaDelta(quotas map[string]int, previousSessions, nextSessions []TaskSession) error {
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
			if currentQuota < delta {
				return fmt.Errorf("任务类型 %q 的配额已用尽", taskType)
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
		`SELECT id, gitlab_project_id, project_name, status, task_type, session_list, local_path, prompt_text, notes, project_config_id, %s, %s FROM tasks`,
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
		if err := rows.Scan(&t.ID, &t.GitLabProjectID, &t.ProjectName, &t.Status, &t.TaskType, &rawSessionList, &t.LocalPath, &t.PromptText, &t.Notes, &t.ProjectConfigID, &t.CreatedAt, &t.UpdatedAt); err != nil {
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
		`SELECT id, gitlab_project_id, project_name, status, task_type, session_list, local_path, prompt_text, notes, project_config_id, %s, %s FROM tasks WHERE id = ?`,
		unixTimestampExpr("created_at"),
		unixTimestampExpr("updated_at"),
	)
	var rawSessionList string
	err := s.DB.QueryRow(query, id).
		Scan(&t.ID, &t.GitLabProjectID, &t.ProjectName, &t.Status, &t.TaskType, &rawSessionList, &t.LocalPath, &t.PromptText, &t.Notes, &t.ProjectConfigID, &t.CreatedAt, &t.UpdatedAt)
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
		taskType = "Feature迭代"
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

func (s *Store) UpdateTaskStatus(id, status string) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec("UPDATE tasks SET status=?, updated_at=? WHERE id=?", status, now, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("task not found: %s", id)
	}
	return nil
}

func (s *Store) UpdateTaskType(id, nextTaskType string) error {
	nextTaskType = strings.TrimSpace(nextTaskType)
	if nextTaskType == "" {
		return fmt.Errorf("task type 不能为空")
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
			return fmt.Errorf("task not found: %s", id)
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
			quotas := make(map[string]int)
			trimmed := strings.TrimSpace(quotaJSON)
			if trimmed != "" && trimmed != "{}" {
				if unmarshalErr := json.Unmarshal([]byte(trimmed), &quotas); unmarshalErr != nil {
					err = fmt.Errorf("invalid task_type_quotas JSON: %w", unmarshalErr)
					return err
				}
			}

			if adjustErr := applyTaskSessionQuotaDelta(quotas, currentSessions, normalizedSessions); adjustErr != nil {
				err = adjustErr
				return err
			}

			updatedQuotaJSON, marshalErr := json.Marshal(quotas)
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
		err = fmt.Errorf("task not found: %s", id)
		return err
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
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
			return fmt.Errorf("task not found: %s", id)
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
			quotas := make(map[string]int)
			trimmed := strings.TrimSpace(quotaJSON)
			if trimmed != "" && trimmed != "{}" {
				if unmarshalErr := json.Unmarshal([]byte(trimmed), &quotas); unmarshalErr != nil {
					return fmt.Errorf("invalid task_type_quotas JSON: %w", unmarshalErr)
				}
			}

			if adjustErr := applyTaskSessionQuotaDelta(quotas, currentSessions, normalizedSessions); adjustErr != nil {
				return adjustErr
			}

			updatedQuotaJSON, marshalQuotaErr := json.Marshal(quotas)
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
		return fmt.Errorf("task not found: %s", id)
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (s *Store) UpdateTaskPrompt(id, promptText string) error {
	now := time.Now().Unix()
	_, err := s.DB.Exec("UPDATE tasks SET prompt_text=?, status='PromptReady', updated_at=? WHERE id=?", promptText, now, id)
	return err
}

func (s *Store) UpdateTaskLocalPath(id string, localPath *string) error {
	now := time.Now().Unix()
	res, err := s.DB.Exec("UPDATE tasks SET local_path=?, updated_at=? WHERE id=?", localPath, now, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("task not found: %s", id)
	}
	return nil
}

func (s *Store) DeleteTask(id string) error {
	_, err := s.DB.Exec("DELETE FROM tasks WHERE id = ?", id)
	return err
}
