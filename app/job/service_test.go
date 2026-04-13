package job

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	appcli "github.com/blueship581/pinru/app/cli"
	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

// TestHelperProcess is not a real test. It is invoked as a subprocess by other
// tests to provide a cross-platform mock for the codex CLI binary.
// Run via createMockCodexExecutable; do not call directly.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_TEST_SUBPROCESS") != "1" {
		return
	}
	// Find the "--" separator; everything after it are the forwarded CLI args.
	args := os.Args
	for len(args) > 0 {
		if args[0] == "--" {
			args = args[1:]
			break
		}
		args = args[1:]
	}
	switch os.Getenv("GO_TEST_SUBPROCESS_MODE") {
	case "codex_single_round":
		// Count invocations.
		if countFile := os.Getenv("GO_TEST_COUNT_FILE"); countFile != "" {
			count := 0
			if data, err := os.ReadFile(countFile); err == nil {
				fmt.Sscanf(strings.TrimSpace(string(data)), "%d", &count)
			}
			count++
			os.WriteFile(countFile, []byte(strconv.Itoa(count)), 0o644) //nolint:errcheck
		}
		// Find -o argument and write structured JSON output.
		var outPath string
		for i := 0; i < len(args)-1; i++ {
			if args[i] == "-o" {
				outPath = args[i+1]
				break
			}
		}
		if outPath != "" {
			const jsonOut = `{"isCompleted":true,"isSatisfied":false,"projectType":"Bug修复","changeScope":"单文件","reviewNotes":"needs work","nextPrompt":"fix it","keyLocations":"a.go:1"}`
			os.WriteFile(outPath, []byte(jsonOut), 0o644) //nolint:errcheck
		}
		os.Exit(0)
	default:
		fmt.Fprintf(os.Stderr, "unknown GO_TEST_SUBPROCESS_MODE: %s\n", os.Getenv("GO_TEST_SUBPROCESS_MODE"))
		os.Exit(1)
	}
}

// createMockCodexExecutable returns a path to a platform-appropriate executable
// that behaves according to mode when invoked as "codex". extraEnv entries are
// set as environment variables in the subprocess. On Unix it creates a shell
// script; on Windows a .bat wrapper.
func createMockCodexExecutable(t *testing.T, mode string, extraEnv map[string]string) string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable() error = %v", err)
	}
	dir := t.TempDir()
	if runtime.GOOS == "windows" {
		path := filepath.Join(dir, "codex.bat")
		var sb strings.Builder
		sb.WriteString("@echo off\r\n")
		sb.WriteString("set GO_TEST_SUBPROCESS=1\r\n")
		fmt.Fprintf(&sb, "set GO_TEST_SUBPROCESS_MODE=%s\r\n", mode)
		for k, v := range extraEnv {
			fmt.Fprintf(&sb, "set %s=%s\r\n", k, v)
		}
		fmt.Fprintf(&sb, "\"%s\" -test.run=TestHelperProcess -- %%*\r\n", exe)
		sb.WriteString("exit /b %errorlevel%\r\n")
		if err := os.WriteFile(path, []byte(sb.String()), 0o755); err != nil {
			t.Fatalf("os.WriteFile(%s) error = %v", path, err)
		}
		return path
	}
	path := filepath.Join(dir, "codex")
	var sb strings.Builder
	sb.WriteString("#!/bin/sh\n")
	for k, v := range extraEnv {
		fmt.Fprintf(&sb, "export %s=%q\n", k, v)
	}
	fmt.Fprintf(&sb, "GO_TEST_SUBPROCESS=1 GO_TEST_SUBPROCESS_MODE=%s exec %q -test.run=TestHelperProcess -- \"$@\"\n", mode, exe)
	if err := os.WriteFile(path, []byte(sb.String()), 0o755); err != nil {
		t.Fatalf("os.WriteFile(%s) error = %v", path, err)
	}
	return path
}

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
	mockPath := createMockCodexExecutable(t, "codex_single_round", map[string]string{
		"GO_TEST_COUNT_FILE": countFile,
	})

	cliSvc := appcli.NewWithResolver(func(name string) (string, error) {
		if name != "codex" {
			t.Fatalf("unexpected CLI lookup: %s", name)
		}
		return mockPath, nil
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
