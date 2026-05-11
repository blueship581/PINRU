package submit

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/github"
	"github.com/blueship581/pinru/internal/store"
)

func TestPersistModelRunStateClearsSubmitErrorOnSuccess(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &SubmitService{store: testStore}
	taskID := "task-submit-success"
	modelName := "claude-3-7"

	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-submit-success",
		TaskID:    taskID,
		ModelName: modelName,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}
	if err := testStore.SetModelRunError(taskID, modelName, "previous failure"); err != nil {
		t.Fatalf("SetModelRunError() error = %v", err)
	}

	branchName := "feature/claude-3-7"
	prURL := "https://github.com/demo/repo/pull/1"
	startedAt := int64(1712550000)
	finishedAt := int64(1712550300)
	if err := s.persistModelRunState(
		taskID,
		modelName,
		"done",
		&branchName,
		&prURL,
		&startedAt,
		&finishedAt,
		stringPtr(""),
		nil,
	); err != nil {
		t.Fatalf("persistModelRunState() error = %v", err)
	}

	run, err := testStore.GetModelRun(taskID, modelName)
	if err != nil {
		t.Fatalf("GetModelRun() error = %v", err)
	}
	if run == nil {
		t.Fatalf("expected model run to exist")
	}
	if run.Status != "done" {
		t.Fatalf("Status = %q, want done", run.Status)
	}
	if run.BranchName == nil || *run.BranchName != branchName {
		t.Fatalf("BranchName = %v, want %q", run.BranchName, branchName)
	}
	if run.PrURL == nil || *run.PrURL != prURL {
		t.Fatalf("PrURL = %v, want %q", run.PrURL, prURL)
	}
	if run.SubmitError == nil || *run.SubmitError != "" {
		t.Fatalf("SubmitError = %v, want empty string", run.SubmitError)
	}
}

func TestFailTaskAndModelRunPersistsErrorState(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &SubmitService{store: testStore}
	taskID := "task-submit-failure"
	modelName := "ORIGIN"

	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 1850,
		ProjectName:     "label-01850",
		TaskType:        "Feature迭代",
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-submit-failure",
		TaskID:    taskID,
		ModelName: modelName,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}

	startedAt := int64(1712551000)
	cause := fmt.Errorf("Git 推送失败")
	if err := s.failTaskAndModelRun(taskID, "Error", modelName, nil, startedAt, cause); err != nil {
		t.Fatalf("failTaskAndModelRun() error = %v", err)
	}

	task, err := testStore.GetTask(taskID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if task == nil {
		t.Fatalf("expected task to exist")
	}
	if task.Status != "Error" {
		t.Fatalf("Status = %q, want Error", task.Status)
	}

	run, err := testStore.GetModelRun(taskID, modelName)
	if err != nil {
		t.Fatalf("GetModelRun() error = %v", err)
	}
	if run == nil {
		t.Fatalf("expected model run to exist")
	}
	if run.Status != "error" {
		t.Fatalf("Status = %q, want error", run.Status)
	}
	if run.SubmitError == nil || !strings.Contains(*run.SubmitError, cause.Error()) {
		t.Fatalf("SubmitError = %v, want containing %q", run.SubmitError, cause.Error())
	}
	if run.FinishedAt == nil {
		t.Fatalf("FinishedAt = nil, want timestamp")
	}
}

func TestFindModelRunFolderForSubmitPrefersExactModelFolder(t *testing.T) {
	taskDir := t.TempDir()
	exactPath := filepath.Join(taskDir, "TestM_2")
	containingPath := filepath.Join(taskDir, "B-951-TestM_2")
	if err := os.Mkdir(exactPath, 0o755); err != nil {
		t.Fatalf("Mkdir(exactPath) error = %v", err)
	}
	if err := os.Mkdir(containingPath, 0o755); err != nil {
		t.Fatalf("Mkdir(containingPath) error = %v", err)
	}

	task := &store.Task{LocalPath: &taskDir}
	got := findModelRunFolderForSubmit(task, nil, nil, "TestM_2")
	if got != exactPath {
		t.Fatalf("findModelRunFolderForSubmit() = %q, want %q", got, exactPath)
	}
}

func TestFindModelRunFolderForSubmitFallsBackToContainingModelFolder(t *testing.T) {
	taskDir := t.TempDir()
	containingPath := filepath.Join(taskDir, "B-951-TestM_3")
	if err := os.Mkdir(containingPath, 0o755); err != nil {
		t.Fatalf("Mkdir(containingPath) error = %v", err)
	}

	task := &store.Task{LocalPath: &taskDir}
	got := findModelRunFolderForSubmit(task, nil, nil, "TestM_3")
	if got != containingPath {
		t.Fatalf("findModelRunFolderForSubmit() = %q, want %q", got, containingPath)
	}
}

func TestResolveModelRunPathForSubmitUpdatesStoredLocalPath(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	taskID := "task-submit-path"
	modelName := "TestM_2"
	taskDir := t.TempDir()
	matchedPath := filepath.Join(taskDir, "B-951-TestM_2")
	if err := os.Mkdir(matchedPath, 0o755); err != nil {
		t.Fatalf("Mkdir(matchedPath) error = %v", err)
	}

	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 951,
		ProjectName:     "B-951",
		TaskType:        "bug修复",
		LocalPath:       &taskDir,
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	stalePath := filepath.Join(taskDir, modelName)
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-submit-path",
		TaskID:    taskID,
		ModelName: modelName,
		LocalPath: &stalePath,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}

	s := &SubmitService{store: testStore}
	task, err := testStore.GetTask(taskID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	run, err := testStore.GetModelRun(taskID, modelName)
	if err != nil {
		t.Fatalf("GetModelRun() error = %v", err)
	}

	got, err := s.resolveModelRunPathForSubmit(task, nil, run, modelName)
	if err != nil {
		t.Fatalf("resolveModelRunPathForSubmit() error = %v", err)
	}
	if got != matchedPath {
		t.Fatalf("resolveModelRunPathForSubmit() = %q, want %q", got, matchedPath)
	}

	updatedRun, err := testStore.GetModelRun(taskID, modelName)
	if err != nil {
		t.Fatalf("GetModelRun(updated) error = %v", err)
	}
	if updatedRun.LocalPath == nil || *updatedRun.LocalPath != matchedPath {
		t.Fatalf("updated LocalPath = %v, want %q", updatedRun.LocalPath, matchedPath)
	}
}

func TestPrepareGitHubRepositoryUsesEnsureByDefault(t *testing.T) {
	previousEnsure := ensureGitHubRepository
	previousRecreate := recreateGitHubRepository
	t.Cleanup(func() {
		ensureGitHubRepository = previousEnsure
		recreateGitHubRepository = previousRecreate
	})

	ensureCalls := 0
	recreateCalls := 0
	ensureGitHubRepository = func(targetRepo, token string, description *string) (*github.Repo, error) {
		ensureCalls++
		return &github.Repo{HTMLURL: "https://github.com/octo/demo"}, nil
	}
	recreateGitHubRepository = func(targetRepo, token string, description *string) (*github.Repo, error) {
		recreateCalls++
		return nil, fmt.Errorf("unexpected recreate")
	}

	repo, err := prepareGitHubRepository("octo/demo", "token", stringPtr("Demo"), false)
	if err != nil {
		t.Fatalf("prepareGitHubRepository() error = %v", err)
	}
	if repo == nil || repo.HTMLURL != "https://github.com/octo/demo" {
		t.Fatalf("repo = %+v, want ensured repo", repo)
	}
	if ensureCalls != 1 {
		t.Fatalf("ensureCalls = %d, want 1", ensureCalls)
	}
	if recreateCalls != 0 {
		t.Fatalf("recreateCalls = %d, want 0", recreateCalls)
	}
}

func TestPrepareGitHubRepositoryUsesRecreateWhenRequested(t *testing.T) {
	previousEnsure := ensureGitHubRepository
	previousRecreate := recreateGitHubRepository
	t.Cleanup(func() {
		ensureGitHubRepository = previousEnsure
		recreateGitHubRepository = previousRecreate
	})

	ensureCalls := 0
	recreateCalls := 0
	ensureGitHubRepository = func(targetRepo, token string, description *string) (*github.Repo, error) {
		ensureCalls++
		return nil, fmt.Errorf("unexpected ensure")
	}
	recreateGitHubRepository = func(targetRepo, token string, description *string) (*github.Repo, error) {
		recreateCalls++
		return &github.Repo{HTMLURL: "https://github.com/octo/demo"}, nil
	}

	repo, err := prepareGitHubRepository("octo/demo", "token", stringPtr("Demo"), true)
	if err != nil {
		t.Fatalf("prepareGitHubRepository() error = %v", err)
	}
	if repo == nil || repo.HTMLURL != "https://github.com/octo/demo" {
		t.Fatalf("repo = %+v, want recreated repo", repo)
	}
	if ensureCalls != 0 {
		t.Fatalf("ensureCalls = %d, want 0", ensureCalls)
	}
	if recreateCalls != 1 {
		t.Fatalf("recreateCalls = %d, want 1", recreateCalls)
	}
}

func TestResolveTaskSourceModelNameUsesProjectSourceFolder(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	projectID := "project-submit-source"
	if err := testStore.CreateProject(store.Project{
		ID:                projectID,
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,claude-code",
		SourceModelFolder: "SOURCE",
	}); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}
	taskID := "task-submit-source"
	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 1851,
		ProjectName:     "Demo",
		TaskType:        "Bug修复",
		ProjectConfigID: &projectID,
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	s := &SubmitService{store: testStore}
	task, err := testStore.GetTask(taskID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if task == nil {
		t.Fatalf("expected task to exist")
	}
	if got := s.resolveTaskSourceModelName(task, ""); got != "SOURCE" {
		t.Fatalf("resolveTaskSourceModelName() = %q, want SOURCE", got)
	}
}
