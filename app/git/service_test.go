package git

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

func TestInspectDirectoryReportsEmptiness(t *testing.T) {
	s := &GitService{}

	emptyDir := filepath.Join(t.TempDir(), "empty-project")
	if err := os.MkdirAll(emptyDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(emptyDir) error = %v", err)
	}

	emptyResult, err := s.InspectDirectory(emptyDir)
	if err != nil {
		t.Fatalf("InspectDirectory(emptyDir) error = %v", err)
	}
	if !emptyResult.Exists || !emptyResult.IsDir || !emptyResult.IsEmpty {
		t.Fatalf("unexpected empty directory result: %+v", emptyResult)
	}
	if emptyResult.Name != "empty-project" {
		t.Fatalf("emptyResult.Name = %q, want %q", emptyResult.Name, "empty-project")
	}

	nonEmptyDir := filepath.Join(t.TempDir(), "non-empty-project")
	if err := os.MkdirAll(nonEmptyDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(nonEmptyDir) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(nonEmptyDir, "README.md"), []byte("demo"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	nonEmptyResult, err := s.InspectDirectory(nonEmptyDir)
	if err != nil {
		t.Fatalf("InspectDirectory(nonEmptyDir) error = %v", err)
	}
	if !nonEmptyResult.Exists || !nonEmptyResult.IsDir || nonEmptyResult.IsEmpty {
		t.Fatalf("unexpected non-empty directory result: %+v", nonEmptyResult)
	}
}

func TestNormalizeManagedSourceFoldersSyncsTaskPromptArtifact(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "proj-1",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	taskBasePath := util.BuildManagedTaskFolderPath(project.CloneBasePath, "label-02898", "Bug修复")
	sourcePath := util.BuildManagedSourceFolderPath(taskBasePath, 2898, "Bug修复")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	promptText := strings.Join([]string{
		"修复项目概况刷新后未同步任务提示词的问题。",
		"保持现有目录结构和任务状态流转。",
	}, "\n")
	if err := os.WriteFile(filepath.Join(taskBasePath, "任务提示词.md"), []byte(promptText+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	task := store.Task{
		ID:              "label-02898",
		GitLabProjectID: 2898,
		ProjectName:     "label-02898",
		TaskType:        "Bug修复",
		LocalPath:       &taskBasePath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.UpdateTaskStatus(task.ID, "Downloaded"); err != nil {
		t.Fatalf("UpdateTaskStatus() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-1",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}

	s := &GitService{store: testStore}
	result, err := s.NormalizeManagedSourceFolders(project.ID)
	if err != nil {
		t.Fatalf("NormalizeManagedSourceFolders() error = %v", err)
	}

	if result.UpdatedCount != 1 {
		t.Fatalf("UpdatedCount = %d, want 1", result.UpdatedCount)
	}
	if result.ErrorCount != 0 {
		t.Fatalf("ErrorCount = %d, want 0", result.ErrorCount)
	}
	if len(result.Details) != 1 {
		t.Fatalf("details len = %d, want 1", len(result.Details))
	}
	if result.Details[0].Status != "updated" {
		t.Fatalf("detail status = %q, want updated", result.Details[0].Status)
	}
	if !strings.Contains(result.Details[0].Message, "已同步任务提示词") {
		t.Fatalf("detail message = %q, want prompt sync hint", result.Details[0].Message)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected task after normalize")
	}
	if savedTask.Status != "PromptReady" {
		t.Fatalf("Status after normalize = %q, want PromptReady", savedTask.Status)
	}
	if savedTask.PromptGenerationStatus != "done" {
		t.Fatalf("PromptGenerationStatus after normalize = %q, want done", savedTask.PromptGenerationStatus)
	}
	if savedTask.PromptText == nil || *savedTask.PromptText != promptText {
		t.Fatalf("PromptText after normalize = %v, want %q", savedTask.PromptText, promptText)
	}
}

func TestNormalizeManagedSourceFoldersInitializesGitForExistingModelDirectories(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "proj-git",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,cotv21-pro",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	taskBasePath := util.BuildManagedTaskFolderPath(project.CloneBasePath, "label-03001", "Bug修复")
	sourcePath := util.BuildManagedSourceFolderPath(taskBasePath, 3001, "Bug修复")
	modelPath := filepath.Join(taskBasePath, "cotv21-pro")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.MkdirAll(modelPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(modelPath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "README.md"), []byte("source"), 0o644); err != nil {
		t.Fatalf("WriteFile(source README) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(modelPath, "README.md"), []byte("model"), 0o644); err != nil {
		t.Fatalf("WriteFile(model README) error = %v", err)
	}
	initGitRepoInDir(t, sourcePath, "bugfix-sync")
	runGitInDir(t, sourcePath, "add", "README.md")
	runGitInDir(t, sourcePath, "commit", "-m", "initial source commit")

	task := store.Task{
		ID:              "label-03001",
		GitLabProjectID: 3001,
		ProjectName:     "label-03001",
		TaskType:        "Bug修复",
		LocalPath:       &taskBasePath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-model",
		TaskID:    task.ID,
		ModelName: "cotv21-pro",
		LocalPath: &modelPath,
	}); err != nil {
		t.Fatalf("CreateModelRun(model) error = %v", err)
	}

	s := &GitService{store: testStore}
	result, err := s.NormalizeManagedSourceFolders(project.ID)
	if err != nil {
		t.Fatalf("NormalizeManagedSourceFolders() error = %v", err)
	}

	if result.GitInitializedCount != 1 {
		t.Fatalf("GitInitializedCount = %d, want 1", result.GitInitializedCount)
	}
	if len(result.Details) != 1 {
		t.Fatalf("details len = %d, want 1", len(result.Details))
	}
	if result.Details[0].GitInitializedCount != 1 {
		t.Fatalf("detail GitInitializedCount = %d, want 1", result.Details[0].GitInitializedCount)
	}
	if !strings.Contains(result.Details[0].Message, "补 Git 基线") {
		t.Fatalf("detail message = %q, want git initialization hint", result.Details[0].Message)
	}

	if _, err := os.Stat(filepath.Join(modelPath, ".git")); err != nil {
		t.Fatalf("expected model path to have git metadata, stat err = %v", err)
	}
	if branch := gitOutputInDir(t, modelPath, "branch", "--show-current"); branch != "bugfix-sync" {
		t.Fatalf("model branch = %q, want bugfix-sync", branch)
	}
	if status := gitOutputInDir(t, modelPath, "status", "--short"); strings.TrimSpace(status) != "" {
		t.Fatalf("model git status = %q, want clean working tree", status)
	}
}

func initGitRepoInDir(t *testing.T, dir, branch string) {
	t.Helper()
	if err := runGitCommand(dir, "init", "-b", branch); err != nil {
		if err := runGitCommand(dir, "init"); err != nil {
			t.Fatalf("git init error = %v", err)
		}
		runGitInDir(t, dir, "checkout", "-b", branch)
	}
	runGitInDir(t, dir, "config", "user.name", "Test User")
	runGitInDir(t, dir, "config", "user.email", "test@example.com")
}

func runGitInDir(t *testing.T, dir string, args ...string) {
	t.Helper()
	if err := runGitCommand(dir, args...); err != nil {
		t.Fatalf("git %s failed: %v", strings.Join(args, " "), err)
	}
}

func gitOutputInDir(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}

func runGitCommand(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
