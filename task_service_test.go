package main

import (
	"strings"
	"testing"
)

func TestCreateTaskUsesProjectScopedIdentity(t *testing.T) {
	testStore := openChatServiceTestStore(t)
	defer testStore.Close()

	service := &TaskService{store: testStore}
	projectAID := "project-1710000000001"
	projectBID := "project-1710000000002"

	taskA, err := service.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectAID,
	})
	if err != nil {
		t.Fatalf("CreateTask(projectA) error = %v", err)
	}

	taskB, err := service.CreateTask(CreateTaskRequest{
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
	testStore := openChatServiceTestStore(t)
	defer testStore.Close()

	service := &TaskService{store: testStore}
	projectID := "project-1710000000001"

	if _, err := service.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectID,
	}); err != nil {
		t.Fatalf("first CreateTask() error = %v", err)
	}

	_, err := service.CreateTask(CreateTaskRequest{
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
