package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/internal/store"
)

func TestExtractPromptFromCLIOutputPrefersJSON(t *testing.T) {
	expected := strings.Join([]string{
		"导入大批量订单后列表会先闪一下旧数据，再跳成新数据，运营会误判导入失败，需要保证刷新过程中只展示最新导入结果。",
		"业务逻辑约束：已取消订单不能重新出现在待处理列表。",
	}, "\n")

	payload := map[string]any{
		"version":      1,
		"prompt":       expected,
		"artifactPath": "/tmp/demo/任务提示词.md",
		"fileWritten":  true,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	got, err := extractPromptFromCLIOutput(string(jsonBody))
	if err != nil {
		t.Fatalf("extractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("extractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

func TestExtractPromptFromCLIOutputPrefersMarkers(t *testing.T) {
	expected := strings.Join([]string{
		"购物车里同时勾选多件商品时，结算页的总价偶尔还是上一轮的结果，需要在数量和勾选状态连续变化时保证金额实时正确刷新。",
		"业务逻辑约束：失效商品不能参与结算，总价要和实际可结算商品保持一致。",
	}, "\n")

	output := strings.Join([]string{
		"已完成，结果如下：",
		promptOutputStartMarker,
		expected,
		promptOutputEndMarker,
		"已写入：/tmp/demo/任务提示词.md",
	}, "\n")

	got, err := extractPromptFromCLIOutput(output)
	if err != nil {
		t.Fatalf("extractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("extractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

func TestExtractPromptFromCLIOutputStripsLegacyStatusLines(t *testing.T) {
	expected := strings.Join([]string{
		"支付页切换优惠券后，实付金额偶尔还停留在上一张券的结果，需要保证券切换后总价和优惠明细同步刷新。",
		"业务逻辑约束：不可用优惠券不能参与计算。",
	}, "\n")

	output := strings.Join([]string{
		"已完成，结果如下：",
		"",
		expected,
		"",
		"已写入：/tmp/demo/任务提示词.md",
	}, "\n")

	got, err := extractPromptFromCLIOutput(output)
	if err != nil {
		t.Fatalf("extractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("extractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

func TestPersistGeneratedPromptFallsBackToCLIOutput(t *testing.T) {
	testStore := openChatServiceTestStore(t)
	defer testStore.Close()

	service := &ChatService{store: testStore}
	workDir := t.TempDir()
	task := store.Task{
		ID:              "task-1",
		GitLabProjectID: 1001,
		ProjectName:     "Demo Task",
		TaskType:        "Bug修复",
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	startedAt := int64(1712550000)
	if err := testStore.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		t.Fatalf("StartTaskPromptGeneration() error = %v", err)
	}

	expected := strings.Join([]string{
		"订单列表筛选条件切换得太快时，列表内容会短暂停留在上一组条件，用户会误以为筛选没有生效，需要保证条件切换后只展示最新结果。",
		"代码风格约束：对外函数补全参数和返回值类型。",
	}, "\n")
	output := strings.Join([]string{
		"最终提示词如下：",
		"",
		expected,
		"",
		filepath.Join(workDir, "任务提示词.md"),
	}, "\n")

	promptText, warning, err := service.persistGeneratedPrompt(task.ID, workDir, promptArtifactSnapshot{}, output, startedAt)
	if err != nil {
		t.Fatalf("persistGeneratedPrompt() error = %v", err)
	}
	if promptText != expected {
		t.Fatalf("persistGeneratedPrompt() promptText = %q, want %q", promptText, expected)
	}
	if warning != "" {
		t.Fatalf("persistGeneratedPrompt() warning = %q, want empty", warning)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected saved task")
	}
	if savedTask.PromptText == nil || *savedTask.PromptText != expected {
		t.Fatalf("PromptText = %v, want %q", savedTask.PromptText, expected)
	}
	if savedTask.PromptGenerationStatus != "done" {
		t.Fatalf("PromptGenerationStatus = %q, want done", savedTask.PromptGenerationStatus)
	}

	content, err := os.ReadFile(filepath.Join(workDir, "任务提示词.md"))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.TrimSpace(string(content)) != expected {
		t.Fatalf("artifact content = %q, want %q", strings.TrimSpace(string(content)), expected)
	}
}

func TestPersistGeneratedPromptFallsBackToJSONOutput(t *testing.T) {
	testStore := openChatServiceTestStore(t)
	defer testStore.Close()

	service := &ChatService{store: testStore}
	workDir := t.TempDir()
	task := store.Task{
		ID:              "task-2",
		GitLabProjectID: 1002,
		ProjectName:     "Demo JSON Task",
		TaskType:        "Feature迭代",
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	startedAt := int64(1712550001)
	if err := testStore.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		t.Fatalf("StartTaskPromptGeneration() error = %v", err)
	}

	expected := strings.Join([]string{
		"课程详情页切换不同班型后，价格和开课时间偶尔还是上一种班型的内容，需要让用户每次切换后都只看到当前班型的信息。",
		"非代码回复约束：如果有边界情况，只说明用户会看到什么结果，不要解释技术实现。",
	}, "\n")
	payload := map[string]any{
		"version":      1,
		"prompt":       expected,
		"artifactPath": filepath.Join(workDir, "任务提示词.md"),
		"fileWritten":  false,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	promptText, warning, err := service.persistGeneratedPrompt(task.ID, workDir, promptArtifactSnapshot{}, string(jsonBody), startedAt)
	if err != nil {
		t.Fatalf("persistGeneratedPrompt() error = %v", err)
	}
	if promptText != expected {
		t.Fatalf("persistGeneratedPrompt() promptText = %q, want %q", promptText, expected)
	}
	if warning != "" {
		t.Fatalf("persistGeneratedPrompt() warning = %q, want empty", warning)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil || savedTask.PromptText == nil || *savedTask.PromptText != expected {
		t.Fatalf("PromptText = %v, want %q", savedTask.PromptText, expected)
	}

	content, err := os.ReadFile(filepath.Join(workDir, "任务提示词.md"))
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.TrimSpace(string(content)) != expected {
		t.Fatalf("artifact content = %q, want %q", strings.TrimSpace(string(content)), expected)
	}
}

func TestSaveMessageAsPromptParsesJSONPayload(t *testing.T) {
	testStore := openChatServiceTestStore(t)
	defer testStore.Close()

	service := &ChatService{store: testStore}
	task := store.Task{
		ID:              "task-3",
		GitLabProjectID: 1003,
		ProjectName:     "Demo Save Task",
		TaskType:        "代码生成",
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	session, err := testStore.CreateChatSession(task.ID, "测试会话", "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("CreateChatSession() error = %v", err)
	}

	expected := strings.Join([]string{
		"报名表提交后如果手机号重复，页面现在只会停在原地，没有明确提示，需要直接告诉用户这个手机号已经报过名，并保留其他已填写内容。",
		"业务逻辑约束：同一个活动里同一手机号只能保留一条有效报名记录。",
	}, "\n")
	payload := map[string]any{
		"version":      1,
		"prompt":       expected,
		"artifactPath": "/tmp/demo/任务提示词.md",
		"fileWritten":  true,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	message, err := testStore.AddChatMessage(session.ID, "assistant", string(jsonBody))
	if err != nil {
		t.Fatalf("AddChatMessage() error = %v", err)
	}

	if err := service.SaveMessageAsPrompt(task.ID, message.ID); err != nil {
		t.Fatalf("SaveMessageAsPrompt() error = %v", err)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil || savedTask.PromptText == nil || *savedTask.PromptText != expected {
		t.Fatalf("PromptText = %v, want %q", savedTask.PromptText, expected)
	}
	if savedTask.Status != "PromptReady" {
		t.Fatalf("Status = %q, want PromptReady", savedTask.Status)
	}
}

func openChatServiceTestStore(t *testing.T) *store.Store {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "pinru.db")
	testStore, err := store.Open(
		dbPath,
		migration001,
		migration002,
		migration003,
		migration004,
		migration005,
		migration006,
		migration007,
		migration008,
		migration009,
	)
	if err != nil {
		t.Fatalf("store.Open() error = %v", err)
	}
	return testStore
}
