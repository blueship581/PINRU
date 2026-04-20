package job

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	appcli "github.com/blueship581/pinru/app/cli"
	appgit "github.com/blueship581/pinru/app/git"
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
		// Prefer the explicit env hint from RunCodexReview because Windows
		// command wrappers can lose trailing args when prompts contain newlines.
		outPath := os.Getenv("PINRU_CODEX_REVIEW_OUTPUT_PATH")
		// On Windows the .bat wrapper parses -o before calling us (to avoid
		// newline-in-arg cmd.exe issues) and passes the path via GO_TEST_OUT_PATH.
		// On Unix args are forwarded directly via "$@".
		if outPath == "" {
			outPath = os.Getenv("GO_TEST_OUT_PATH")
		}
		if outPath == "" {
			for i := 0; i < len(args)-1; i++ {
				if args[i] == "-o" {
					outPath = args[i+1]
					break
				}
			}
		}
		if outPath != "" {
			const jsonOut = `{"isCompleted":true,"isSatisfied":false,"projectType":"Bug修复","changeScope":"单文件","reviewNotes":"needs work","nextPrompt":"fix it","keyLocations":"a.go:1"}`
			os.WriteFile(outPath, []byte(jsonOut), 0o644) //nolint:errcheck
		}
		os.Exit(0)
	case "git_clone_fail_after_mkdir":
		cloneDest := strings.TrimSpace(os.Getenv("GO_TEST_CLONE_DEST"))
		if cloneDest != "" {
			os.MkdirAll(cloneDest, 0o755) //nolint:errcheck
		}
		fmt.Fprintln(os.Stderr, "fake clone failed after mkdir")
		os.Exit(1)
	case "git_clone_create_dir_then_sleep":
		cloneDest := strings.TrimSpace(os.Getenv("GO_TEST_CLONE_DEST"))
		if cloneDest != "" {
			os.MkdirAll(cloneDest, 0o755) //nolint:errcheck
		}
		fmt.Fprintln(os.Stderr, "fake clone created directory and is waiting")
		time.Sleep(24 * time.Hour)
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
		sb.WriteString("setlocal enabledelayedexpansion\r\n")
		sb.WriteString("set GO_TEST_SUBPROCESS=1\r\n")
		fmt.Fprintf(&sb, "set GO_TEST_SUBPROCESS_MODE=%s\r\n", mode)
		for k, v := range extraEnv {
			fmt.Fprintf(&sb, "set %s=%s\r\n", k, v)
		}
		// The codex args are: exec <reviewPrompt> -C <path> --dangerously-bypass-approvals-and-sandbox
		//   --output-schema <schema> -o <outPath> --ephemeral
		// reviewPrompt (arg 2) can contain literal newlines, which break cmd.exe command-line
		// parsing when expanded. Skip it with a fixed SHIFT before entering the search loop.
		sb.WriteString("shift /1\r\n") // skip 'exec'
		sb.WriteString("shift /1\r\n") // skip reviewPrompt (may contain newlines — do NOT expand)
		// Remaining args are all clean strings; find -o <outPath>.
		sb.WriteString(":findout\r\n")
		sb.WriteString("if \"%~1\"==\"\" goto endfind\r\n")
		sb.WriteString("if \"%~1\"==\"-o\" (\r\n")
		sb.WriteString("  set \"GO_TEST_OUT_PATH=%~2\"\r\n")
		sb.WriteString("  goto endfind\r\n")
		sb.WriteString(")\r\n")
		sb.WriteString("shift /1\r\n")
		sb.WriteString("goto findout\r\n")
		sb.WriteString(":endfind\r\n")
		// Call test binary without forwarding the problematic args.
		fmt.Fprintf(&sb, "\"%s\" -test.run=TestHelperProcess\r\n", exe)
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

func createMockGitCloneFailureExecutable(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if runtime.GOOS == "windows" {
		path := filepath.Join(dir, "git.bat")
		var sb strings.Builder
		sb.WriteString("@echo off\r\n")
		sb.WriteString("setlocal\r\n")
		sb.WriteString("set GO_TEST_CLONE_DEST=\r\n")
		sb.WriteString(":capture_last\r\n")
		sb.WriteString("if \"%~1\"==\"\" goto run\r\n")
		sb.WriteString("set GO_TEST_CLONE_DEST=%~1\r\n")
		sb.WriteString("shift /1\r\n")
		sb.WriteString("goto capture_last\r\n")
		sb.WriteString(":run\r\n")
		sb.WriteString("if not \"%GO_TEST_CLONE_DEST%\"==\"\" mkdir \"%GO_TEST_CLONE_DEST%\" >nul 2>nul\r\n")
		sb.WriteString("echo fake clone failed after mkdir 1>&2\r\n")
		sb.WriteString("exit /b 1\r\n")
		if err := os.WriteFile(path, []byte(sb.String()), 0o755); err != nil {
			t.Fatalf("os.WriteFile(%s) error = %v", path, err)
		}
		return dir
	}

	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable() error = %v", err)
	}
	path := filepath.Join(dir, "git")
	content := fmt.Sprintf(`#!/bin/sh
clone_dest=""
for arg in "$@"; do
	clone_dest="$arg"
done
export GO_TEST_CLONE_DEST="$clone_dest"
GO_TEST_SUBPROCESS=1 GO_TEST_SUBPROCESS_MODE=git_clone_fail_after_mkdir exec %q -test.run=TestHelperProcess
`, exe)
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("os.WriteFile(%s) error = %v", path, err)
	}
	return dir
}

func createMockGitCloneHangingExecutable(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if runtime.GOOS == "windows" {
		path := filepath.Join(dir, "git.bat")
		var sb strings.Builder
		sb.WriteString("@echo off\r\n")
		sb.WriteString("setlocal\r\n")
		sb.WriteString("set GO_TEST_CLONE_DEST=\r\n")
		sb.WriteString(":capture_last\r\n")
		sb.WriteString("if \"%~1\"==\"\" goto run\r\n")
		sb.WriteString("set GO_TEST_CLONE_DEST=%~1\r\n")
		sb.WriteString("shift /1\r\n")
		sb.WriteString("goto capture_last\r\n")
		sb.WriteString(":run\r\n")
		sb.WriteString("if not \"%GO_TEST_CLONE_DEST%\"==\"\" mkdir \"%GO_TEST_CLONE_DEST%\" >nul 2>nul\r\n")
		sb.WriteString("echo fake clone created directory and is waiting 1>&2\r\n")
		sb.WriteString(":wait\r\n")
		sb.WriteString("goto wait\r\n")
		if err := os.WriteFile(path, []byte(sb.String()), 0o755); err != nil {
			t.Fatalf("os.WriteFile(%s) error = %v", path, err)
		}
		return dir
	}

	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable() error = %v", err)
	}
	path := filepath.Join(dir, "git")
	content := fmt.Sprintf(`#!/bin/sh
clone_dest=""
for arg in "$@"; do
	clone_dest="$arg"
done
export GO_TEST_CLONE_DEST="$clone_dest"
GO_TEST_SUBPROCESS=1 GO_TEST_SUBPROCESS_MODE=git_clone_create_dir_then_sleep exec %q -test.run=TestHelperProcess
`, exe)
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("os.WriteFile(%s) error = %v", path, err)
	}
	return dir
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

func TestExecuteGitCloneCleansResidualDirectoriesAfterFinalFailure(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	if err := testStore.SetConfig("gitlab_url", "https://gitlab.example.com"); err != nil {
		t.Fatalf("SetConfig(gitlab_url) error = %v", err)
	}
	if err := testStore.SetConfig("gitlab_token", "glpat-test"); err != nil {
		t.Fatalf("SetConfig(gitlab_token) error = %v", err)
	}
	if err := testStore.SetConfig("gitlab_username", "oauth2"); err != nil {
		t.Fatalf("SetConfig(gitlab_username) error = %v", err)
	}

	fakeGitDir := createMockGitCloneFailureExecutable(t)
	t.Setenv("PATH", fakeGitDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	root := t.TempDir()
	sourcePath := filepath.Join(root, "01872-代码测试-3")
	copyPath := filepath.Join(root, "cotv21-pro")

	payloadJSON, err := json.Marshal(GitClonePayload{
		CloneURL:      "https://gitlab.example.com/prompt2repo/label-01872.git",
		SourcePath:    sourcePath,
		SourceModelID: "ORIGIN",
		CopyTargets: []GitCloneCopyTarget{
			{ModelID: "cotv21-pro", Path: copyPath},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}

	jobSvc := &JobService{
		store:   testStore,
		gitSvc:  appgit.New(testStore),
		running: make(map[string]context.CancelFunc),
	}

	_, err = jobSvc.executeGitClone(context.Background(), "job-git-clone-failure", SubmitJobRequest{
		JobType:      "git_clone",
		InputPayload: string(payloadJSON),
	})
	if err == nil {
		t.Fatalf("executeGitClone() error = nil, want failure")
	}
	if !strings.Contains(err.Error(), "git clone 连续失败") {
		t.Fatalf("executeGitClone() error = %q, want retry failure summary", err)
	}

	for _, path := range []string{sourcePath, copyPath} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("expected %s to be cleaned up, stat err = %v", path, statErr)
		}
	}
}

func TestExecuteGitCloneCleansResidualDirectoriesAfterCancellation(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	if err := testStore.SetConfig("gitlab_url", "https://gitlab.example.com"); err != nil {
		t.Fatalf("SetConfig(gitlab_url) error = %v", err)
	}
	if err := testStore.SetConfig("gitlab_token", "glpat-test"); err != nil {
		t.Fatalf("SetConfig(gitlab_token) error = %v", err)
	}
	if err := testStore.SetConfig("gitlab_username", "oauth2"); err != nil {
		t.Fatalf("SetConfig(gitlab_username) error = %v", err)
	}

	fakeGitDir := createMockGitCloneHangingExecutable(t)
	t.Setenv("PATH", fakeGitDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	root := t.TempDir()
	sourcePath := filepath.Join(root, "01872-代码测试-3")
	copyPath := filepath.Join(root, "cotv21-pro")

	payloadJSON, err := json.Marshal(GitClonePayload{
		CloneURL:      "https://gitlab.example.com/prompt2repo/label-01872.git",
		SourcePath:    sourcePath,
		SourceModelID: "ORIGIN",
		CopyTargets: []GitCloneCopyTarget{
			{ModelID: "cotv21-pro", Path: copyPath},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}

	jobSvc := &JobService{
		store:   testStore,
		gitSvc:  appgit.New(testStore),
		running: make(map[string]context.CancelFunc),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		_, runErr := jobSvc.executeGitClone(ctx, "job-git-clone-cancel", SubmitJobRequest{
			JobType:      "git_clone",
			InputPayload: string(payloadJSON),
		})
		done <- runErr
	}()

	// With the atomic staging approach, git clones into sourcePath+"._pinru_tmp"
	// rather than sourcePath directly. Wait for the staging dir to appear.
	stagingPath := sourcePath + "._pinru_tmp"
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, statErr := os.Stat(stagingPath); statErr == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("staging path %s was not created before timeout", stagingPath)
		}
		time.Sleep(20 * time.Millisecond)
	}

	cancel()

	runErr := <-done
	if !errors.Is(runErr, context.Canceled) {
		t.Fatalf("executeGitClone() error = %v, want context canceled", runErr)
	}

	// Both the staging dir and the final path must be absent after cancellation.
	for _, path := range []string{sourcePath, stagingPath, copyPath} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("expected %s to be cleaned up after cancellation, stat err = %v", path, statErr)
		}
	}
}

func TestExecuteQuestionBankMaterializeCleansResidualDirectoriesAfterFailure(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	root := t.TempDir()
	bankSourcePath := filepath.Join(root, "broken-source")
	if err := os.MkdirAll(bankSourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(bankSourcePath) error = %v", err)
	}
	brokenFilePath := filepath.Join(bankSourcePath, "secret.txt")
	if err := os.WriteFile(brokenFilePath, []byte("no access"), 0o600); err != nil {
		t.Fatalf("WriteFile(brokenFilePath) error = %v", err)
	}
	if err := os.Chmod(brokenFilePath, 0); err != nil {
		t.Fatalf("Chmod(brokenFilePath) error = %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chmod(brokenFilePath, 0o600)
	})

	targetSourcePath := filepath.Join(root, "label-01872-bug修复-1", "01872-bug修复-1")
	copyPath := filepath.Join(root, "label-01872-bug修复-1", "cotv21-pro")
	payloadJSON, err := json.Marshal(QuestionBankMaterializePayload{
		BankSourcePath:   bankSourcePath,
		TargetSourcePath: targetSourcePath,
		SourceModelID:    "ORIGIN",
		CopyTargets: []GitCloneCopyTarget{
			{ModelID: "cotv21-pro", Path: copyPath},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}

	jobSvc := &JobService{
		store:   testStore,
		gitSvc:  appgit.New(testStore),
		running: make(map[string]context.CancelFunc),
	}

	_, err = jobSvc.executeQuestionBankMaterialize(context.Background(), "job-qb-materialize-failure", SubmitJobRequest{
		JobType:      "question_bank_materialize",
		InputPayload: string(payloadJSON),
	})
	if err == nil {
		t.Fatalf("executeQuestionBankMaterialize() error = nil, want failure")
	}

	for _, path := range []string{
		targetSourcePath,
		targetSourcePath + "._pinru_tmp",
		copyPath,
		copyPath + "._pinru_tmp",
	} {
		if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
			t.Fatalf("expected %s to be cleaned up after failure, stat err = %v", path, statErr)
		}
	}
}

func TestExecuteAiReviewIncrementsReviewRoundAcrossSubmissions(t *testing.T) {
	testStore := testutil.OpenTestStore(t)

	taskID := "task-review-round"
	workDir := t.TempDir()
	task := store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRuns := []store.ModelRun{{
		ID:        "run-review-round",
		TaskID:    taskID,
		ModelName: "cotv21-pro",
		LocalPath: &workDir,
	}}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}
	if err := testStore.UpdateModelRunReview("run-review-round", "warning", 2, nil); err != nil {
		t.Fatalf("UpdateModelRunReview() error = %v", err)
	}

	// Pre-create 2 completed rounds so the next round will be 3
	modelRunIDPtr := "run-review-round"
	now := time.Now().Unix()
	for i := 1; i <= 2; i++ {
		if err := testStore.CreateAiReviewRound(store.AiReviewRound{
			ID:          fmt.Sprintf("round-pre-%d", i),
			TaskID:      taskID,
			ModelRunID:  &modelRunIDPtr,
			LocalPath:   workDir,
			ModelName:   "cotv21-pro",
			RoundNumber: i,
			Status:      "warning",
			ReviewNotes: fmt.Sprintf("round %d notes", i),
			CreatedAt:   now - int64(100-i),
			UpdatedAt:   now - int64(100-i),
		}); err != nil {
			t.Fatalf("CreateAiReviewRound(%d) error = %v", i, err)
		}
	}

	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             "job-review-round",
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
		ModelRunID: strPtr("run-review-round"),
		ModelName:  "cotv21-pro",
		LocalPath:  workDir,
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}

	result, err := jobSvc.executeAiReview(context.Background(), "job-review-round", SubmitJobRequest{
		JobType:      "ai_review",
		TaskID:       taskID,
		InputPayload: string(payloadJSON),
	})
	if err != nil {
		t.Fatalf("executeAiReview() error = %v", err)
	}
	if result.outputPayload == nil {
		t.Fatalf("executeAiReview() outputPayload = nil")
	}

	var output AiReviewResult
	if err := json.Unmarshal([]byte(*result.outputPayload), &output); err != nil {
		t.Fatalf("json.Unmarshal(outputPayload) error = %v", err)
	}
	if output.ReviewRound != 3 {
		t.Fatalf("ReviewRound = %d, want 3", output.ReviewRound)
	}

	updatedRun, err := testStore.GetModelRunByID("run-review-round")
	if err != nil {
		t.Fatalf("GetModelRunByID() error = %v", err)
	}
	if updatedRun == nil {
		t.Fatalf("GetModelRunByID() = nil")
	}
	if updatedRun.ReviewRound != 3 {
		t.Fatalf("updated review round = %d, want 3", updatedRun.ReviewRound)
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

func TestCancelJobRestoresPreviousAiReviewResult(t *testing.T) {
	testStore := testutil.OpenTestStore(t)

	taskID := "task-cancel-review-restore"
	workDir := t.TempDir()
	task := store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRunID := "run-cancel-review-restore"
	modelRuns := []store.ModelRun{{
		ID:           modelRunID,
		TaskID:       taskID,
		ModelName:    "cotv21-pro",
		LocalPath:    &workDir,
		ReviewStatus: "running",
		ReviewRound:  3,
	}}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}
	if err := testStore.UpdateModelRunReview(modelRunID, "running", 3, nil); err != nil {
		t.Fatalf("UpdateModelRunReview() error = %v", err)
	}

	// Create a previous completed round (round 2)
	now := time.Now().Unix()
	prevNotes := "previous result"
	if err := testStore.CreateAiReviewRound(store.AiReviewRound{
		ID:          "round-prev-restore",
		TaskID:      taskID,
		ModelRunID:  &modelRunID,
		LocalPath:   workDir,
		ModelName:   "cotv21-pro",
		RoundNumber: 2,
		Status:      "warning",
		ReviewNotes: prevNotes,
		CreatedAt:   now - 100,
		UpdatedAt:   now - 100,
	}); err != nil {
		t.Fatalf("CreateAiReviewRound(prev) error = %v", err)
	}

	// Create the current running round (round 3)
	roundID := "round-cancel-review-restore"
	jobID := "job-review-running"
	if err := testStore.CreateAiReviewRound(store.AiReviewRound{
		ID:          roundID,
		TaskID:      taskID,
		ModelRunID:  &modelRunID,
		LocalPath:   workDir,
		ModelName:   "cotv21-pro",
		RoundNumber: 3,
		Status:      "running",
		JobID:       &jobID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("CreateAiReviewRound(running) error = %v", err)
	}

	payloadJSON, err := json.Marshal(AiReviewPayload{
		ReviewRoundID: strPtr(roundID),
		ModelRunID:    strPtr(modelRunID),
		ModelName:     "cotv21-pro",
		LocalPath:     workDir,
		RoundSnapshot: &AiReviewRoundSnapshot{
			Status:      "none",
			RoundNumber: 3,
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}
	taskIDPtr := taskID
	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             jobID,
		JobType:        "ai_review",
		TaskID:         &taskIDPtr,
		Status:         "running",
		Progress:       45,
		InputPayload:   string(payloadJSON),
		MaxRetries:     1,
		TimeoutSeconds: 600,
		CreatedAt:      2,
	}); err != nil {
		t.Fatalf("CreateBackgroundJob(running) error = %v", err)
	}

	jobSvc := &JobService{store: testStore, running: make(map[string]context.CancelFunc)}
	if err := jobSvc.CancelJob(jobID); err != nil {
		t.Fatalf("CancelJob() error = %v", err)
	}

	cancelledJob, err := testStore.GetBackgroundJob(jobID)
	if err != nil {
		t.Fatalf("GetBackgroundJob() error = %v", err)
	}
	if cancelledJob == nil || cancelledJob.Status != "cancelled" {
		t.Fatalf("cancelled job status = %v, want cancelled", cancelledJob)
	}

	run, err := testStore.GetModelRunByID(modelRunID)
	if err != nil {
		t.Fatalf("GetModelRunByID() error = %v", err)
	}
	if run == nil {
		t.Fatalf("GetModelRunByID() = nil")
	}
	if run.ReviewStatus != "warning" {
		t.Fatalf("ReviewStatus = %q, want warning", run.ReviewStatus)
	}
	if run.ReviewRound != 2 {
		t.Fatalf("ReviewRound = %d, want 2", run.ReviewRound)
	}

	// Verify the running round was restored to none
	round, err := testStore.GetAiReviewRound(roundID)
	if err != nil {
		t.Fatalf("GetAiReviewRound() error = %v", err)
	}
	if round == nil {
		t.Fatalf("GetAiReviewRound() = nil")
	}
	if round.Status != "none" {
		t.Fatalf("round status = %q, want none", round.Status)
	}
}

func TestCancelJobClearsAiReviewRunningStateWithoutHistory(t *testing.T) {
	testStore := testutil.OpenTestStore(t)

	taskID := "task-cancel-review-clear"
	workDir := t.TempDir()
	task := store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRunID := "run-cancel-review-clear"
	modelRuns := []store.ModelRun{{
		ID:           modelRunID,
		TaskID:       taskID,
		ModelName:    "cotv21-pro",
		LocalPath:    &workDir,
		ReviewStatus: "running",
		ReviewRound:  1,
	}}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}
	if err := testStore.UpdateModelRunReview(modelRunID, "running", 1, nil); err != nil {
		t.Fatalf("UpdateModelRunReview() error = %v", err)
	}

	// Create the first (and only) round in running state — no prior history
	roundID := "round-cancel-review-clear"
	jobID := "job-review-clear"
	now := time.Now().Unix()
	if err := testStore.CreateAiReviewRound(store.AiReviewRound{
		ID:          roundID,
		TaskID:      taskID,
		ModelRunID:  &modelRunID,
		LocalPath:   workDir,
		ModelName:   "cotv21-pro",
		RoundNumber: 1,
		Status:      "running",
		JobID:       &jobID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}); err != nil {
		t.Fatalf("CreateAiReviewRound() error = %v", err)
	}

	payloadJSON, err := json.Marshal(AiReviewPayload{
		ReviewRoundID: strPtr(roundID),
		ModelRunID:    strPtr(modelRunID),
		ModelName:     "cotv21-pro",
		LocalPath:     workDir,
		RoundSnapshot: &AiReviewRoundSnapshot{
			Status:      "none",
			RoundNumber: 0,
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}
	taskIDPtr := taskID
	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             jobID,
		JobType:        "ai_review",
		TaskID:         &taskIDPtr,
		Status:         "running",
		Progress:       30,
		InputPayload:   string(payloadJSON),
		MaxRetries:     1,
		TimeoutSeconds: 600,
		CreatedAt:      1,
	}); err != nil {
		t.Fatalf("CreateBackgroundJob() error = %v", err)
	}

	jobSvc := &JobService{store: testStore, running: make(map[string]context.CancelFunc)}
	if err := jobSvc.CancelJob(jobID); err != nil {
		t.Fatalf("CancelJob() error = %v", err)
	}

	run, err := testStore.GetModelRunByID(modelRunID)
	if err != nil {
		t.Fatalf("GetModelRunByID() error = %v", err)
	}
	if run == nil {
		t.Fatalf("GetModelRunByID() = nil")
	}
	if run.ReviewStatus != "none" {
		t.Fatalf("ReviewStatus = %q, want none", run.ReviewStatus)
	}
	if run.ReviewRound != 0 {
		t.Fatalf("ReviewRound = %d, want 0", run.ReviewRound)
	}
	if run.ReviewNotes != nil {
		t.Fatalf("ReviewNotes = %v, want nil", run.ReviewNotes)
	}
}

func TestDeleteAiReviewJobKeepsCurrentResultWhenDeletingLatestRecord(t *testing.T) {
	testStore := testutil.OpenTestStore(t)

	taskID := "task-delete-review-latest"
	workDir := t.TempDir()
	task := store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRuns := []store.ModelRun{{
		ID:           "run-delete-review-latest",
		TaskID:       taskID,
		ModelName:    "cotv21-pro",
		LocalPath:    &workDir,
		ReviewStatus: "warning",
		ReviewRound:  2,
	}}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}
	if err := testStore.UpdateModelRunReview("run-delete-review-latest", "warning", 2, strPtr("latest result")); err != nil {
		t.Fatalf("UpdateModelRunReview() error = %v", err)
	}

	payloadJSON, err := json.Marshal(AiReviewPayload{
		ModelRunID: strPtr("run-delete-review-latest"),
		ModelName:  "cotv21-pro",
		LocalPath:  workDir,
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}
	resultRound1, err := json.Marshal(AiReviewResult{
		ModelRunID:   "run-delete-review-latest",
		ModelName:    "cotv21-pro",
		ReviewStatus: "pass",
		ReviewRound:  1,
		ReviewNotes:  "first pass",
	})
	if err != nil {
		t.Fatalf("json.Marshal(resultRound1) error = %v", err)
	}
	resultRound2, err := json.Marshal(AiReviewResult{
		ModelRunID:   "run-delete-review-latest",
		ModelName:    "cotv21-pro",
		ReviewStatus: "warning",
		ReviewRound:  2,
		ReviewNotes:  "latest result",
	})
	if err != nil {
		t.Fatalf("json.Marshal(resultRound2) error = %v", err)
	}

	taskIDPtr := taskID
	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             "job-review-round-1",
		JobType:        "ai_review",
		TaskID:         &taskIDPtr,
		Status:         "done",
		Progress:       100,
		InputPayload:   string(payloadJSON),
		MaxRetries:     1,
		TimeoutSeconds: 600,
		CreatedAt:      1,
	}); err != nil {
		t.Fatalf("CreateBackgroundJob(round1) error = %v", err)
	}
	resultRound1Str := string(resultRound1)
	if err := testStore.CompleteBackgroundJob("job-review-round-1", &resultRound1Str); err != nil {
		t.Fatalf("CompleteBackgroundJob(round1) error = %v", err)
	}
	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             "job-review-round-2",
		JobType:        "ai_review",
		TaskID:         &taskIDPtr,
		Status:         "done",
		Progress:       100,
		InputPayload:   string(payloadJSON),
		MaxRetries:     1,
		TimeoutSeconds: 600,
		CreatedAt:      2,
	}); err != nil {
		t.Fatalf("CreateBackgroundJob(round2) error = %v", err)
	}
	resultRound2Str := string(resultRound2)
	if err := testStore.CompleteBackgroundJob("job-review-round-2", &resultRound2Str); err != nil {
		t.Fatalf("CompleteBackgroundJob(round2) error = %v", err)
	}

	jobSvc := &JobService{store: testStore, running: make(map[string]context.CancelFunc)}
	if err := jobSvc.DeleteAiReviewJob("job-review-round-2"); err != nil {
		t.Fatalf("DeleteAiReviewJob() error = %v", err)
	}

	deletedJob, err := testStore.GetBackgroundJob("job-review-round-2")
	if err != nil {
		t.Fatalf("GetBackgroundJob(deleted) error = %v", err)
	}
	if deletedJob != nil {
		t.Fatalf("GetBackgroundJob(deleted) = %v, want nil", deletedJob)
	}

	run, err := testStore.GetModelRunByID("run-delete-review-latest")
	if err != nil {
		t.Fatalf("GetModelRunByID() error = %v", err)
	}
	if run == nil {
		t.Fatalf("GetModelRunByID() = nil")
	}
	if run.ReviewStatus != "warning" {
		t.Fatalf("ReviewStatus = %q, want warning", run.ReviewStatus)
	}
	if run.ReviewRound != 2 {
		t.Fatalf("ReviewRound = %d, want 2", run.ReviewRound)
	}
	if run.ReviewNotes == nil || *run.ReviewNotes != "latest result" {
		t.Fatalf("ReviewNotes = %v, want latest result", run.ReviewNotes)
	}
}

func TestDeleteAiReviewJobKeepsCurrentResultWhenDeletingOlderRecord(t *testing.T) {
	testStore := testutil.OpenTestStore(t)

	taskID := "task-delete-review-old"
	workDir := t.TempDir()
	task := store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRuns := []store.ModelRun{{
		ID:           "run-delete-review-old",
		TaskID:       taskID,
		ModelName:    "cotv21-pro",
		LocalPath:    &workDir,
		ReviewStatus: "warning",
		ReviewRound:  2,
	}}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}
	if err := testStore.UpdateModelRunReview("run-delete-review-old", "warning", 2, strPtr("keep latest")); err != nil {
		t.Fatalf("UpdateModelRunReview() error = %v", err)
	}

	payloadJSON, err := json.Marshal(AiReviewPayload{
		ModelRunID: strPtr("run-delete-review-old"),
		ModelName:  "cotv21-pro",
		LocalPath:  workDir,
	})
	if err != nil {
		t.Fatalf("json.Marshal(payload) error = %v", err)
	}
	resultRound1, err := json.Marshal(AiReviewResult{
		ModelRunID:   "run-delete-review-old",
		ModelName:    "cotv21-pro",
		ReviewStatus: "pass",
		ReviewRound:  1,
		ReviewNotes:  "older result",
	})
	if err != nil {
		t.Fatalf("json.Marshal(resultRound1) error = %v", err)
	}
	resultRound2, err := json.Marshal(AiReviewResult{
		ModelRunID:   "run-delete-review-old",
		ModelName:    "cotv21-pro",
		ReviewStatus: "warning",
		ReviewRound:  2,
		ReviewNotes:  "keep latest",
	})
	if err != nil {
		t.Fatalf("json.Marshal(resultRound2) error = %v", err)
	}

	taskIDPtr := taskID
	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             "job-review-old-1",
		JobType:        "ai_review",
		TaskID:         &taskIDPtr,
		Status:         "done",
		Progress:       100,
		InputPayload:   string(payloadJSON),
		MaxRetries:     1,
		TimeoutSeconds: 600,
		CreatedAt:      1,
	}); err != nil {
		t.Fatalf("CreateBackgroundJob(round1) error = %v", err)
	}
	resultRound1Str := string(resultRound1)
	if err := testStore.CompleteBackgroundJob("job-review-old-1", &resultRound1Str); err != nil {
		t.Fatalf("CompleteBackgroundJob(round1) error = %v", err)
	}
	if err := testStore.CreateBackgroundJob(store.BackgroundJob{
		ID:             "job-review-old-2",
		JobType:        "ai_review",
		TaskID:         &taskIDPtr,
		Status:         "done",
		Progress:       100,
		InputPayload:   string(payloadJSON),
		MaxRetries:     1,
		TimeoutSeconds: 600,
		CreatedAt:      2,
	}); err != nil {
		t.Fatalf("CreateBackgroundJob(round2) error = %v", err)
	}
	resultRound2Str := string(resultRound2)
	if err := testStore.CompleteBackgroundJob("job-review-old-2", &resultRound2Str); err != nil {
		t.Fatalf("CompleteBackgroundJob(round2) error = %v", err)
	}

	jobSvc := &JobService{store: testStore, running: make(map[string]context.CancelFunc)}
	if err := jobSvc.DeleteAiReviewJob("job-review-old-1"); err != nil {
		t.Fatalf("DeleteAiReviewJob() error = %v", err)
	}

	run, err := testStore.GetModelRunByID("run-delete-review-old")
	if err != nil {
		t.Fatalf("GetModelRunByID() error = %v", err)
	}
	if run == nil {
		t.Fatalf("GetModelRunByID() = nil")
	}
	if run.ReviewStatus != "warning" {
		t.Fatalf("ReviewStatus = %q, want warning", run.ReviewStatus)
	}
	if run.ReviewRound != 2 {
		t.Fatalf("ReviewRound = %d, want 2", run.ReviewRound)
	}
	if run.ReviewNotes == nil || *run.ReviewNotes != "keep latest" {
		t.Fatalf("ReviewNotes = %v, want keep latest", run.ReviewNotes)
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
