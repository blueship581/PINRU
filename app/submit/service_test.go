package submit

import (
	"fmt"
	"strings"
	"testing"

	"github.com/blueship581/pinru/app/testutil"
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
