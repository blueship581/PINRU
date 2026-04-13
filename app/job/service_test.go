package job

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	appcli "github.com/blueship581/pinru/app/cli"
	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

func TestExecuteAiReviewRunsSingleRoundPerSubmission(t *testing.T) {
	testStore := testutil.OpenTestStore(t)

	taskID := "task-1"
	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             "job-1",
		JobType:        "ai_review",
		TaskID:         &taskID,
		Status:         "pending",
		Progress:       0,
		InputPayload:   "{}",
		MaxRetries:     1,
		TimeoutSeconds: 60,
		CreatedAt:      1,
	}); err != nil {
		t.Fatalf("CreateBackgroundJob() error = %v", err)
	}

	workDir := t.TempDir()
	countFile := filepath.Join(t.TempDir(), "count.txt")
	scriptPath := filepath.Join(t.TempDir(), "codex")
	script := strings.Join([]string{
		"#!/bin/sh",
		"count_file=\"" + countFile + "\"",
		"count=0",
		"if [ -f \"$count_file\" ]; then count=$(cat \"$count_file\"); fi",
		"count=$((count + 1))",
		"printf '%s' \"$count\" > \"$count_file\"",
		"out=\"\"",
		"while [ \"$#\" -gt 0 ]; do",
		"  if [ \"$1\" = \"-o\" ]; then",
		"    shift",
		"    out=\"$1\"",
		"  fi",
		"  shift",
		"done",
		"cat > \"$out\" <<'JSON'",
		"{\"isCompleted\":true,\"isSatisfied\":false,\"projectType\":\"Bug修复\",\"changeScope\":\"单文件\",\"reviewNotes\":\"needs work\",\"nextPrompt\":\"fix it\",\"keyLocations\":\"a.go:1\"}",
		"JSON",
	}, "\n")
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("os.WriteFile(scriptPath) error = %v", err)
	}

	cliSvc := appcli.NewWithResolver(func(name string) (string, error) {
		if name != "codex" {
			t.Fatalf("unexpected CLI lookup: %s", name)
		}
		return scriptPath, nil
	})
	jobSvc := &JobService{store: testStore, cliSvc: cliSvc}

	payloadJSON, err := json.Marshal(AiReviewPayload{
		ModelName: "cotv21-pro",
		LocalPath: workDir,
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}

	result, err := jobSvc.executeAiReview(context.Background(), "job-1", SubmitJobRequest{
		JobType:      "ai_review",
		TaskID:       taskID,
		InputPayload: string(payloadJSON),
	})
	if err != nil {
		t.Fatalf("executeAiReview() error = %v", err)
	}

	countData, err := os.ReadFile(countFile)
	if err != nil {
		t.Fatalf("os.ReadFile(countFile) error = %v", err)
	}
	if got := strings.TrimSpace(string(countData)); got != "1" {
		t.Fatalf("codex invocation count = %q, want 1", got)
	}

	if result.outputPayload == nil {
		t.Fatalf("executeAiReview() outputPayload = nil")
	}

	var output AiReviewResult
	if err := json.Unmarshal([]byte(*result.outputPayload), &output); err != nil {
		t.Fatalf("json.Unmarshal(outputPayload) error = %v", err)
	}
	if output.ReviewStatus != "warning" {
		t.Fatalf("ReviewStatus = %q, want warning", output.ReviewStatus)
	}
	if output.ReviewRound != 1 {
		t.Fatalf("ReviewRound = %d, want 1", output.ReviewRound)
	}
}

func TestSubmitJobDeduplicatesActiveAiReviewJobs(t *testing.T) {
	testStore := testutil.OpenTestStore(t)

	taskID := "task-1"
	payloadJSON, err := json.Marshal(AiReviewPayload{
		ModelName: "cotv21-pro",
		LocalPath: " /tmp/worktree/clone-1 ",
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}

	existing := store.BackgroundJob{
		ID:             "job-existing",
		JobType:        "ai_review",
		TaskID:         &taskID,
		Status:         "running",
		Progress:       35,
		InputPayload:   string(payloadJSON),
		MaxRetries:     1,
		TimeoutSeconds: 600,
		CreatedAt:      1,
	}
	if err := testStore.CreateBackgroundJob(existing); err != nil {
		t.Fatalf("CreateBackgroundJob(existing) error = %v", err)
	}

	jobSvc := &JobService{store: testStore}
	job, err := jobSvc.SubmitJob(SubmitJobRequest{
		JobType:      "ai_review",
		TaskID:       taskID,
		InputPayload: `{"modelName":"cotv21-pro","localPath":"/tmp/worktree/clone-1"}`,
		MaxRetries:   1,
	})
	if err != nil {
		t.Fatalf("SubmitJob() error = %v", err)
	}

	if job.ID != existing.ID {
		t.Fatalf("SubmitJob() returned job id = %q, want %q", job.ID, existing.ID)
	}

	jobs, err := testStore.ListBackgroundJobs(&store.JobFilter{TaskID: &taskID})
	if err != nil {
		t.Fatalf("ListBackgroundJobs() error = %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("ListBackgroundJobs() count = %d, want 1", len(jobs))
	}
}

func TestNewGitCloneProgressContextTimesOutWithoutHeartbeat(t *testing.T) {
	ctx, stop, _ := newGitCloneProgressContext(context.Background(), 40*time.Millisecond)
	defer stop()

	<-ctx.Done()

	if cause := context.Cause(ctx); !strings.Contains(cause.Error(), "无进度输出") {
		t.Fatalf("context cause = %v, want idle-timeout error", cause)
	}
}

func TestCleanupGitCloneTargetsRemovesCreatedPaths(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "task", "01872-bug修复")
	copyPath := filepath.Join(root, "task", "cotv21-pro")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.MkdirAll(copyPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(copyPath) error = %v", err)
	}

	payload := GitClonePayload{
		SourcePath: sourcePath,
		CopyTargets: []GitCloneCopyTarget{
			{ModelID: "cotv21-pro", Path: copyPath},
		},
	}
	if err := cleanupGitCloneTargets(payload); err != nil {
		t.Fatalf("cleanupGitCloneTargets() error = %v", err)
	}

	for _, path := range []string{sourcePath, copyPath} {
		if _, err := os.Stat(util.NormalizePath(path)); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be removed, stat err = %v", path, err)
		}
	}
}
