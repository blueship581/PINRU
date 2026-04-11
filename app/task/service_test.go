package task

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	appgit "github.com/blueship581/pinru/app/git"
	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

func TestCreateTaskUsesProjectScopedIdentity(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	projectAID := "project-1710000000001"
	projectBID := "project-1710000000002"

	taskA, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectAID,
	})
	if err != nil {
		t.Fatalf("CreateTask(projectA) error = %v", err)
	}

	taskB, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectBID,
	})
	if err != nil {
		t.Fatalf("CreateTask(projectB) error = %v", err)
	}

	if taskA.ID == taskB.ID {
		t.Fatalf("task ids should be different across project configs, got %q", taskA.ID)
	}
	if taskA.ID == legacyTaskID(1849) || taskB.ID == legacyTaskID(1849) {
		t.Fatalf("expected project-scoped task id, got %q and %q", taskA.ID, taskB.ID)
	}

	tasks, err := testStore.ListTasks(nil)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("ListTasks() count = %d, want 2", len(tasks))
	}
}

func TestCreateTaskRejectsDuplicateWithinSameProject(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	projectID := "project-1710000000001"

	if _, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectID,
	}); err != nil {
		t.Fatalf("first CreateTask() error = %v", err)
	}

	_, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Feature迭代",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectID,
	})
	if err == nil {
		t.Fatalf("expected duplicate task error")
	}
	if !strings.Contains(err.Error(), "当前项目下题卡已存在") {
		t.Fatalf("unexpected duplicate error = %q", err.Error())
	}
}

func TestDeleteTaskRemovesManagedTaskDirectory(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:            "project-1",
		Name:          "Demo",
		GitLabURL:     "https://gitlab.example.com",
		GitLabToken:   "glpat-demo",
		CloneBasePath: cloneBasePath,
		Models:        "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	localPath := util.BuildManagedTaskFolderPath(cloneBasePath, "label-01849", "Bug修复")
	if err := os.MkdirAll(localPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(localPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-managed",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		LocalPath:       &localPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if err := s.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask() error = %v", err)
	}

	if _, err := os.Stat(localPath); !os.IsNotExist(err) {
		t.Fatalf("managed task directory should be removed, stat err = %v", err)
	}
}

func TestDeleteTaskKeepsUnmanagedDirectory(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:            "project-2",
		Name:          "Demo",
		GitLabURL:     "https://gitlab.example.com",
		GitLabToken:   "glpat-demo",
		CloneBasePath: cloneBasePath,
		Models:        "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	unmanagedPath := filepath.Join(t.TempDir(), "external-workdir")
	if err := os.MkdirAll(unmanagedPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(unmanagedPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-unmanaged",
		GitLabProjectID: 1850,
		ProjectName:     "label-01850",
		TaskType:        "Bug修复",
		LocalPath:       &unmanagedPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if err := s.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask() error = %v", err)
	}

	if _, err := os.Stat(unmanagedPath); err != nil {
		t.Fatalf("unmanaged directory should be kept, stat err = %v", err)
	}

	tasks, err := testStore.ListTasks(nil)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("ListTasks() count = %d, want 0", len(tasks))
	}
}

func TestResolveTaskLocalFolderPrefersTaskPath(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	taskPath := filepath.Join(t.TempDir(), "label-01849-Bug修复")
	if err := os.MkdirAll(taskPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(taskPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-open-root",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		LocalPath:       &taskPath,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	resolved, err := s.resolveTaskLocalFolder(&task)
	if err != nil {
		t.Fatalf("resolveTaskLocalFolder() error = %v", err)
	}
	if resolved != taskPath {
		t.Fatalf("resolveTaskLocalFolder() = %q, want %q", resolved, taskPath)
	}
}

func TestResolveTaskLocalFolderFallsBackToSharedModelParent(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	taskRoot := filepath.Join(t.TempDir(), "label-01849-Bug修复")
	originPath := filepath.Join(taskRoot, "ORIGIN")
	modelPath := filepath.Join(taskRoot, "cotv21-pro")
	if err := os.MkdirAll(originPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(originPath) error = %v", err)
	}
	if err := os.MkdirAll(modelPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(modelPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-open-model-parent",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRuns := []store.ModelRun{
		{
			ID:        "run-origin",
			TaskID:    task.ID,
			ModelName: "ORIGIN",
			LocalPath: &originPath,
		},
		{
			ID:        "run-model",
			TaskID:    task.ID,
			ModelName: "cotv21-pro",
			LocalPath: &modelPath,
		},
	}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}

	resolved, err := s.resolveTaskLocalFolder(&task)
	if err != nil {
		t.Fatalf("resolveTaskLocalFolder() error = %v", err)
	}
	if resolved != taskRoot {
		t.Fatalf("resolveTaskLocalFolder() = %q, want %q", resolved, taskRoot)
	}
}

func TestResolveTaskLocalFolderReturnsSingleModelPath(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	modelPath := filepath.Join(t.TempDir(), "cotv21-pro")
	if err := os.MkdirAll(modelPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(modelPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-open-single-model",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRuns := []store.ModelRun{
		{
			ID:        "run-model",
			TaskID:    task.ID,
			ModelName: "cotv21-pro",
			LocalPath: &modelPath,
		},
	}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}

	resolved, err := s.resolveTaskLocalFolder(&task)
	if err != nil {
		t.Fatalf("resolveTaskLocalFolder() error = %v", err)
	}
	if resolved != modelPath {
		t.Fatalf("resolveTaskLocalFolder() = %q, want %q", resolved, modelPath)
	}
}

func TestUpdateTaskTypeNormalizesManagedPaths(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:                "project-normalize",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-demo",
		CloneBasePath:     cloneBasePath,
		Models:            "ORIGIN\ncotv21-pro",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	const (
		projectName = "label-01849"
		oldTaskType = "Bug修复"
		newTaskType = "Feature迭代"
	)

	oldBasePath := util.BuildManagedTaskFolderPath(cloneBasePath, projectName, oldTaskType)
	oldSourcePath := util.BuildManagedSourceFolderPath(oldBasePath, 1849, oldTaskType)
	oldExecPath := filepath.Join(oldBasePath, "cotv21-pro")
	if err := os.MkdirAll(oldSourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(oldSourcePath) error = %v", err)
	}
	if err := os.MkdirAll(oldExecPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(oldExecPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-normalize-type",
		GitLabProjectID: 1849,
		ProjectName:     projectName,
		TaskType:        oldTaskType,
		LocalPath:       &oldBasePath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &oldSourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-cotv21",
		TaskID:    task.ID,
		ModelName: "cotv21-pro",
		LocalPath: &oldExecPath,
	}); err != nil {
		t.Fatalf("CreateModelRun(cotv21-pro) error = %v", err)
	}

	s := &TaskService{
		store:  testStore,
		gitSvc: appgit.New(testStore),
	}
	if err := s.UpdateTaskType(task.ID, newTaskType); err != nil {
		t.Fatalf("UpdateTaskType() error = %v", err)
	}

	newBasePath := util.BuildManagedTaskFolderPath(cloneBasePath, projectName, newTaskType)
	newSourcePath := util.BuildManagedSourceFolderPath(newBasePath, 1849, newTaskType)
	newExecPath := filepath.Join(newBasePath, "cotv21-pro")

	if _, err := os.Stat(newBasePath); err != nil {
		t.Fatalf("Stat(newBasePath) error = %v", err)
	}
	if _, err := os.Stat(newSourcePath); err != nil {
		t.Fatalf("Stat(newSourcePath) error = %v", err)
	}
	if _, err := os.Stat(newExecPath); err != nil {
		t.Fatalf("Stat(newExecPath) error = %v", err)
	}
	if _, err := os.Stat(oldBasePath); !os.IsNotExist(err) {
		t.Fatalf("old base path should be renamed away, stat err = %v", err)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected saved task")
	}
	if savedTask.TaskType != newTaskType {
		t.Fatalf("TaskType = %q, want %q", savedTask.TaskType, newTaskType)
	}
	if savedTask.LocalPath == nil || !util.SamePath(*savedTask.LocalPath, newBasePath) {
		t.Fatalf("LocalPath = %v, want %q", savedTask.LocalPath, newBasePath)
	}
	if len(savedTask.SessionList) == 0 || savedTask.SessionList[0].TaskType != newTaskType {
		t.Fatalf("SessionList[0].TaskType = %+v, want %q", savedTask.SessionList, newTaskType)
	}

	sourceRun, err := testStore.GetModelRun(task.ID, "ORIGIN")
	if err != nil {
		t.Fatalf("GetModelRun(ORIGIN) error = %v", err)
	}
	if sourceRun == nil || sourceRun.LocalPath == nil || !util.SamePath(*sourceRun.LocalPath, newSourcePath) {
		t.Fatalf("ORIGIN local path = %v, want %q", sourceRun, newSourcePath)
	}

	execRun, err := testStore.GetModelRun(task.ID, "cotv21-pro")
	if err != nil {
		t.Fatalf("GetModelRun(cotv21-pro) error = %v", err)
	}
	if execRun == nil || execRun.LocalPath == nil || !util.SamePath(*execRun.LocalPath, newExecPath) {
		t.Fatalf("cotv21-pro local path = %v, want %q", execRun, newExecPath)
	}
}
