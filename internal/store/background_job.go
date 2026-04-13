package store

import (
	"database/sql"
	"fmt"
	"time"
)

type BackgroundJob struct {
	ID              string  `json:"id"`
	JobType         string  `json:"jobType"`
	TaskID          *string `json:"taskId"`
	Status          string  `json:"status"`
	Progress        int     `json:"progress"`
	ProgressMessage *string `json:"progressMessage"`
	ErrorMessage    *string `json:"errorMessage"`
	InputPayload    string  `json:"inputPayload"`
	OutputPayload   *string `json:"outputPayload"`
	RetryCount      int     `json:"retryCount"`
	MaxRetries      int     `json:"maxRetries"`
	TimeoutSeconds  int     `json:"timeoutSeconds"`
	CreatedAt       int64   `json:"createdAt"`
	StartedAt       *int64  `json:"startedAt"`
	FinishedAt      *int64  `json:"finishedAt"`
}

type JobFilter struct {
	Status *string
	TaskID *string
}

func (s *Store) CreateBackgroundJob(job BackgroundJob) error {
	_, err := s.DB.Exec(
		`INSERT INTO background_jobs (id, job_type, task_id, status, progress, progress_message, input_payload, max_retries, timeout_seconds, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.JobType, job.TaskID, job.Status, job.Progress, job.ProgressMessage,
		job.InputPayload, job.MaxRetries, job.TimeoutSeconds, job.CreatedAt,
	)
	return err
}

func (s *Store) GetBackgroundJob(id string) (*BackgroundJob, error) {
	row := s.DB.QueryRow(
		`SELECT id, job_type, task_id, status, progress, progress_message, error_message,
		        input_payload, output_payload, retry_count, max_retries, timeout_seconds,
		        created_at, started_at, finished_at
		 FROM background_jobs WHERE id = ?`, id,
	)
	return scanBackgroundJob(row)
}

func (s *Store) ListBackgroundJobs(filter *JobFilter) ([]BackgroundJob, error) {
	query := `SELECT id, job_type, task_id, status, progress, progress_message, error_message,
	                  input_payload, output_payload, retry_count, max_retries, timeout_seconds,
	                  created_at, started_at, finished_at
	           FROM background_jobs`
	var args []interface{}
	var conditions []string

	if filter != nil {
		if filter.Status != nil {
			conditions = append(conditions, "status = ?")
			args = append(args, *filter.Status)
		}
		if filter.TaskID != nil {
			conditions = append(conditions, "task_id = ?")
			args = append(args, *filter.TaskID)
		}
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for _, c := range conditions[1:] {
			query += " AND " + c
		}
	}
	query += " ORDER BY created_at DESC LIMIT 100"

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []BackgroundJob
	for rows.Next() {
		job, err := scanBackgroundJobRows(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, *job)
	}
	return jobs, rows.Err()
}

func (s *Store) UpdateBackgroundJobProgress(id string, progress int, message string) error {
	_, err := s.DB.Exec(
		`UPDATE background_jobs
		 SET progress = ?, progress_message = ?, status = 'running'
		 WHERE id = ? AND status != 'cancelled'`,
		progress, message, id,
	)
	return err
}

func (s *Store) StartBackgroundJob(id string) error {
	now := time.Now().Unix()
	_, err := s.DB.Exec(
		`UPDATE background_jobs
		 SET status = 'running', started_at = ?
		 WHERE id = ? AND status != 'cancelled'`,
		now, id,
	)
	return err
}

func (s *Store) CompleteBackgroundJob(id string, outputPayload *string) error {
	now := time.Now().Unix()
	_, err := s.DB.Exec(
		`UPDATE background_jobs
		 SET status = 'done', progress = 100, output_payload = ?, finished_at = ?
		 WHERE id = ? AND status != 'cancelled'`,
		outputPayload, now, id,
	)
	return err
}

func (s *Store) FailBackgroundJob(id string, errMsg string) error {
	now := time.Now().Unix()
	_, err := s.DB.Exec(
		`UPDATE background_jobs
		 SET status = 'error', error_message = ?, finished_at = ?
		 WHERE id = ? AND status != 'cancelled'`,
		errMsg, now, id,
	)
	return err
}

func (s *Store) CancelBackgroundJob(id string) error {
	now := time.Now().Unix()
	_, err := s.DB.Exec(
		`UPDATE background_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?`,
		now, id,
	)
	return err
}

func (s *Store) IncrementBackgroundJobRetry(id string) error {
	_, err := s.DB.Exec(
		`UPDATE background_jobs SET retry_count = retry_count + 1, status = 'pending',
		 error_message = NULL, progress = 0, progress_message = NULL,
		 started_at = NULL, finished_at = NULL WHERE id = ?`, id,
	)
	return err
}

func (s *Store) CleanupOldBackgroundJobs(maxAgeDays int) error {
	cutoff := time.Now().AddDate(0, 0, -maxAgeDays).Unix()
	_, err := s.DB.Exec(
		`DELETE FROM background_jobs WHERE status IN ('done', 'cancelled', 'error') AND created_at < ?`,
		cutoff,
	)
	return err
}

func scanBackgroundJob(row *sql.Row) (*BackgroundJob, error) {
	var job BackgroundJob
	err := row.Scan(
		&job.ID, &job.JobType, &job.TaskID, &job.Status, &job.Progress, &job.ProgressMessage,
		&job.ErrorMessage, &job.InputPayload, &job.OutputPayload, &job.RetryCount,
		&job.MaxRetries, &job.TimeoutSeconds, &job.CreatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan background job: %w", err)
	}
	return &job, nil
}

func scanBackgroundJobRows(rows *sql.Rows) (*BackgroundJob, error) {
	var job BackgroundJob
	err := rows.Scan(
		&job.ID, &job.JobType, &job.TaskID, &job.Status, &job.Progress, &job.ProgressMessage,
		&job.ErrorMessage, &job.InputPayload, &job.OutputPayload, &job.RetryCount,
		&job.MaxRetries, &job.TimeoutSeconds, &job.CreatedAt, &job.StartedAt, &job.FinishedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan background job row: %w", err)
	}
	return &job, nil
}
