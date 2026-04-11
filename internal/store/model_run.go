package store

import (
	"database/sql"
	"fmt"
)

type ModelRun struct {
	ID                 string        `json:"id"`
	TaskID             string        `json:"taskId"`
	ModelName          string        `json:"modelName"`
	BranchName         *string       `json:"branchName"`
	LocalPath          *string       `json:"localPath"`
	PrURL              *string       `json:"prUrl"`
	OriginURL          *string       `json:"originUrl"`
	GsbScore           *string       `json:"gsbScore"`
	Status             string        `json:"status"`
	StartedAt          *int64        `json:"startedAt"`
	FinishedAt         *int64        `json:"finishedAt"`
	SessionID          *string       `json:"sessionId"`
	ConversationRounds int           `json:"conversationRounds"`
	ConversationDate   *int64        `json:"conversationDate"`
	SubmitError        *string       `json:"submitError"`
	SessionList        []TaskSession `json:"sessionList"`
}

func (s *Store) ListModelRuns(taskID string) ([]ModelRun, error) {
	query := fmt.Sprintf(
		`SELECT id, task_id, model_name, branch_name, local_path, pr_url, origin_url, gsb_score,
		        status, %s, %s, session_id, conversation_rounds, %s, submit_error, session_list
		 FROM model_runs WHERE task_id = ?
		 ORDER BY CASE WHEN UPPER(model_name) = 'ORIGIN' THEN 0 ELSE 1 END, model_name`,
		nullableUnixTimestampExpr("started_at"),
		nullableUnixTimestampExpr("finished_at"),
		nullableUnixTimestampExpr("conversation_date"),
	)
	rows, err := s.DB.Query(
		query, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []ModelRun
	for rows.Next() {
		var r ModelRun
		var rawSessionList string
		if err := rows.Scan(
			&r.ID, &r.TaskID, &r.ModelName, &r.BranchName, &r.LocalPath,
			&r.PrURL, &r.OriginURL, &r.GsbScore, &r.Status, &r.StartedAt, &r.FinishedAt,
			&r.SessionID, &r.ConversationRounds, &r.ConversationDate, &r.SubmitError, &rawSessionList,
		); err != nil {
			return nil, err
		}
		r.SessionList, err = parseOptionalTaskSessionList(rawSessionList, defaultTaskType)
		if err != nil {
			return nil, err
		}
		runs = append(runs, r)
	}
	return runs, rows.Err()
}

func (s *Store) CreateModelRun(r ModelRun) error {
	_, err := s.DB.Exec(
		"INSERT INTO model_runs (id, task_id, model_name, local_path, status) VALUES (?,?,?,?,?)",
		r.ID, r.TaskID, r.ModelName, r.LocalPath, "pending")
	return err
}

func (s *Store) UpdateModelRun(taskID, modelName, status string, branchName, prURL *string, startedAt, finishedAt *int64) error {
	res, err := s.DB.Exec(
		"UPDATE model_runs SET status=?, branch_name=?, pr_url=?, started_at=?, finished_at=? WHERE task_id=? AND model_name=?",
		status, branchName, prURL, startedAt, finishedAt, taskID, modelName)
	return ensureRowsAffected(res, err, "model run %q/%q not found", taskID, modelName)
}

func (s *Store) GetModelRun(taskID, modelName string) (*ModelRun, error) {
	var r ModelRun
	query := fmt.Sprintf(
		`SELECT id, task_id, model_name, branch_name, local_path, pr_url, origin_url, gsb_score,
		        status, %s, %s, session_id, conversation_rounds, %s, submit_error, session_list
		 FROM model_runs WHERE task_id = ? AND model_name = ?`,
		nullableUnixTimestampExpr("started_at"),
		nullableUnixTimestampExpr("finished_at"),
		nullableUnixTimestampExpr("conversation_date"),
	)
	var rawSessionList string
	err := s.DB.QueryRow(query, taskID, modelName).
		Scan(&r.ID, &r.TaskID, &r.ModelName, &r.BranchName, &r.LocalPath,
			&r.PrURL, &r.OriginURL, &r.GsbScore, &r.Status, &r.StartedAt, &r.FinishedAt,
			&r.SessionID, &r.ConversationRounds, &r.ConversationDate, &r.SubmitError, &rawSessionList)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.SessionList, err = parseOptionalTaskSessionList(rawSessionList, defaultTaskType)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Store) DeleteModelRun(taskID, modelName string) error {
	res, err := s.DB.Exec("DELETE FROM model_runs WHERE task_id=? AND model_name=?", taskID, modelName)
	return ensureRowsAffected(res, err, "model run %q/%q not found", taskID, modelName)
}

func (s *Store) SetModelRunOriginURL(taskID, modelName, url string) error {
	res, err := s.DB.Exec("UPDATE model_runs SET origin_url=? WHERE task_id=? AND model_name=?", url, taskID, modelName)
	return ensureRowsAffected(res, err, "model run %q/%q not found", taskID, modelName)
}

func (s *Store) SetModelRunError(taskID, modelName, errMsg string) error {
	res, err := s.DB.Exec("UPDATE model_runs SET submit_error=? WHERE task_id=? AND model_name=?", errMsg, taskID, modelName)
	return ensureRowsAffected(res, err, "model run %q/%q not found", taskID, modelName)
}

func (s *Store) UpdateModelRunLocalPath(taskID, modelName string, localPath *string) error {
	res, err := s.DB.Exec("UPDATE model_runs SET local_path=? WHERE task_id=? AND model_name=?", localPath, taskID, modelName)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("model run %q/%q not found", taskID, modelName)
	}
	return nil
}

func (s *Store) UpdateModelRunSession(id string, sessionID *string, rounds int, date *int64) error {
	res, err := s.DB.Exec(
		"UPDATE model_runs SET session_id=?, conversation_rounds=?, conversation_date=? WHERE id=?",
		sessionID, rounds, date, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("model run %q not found", id)
	}
	return nil
}
