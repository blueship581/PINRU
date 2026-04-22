package store

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/migrations"
	_ "modernc.org/sqlite"
)

func openAiReviewTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "pinru.db")
	s, err := Open(dbPath, migrations.All()...)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func seedAiReviewRoundFixture(t *testing.T, s *Store, roundID string, withJob bool) (modelRunID, jobID string) {
	t.Helper()
	taskID := "task-" + roundID
	modelRunID = "run-" + roundID
	jobID = "job-" + roundID

	if _, err := s.DB.Exec(
		`INSERT INTO tasks (id, gitlab_project_id, project_name, status, task_type, session_list, local_path, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		taskID, 1, "demo", "Claimed", "default", "[]", "/tmp/"+taskID, 0, 0,
	); err != nil {
		t.Fatalf("insert task: %v", err)
	}

	if _, err := s.DB.Exec(
		`INSERT INTO model_runs (id, task_id, model_name, local_path, status) VALUES (?,?,?,?,?)`,
		modelRunID, taskID, "codex", "/tmp/"+modelRunID, "done",
	); err != nil {
		t.Fatalf("insert model_run: %v", err)
	}

	var jobIDPtr *string
	if withJob {
		if _, err := s.DB.Exec(
			`INSERT INTO background_jobs (id, job_type, task_id, status, progress, input_payload, max_retries, timeout_seconds, created_at)
			 VALUES (?,?,?,?,?,?,?,?,?)`,
			jobID, "ai_review", taskID, "completed", 100, "{}", 0, 600, 0,
		); err != nil {
			t.Fatalf("insert background_job: %v", err)
		}
		jobIDPtr = &jobID
	}

	round := AiReviewRound{
		ID:             roundID,
		TaskID:         taskID,
		ModelRunID:     &modelRunID,
		LocalPath:      "/tmp/" + modelRunID,
		ModelName:      "codex",
		RoundNumber:    1,
		OriginalPrompt: "p",
		PromptText:     "p",
		Status:         "pass",
		JobID:          jobIDPtr,
	}
	if err := s.CreateAiReviewRound(round); err != nil {
		t.Fatalf("CreateAiReviewRound: %v", err)
	}
	return modelRunID, jobID
}

func TestDeleteAiReviewRoundWithJobDeletesBothRows(t *testing.T) {
	s := openAiReviewTestStore(t)
	_, jobID := seedAiReviewRoundFixture(t, s, "round-del-1", true)

	modelRunID, err := s.DeleteAiReviewRoundWithJob("round-del-1")
	if err != nil {
		t.Fatalf("DeleteAiReviewRoundWithJob: %v", err)
	}
	if modelRunID == nil || *modelRunID == "" {
		t.Fatalf("expected modelRunID, got %v", modelRunID)
	}

	round, err := s.GetAiReviewRound("round-del-1")
	if err != nil {
		t.Fatalf("GetAiReviewRound: %v", err)
	}
	if round != nil {
		t.Fatalf("round should be deleted, got %+v", round)
	}

	job, err := s.GetBackgroundJob(jobID)
	if err != nil {
		t.Fatalf("GetBackgroundJob: %v", err)
	}
	if job != nil {
		t.Fatalf("job should be deleted, got %+v", job)
	}
}

func TestDeleteAiReviewRoundWithJobWhenNoJobSucceeds(t *testing.T) {
	s := openAiReviewTestStore(t)
	seedAiReviewRoundFixture(t, s, "round-del-2", false)

	if _, err := s.DeleteAiReviewRoundWithJob("round-del-2"); err != nil {
		t.Fatalf("DeleteAiReviewRoundWithJob: %v", err)
	}

	round, err := s.GetAiReviewRound("round-del-2")
	if err != nil {
		t.Fatalf("GetAiReviewRound: %v", err)
	}
	if round != nil {
		t.Fatalf("round should be deleted, got %+v", round)
	}
}

func TestDeleteAiReviewRoundWithJobWhenJobAlreadyGone(t *testing.T) {
	s := openAiReviewTestStore(t)
	_, jobID := seedAiReviewRoundFixture(t, s, "round-del-3", true)

	if err := s.DeleteBackgroundJob(jobID); err != nil {
		t.Fatalf("seed DeleteBackgroundJob: %v", err)
	}

	if _, err := s.DeleteAiReviewRoundWithJob("round-del-3"); err != nil {
		t.Fatalf("DeleteAiReviewRoundWithJob: %v", err)
	}

	round, err := s.GetAiReviewRound("round-del-3")
	if err != nil {
		t.Fatalf("GetAiReviewRound: %v", err)
	}
	if round != nil {
		t.Fatalf("round should be deleted, got %+v", round)
	}
}

func TestDeleteAiReviewRoundWithJobReturnsErrWhenMissing(t *testing.T) {
	s := openAiReviewTestStore(t)
	_, err := s.DeleteAiReviewRoundWithJob("round-does-not-exist")
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "未找到复审轮次") {
		t.Fatalf("expected not-found error, got %v", err)
	}
}
