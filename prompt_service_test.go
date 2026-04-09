package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/internal/store"
)

func TestSaveTaskPromptSyncsExistingArtifact(t *testing.T) {
	testStore := openChatServiceTestStore(t)
	defer testStore.Close()

	workDir := t.TempDir()
	artifactPath := filepath.Join(workDir, "任务提示词.md")
	if err := os.WriteFile(artifactPath, []byte("旧提示词\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	service := &PromptService{store: testStore}
	task := store.Task{
		ID:              "task-save-prompt-1",
		GitLabProjectID: 2001,
		ProjectName:     "Prompt Save Demo",
		TaskType:        "Bug修复",
		LocalPath:       &workDir,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	expected := strings.Join([]string{
		"订单备注编辑后立即切回列表页时，新备注偶尔不会展示，需要保证保存成功后列表和详情都显示最新备注。",
		"业务逻辑约束：空备注要按清空处理，不能回退到旧值。",
	}, "\n")
	if err := service.SaveTaskPrompt(task.ID, expected); err != nil {
		t.Fatalf("SaveTaskPrompt() error = %v", err)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil || savedTask.PromptText == nil || *savedTask.PromptText != expected {
		t.Fatalf("PromptText = %v, want %q", savedTask.PromptText, expected)
	}

	content, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.TrimSpace(string(content)) != expected {
		t.Fatalf("artifact content = %q, want %q", strings.TrimSpace(string(content)), expected)
	}
}

func TestSaveTaskPromptSkipsMissingArtifact(t *testing.T) {
	testStore := openChatServiceTestStore(t)
	defer testStore.Close()

	workDir := t.TempDir()
	artifactPath := filepath.Join(workDir, "任务提示词.md")

	service := &PromptService{store: testStore}
	task := store.Task{
		ID:              "task-save-prompt-2",
		GitLabProjectID: 2002,
		ProjectName:     "Prompt Save No Artifact",
		TaskType:        "Feature迭代",
		LocalPath:       &workDir,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	expected := "筛选条件连续切换时，列表需要始终展示最后一次筛选结果。"
	if err := service.SaveTaskPrompt(task.ID, expected); err != nil {
		t.Fatalf("SaveTaskPrompt() error = %v", err)
	}

	if _, err := os.Stat(artifactPath); !os.IsNotExist(err) {
		t.Fatalf("artifact should not be created, stat err = %v", err)
	}
}
