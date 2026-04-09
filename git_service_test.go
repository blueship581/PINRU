package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

func TestInspectDirectoryReportsEmptiness(t *testing.T) {
	service := &GitService{}

	emptyDir := filepath.Join(t.TempDir(), "empty-project")
	if err := os.MkdirAll(emptyDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(emptyDir) error = %v", err)
	}

	emptyResult, err := service.InspectDirectory(emptyDir)
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

	nonEmptyResult, err := service.InspectDirectory(nonEmptyDir)
	if err != nil {
		t.Fatalf("InspectDirectory(nonEmptyDir) error = %v", err)
	}
	if !nonEmptyResult.Exists || !nonEmptyResult.IsDir || nonEmptyResult.IsEmpty {
		t.Fatalf("unexpected non-empty directory result: %+v", nonEmptyResult)
	}
}

func TestNormalizeManagedSourceFoldersSyncsTaskPromptArtifact(t *testing.T) {
	testStore := openChatServiceTestStore(t)
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

	serviceWithStore := &GitService{store: testStore}
	result, err := serviceWithStore.NormalizeManagedSourceFolders(project.ID)
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
