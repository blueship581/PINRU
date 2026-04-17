package chat

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	appcli "github.com/blueship581/pinru/app/cli"
	appprompt "github.com/blueship581/pinru/app/prompt"
	"github.com/blueship581/pinru/app/testutil"
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

	got, err := appprompt.ExtractPromptFromCLIOutput(string(jsonBody))
	if err != nil {
		t.Fatalf("appprompt.ExtractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("appprompt.ExtractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

func TestExtractPromptFromCLIOutputPrefersMarkers(t *testing.T) {
	expected := strings.Join([]string{
		"购物车里同时勾选多件商品时，结算页的总价偶尔还是上一轮的结果，需要在数量和勾选状态连续变化时保证金额实时正确刷新。",
		"业务逻辑约束：失效商品不能参与结算，总价要和实际可结算商品保持一致。",
	}, "\n")

	output := strings.Join([]string{
		"已完成，结果如下：",
		appprompt.PromptOutputStartMarker,
		expected,
		appprompt.PromptOutputEndMarker,
		"已写入：/tmp/demo/任务提示词.md",
	}, "\n")

	got, err := appprompt.ExtractPromptFromCLIOutput(output)
	if err != nil {
		t.Fatalf("appprompt.ExtractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("appprompt.ExtractPromptFromCLIOutput() = %q, want %q", got, expected)
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

	got, err := appprompt.ExtractPromptFromCLIOutput(output)
	if err != nil {
		t.Fatalf("appprompt.ExtractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("appprompt.ExtractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

func TestExtractHumanizedTextFromCLIOutputDoesNotAffectPromptParsing(t *testing.T) {
	output := strings.Join([]string{
		"以下是润色后的文本：",
		"",
		"这是一段更自然的表达。",
	}, "\n")

	got, err := appprompt.ExtractHumanizedTextFromCLIOutput(output)
	if err != nil {
		t.Fatalf("appprompt.ExtractHumanizedTextFromCLIOutput() error = %v", err)
	}
	if got != "这是一段更自然的表达。" {
		t.Fatalf("appprompt.ExtractHumanizedTextFromCLIOutput() = %q", got)
	}
}

func TestPersistGeneratedPromptFallsBackToCLIOutput(t *testing.T) {
	s := &ChatService{store: testutil.OpenTestStore(t)}

	workDir := t.TempDir()
	task := store.Task{
		ID:              "task-1",
		GitLabProjectID: 1001,
		ProjectName:     "Demo Task",
		TaskType:        "Bug修复",
	}
	if err := s.store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	startedAt := int64(1712550000)
	if err := s.store.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		t.Fatalf("StartTaskPromptGeneration() error = %v", err)
	}

	expected := strings.Join([]string{
		"订单列表筛选条件切换得太快时，列表内容会短暂停留在上一组条件，用户会误以为筛选没有生效，还可能继续在旧数据上批量操作，需要保证条件切换后只展示最新结果。",
		"代码风格约束：对外函数补全参数和返回值类型。",
	}, "\n")
	output := strings.Join([]string{
		"最终提示词如下：",
		"",
		expected,
		"",
		filepath.Join(workDir, "任务提示词.md"),
	}, "\n")

	promptText, warning, err := s.persistGeneratedPrompt(task.ID, workDir, promptArtifactSnapshot{}, output, startedAt)
	if err != nil {
		t.Fatalf("persistGeneratedPrompt() error = %v", err)
	}
	if promptText != expected {
		t.Fatalf("persistGeneratedPrompt() promptText = %q, want %q", promptText, expected)
	}
	if warning != "" {
		t.Fatalf("persistGeneratedPrompt() warning = %q, want empty", warning)
	}

	savedTask, err := s.store.GetTask(task.ID)
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
	s := &ChatService{store: testutil.OpenTestStore(t)}

	workDir := t.TempDir()
	task := store.Task{
		ID:              "task-2",
		GitLabProjectID: 1002,
		ProjectName:     "Demo JSON Task",
		TaskType:        "Feature迭代",
	}
	if err := s.store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	startedAt := int64(1712550001)
	if err := s.store.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
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

	promptText, warning, err := s.persistGeneratedPrompt(task.ID, workDir, promptArtifactSnapshot{}, string(jsonBody), startedAt)
	if err != nil {
		t.Fatalf("persistGeneratedPrompt() error = %v", err)
	}
	if promptText != expected {
		t.Fatalf("persistGeneratedPrompt() promptText = %q, want %q", promptText, expected)
	}
	if warning != "" {
		t.Fatalf("persistGeneratedPrompt() warning = %q, want empty", warning)
	}

	savedTask, err := s.store.GetTask(task.ID)
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

func TestResolveGeneratedPromptBeforeDonePrefersJSONPayload(t *testing.T) {
	expected := strings.Join([]string{
		"筛选栏快速切换条件时列表会闪回旧结果，需要保证页面始终只展示最后一次筛选对应的数据。",
		"业务逻辑约束：已失效的数据不能重新出现在筛选结果里。",
	}, "\n")
	payload := map[string]any{
		"version":      1,
		"prompt":       expected,
		"artifactPath": "/tmp/demo/任务提示词.md",
		"fileWritten":  false,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	promptText, fromFile, ready, err := resolveGeneratedPromptBeforeDone(t.TempDir(), promptArtifactSnapshot{}, string(jsonBody))
	if err != nil {
		t.Fatalf("resolveGeneratedPromptBeforeDone() error = %v", err)
	}
	if !ready {
		t.Fatalf("resolveGeneratedPromptBeforeDone() ready = false, want true")
	}
	if fromFile {
		t.Fatalf("resolveGeneratedPromptBeforeDone() fromFile = true, want false")
	}
	if promptText != expected {
		t.Fatalf("resolveGeneratedPromptBeforeDone() promptText = %q, want %q", promptText, expected)
	}
}

func TestTryPersistGeneratedPromptBeforeDoneCompletesTask(t *testing.T) {
	s := &ChatService{store: testutil.OpenTestStore(t)}

	workDir := t.TempDir()
	task := store.Task{
		ID:              "task-early-persist",
		GitLabProjectID: 1005,
		ProjectName:     "Demo Early Persist",
		TaskType:        "Bug修复",
	}
	if err := s.store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	startedAt := int64(1712550002)
	if err := s.store.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		t.Fatalf("StartTaskPromptGeneration() error = %v", err)
	}

	expected := strings.Join([]string{
		"订单列表切换页码时会短暂显示上一页的数据，需要保证翻页后只出现当前页内容。",
		"业务逻辑约束：已删除订单不能重新显示。",
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

	promptText, warning, ready, err := s.tryPersistGeneratedPromptBeforeDone(task.ID, workDir, promptArtifactSnapshot{}, string(jsonBody), startedAt)
	if err != nil {
		t.Fatalf("tryPersistGeneratedPromptBeforeDone() error = %v", err)
	}
	if !ready {
		t.Fatalf("tryPersistGeneratedPromptBeforeDone() ready = false, want true")
	}
	if promptText != expected {
		t.Fatalf("tryPersistGeneratedPromptBeforeDone() promptText = %q, want %q", promptText, expected)
	}
	if warning != "" {
		t.Fatalf("tryPersistGeneratedPromptBeforeDone() warning = %q, want empty", warning)
	}

	savedTask, err := s.store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil || savedTask.PromptText == nil || *savedTask.PromptText != expected {
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

func TestSaveMessageAsPromptParsesJSONPayload(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &ChatService{store: testStore}
	workDir := t.TempDir()
	artifactPath := filepath.Join(workDir, "任务提示词.md")
	if err := os.WriteFile(artifactPath, []byte("旧提示词\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	task := store.Task{
		ID:              "task-3",
		GitLabProjectID: 1003,
		ProjectName:     "Demo Save Task",
		TaskType:        "代码生成",
		LocalPath:       &workDir,
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

	if err := s.SaveMessageAsPrompt(task.ID, message.ID); err != nil {
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

	content, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.TrimSpace(string(content)) != expected {
		t.Fatalf("artifact content = %q, want %q", strings.TrimSpace(string(content)), expected)
	}
}

func TestSaveMessageAsPromptCreatesMissingArtifact(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &ChatService{store: testStore}
	workDir := t.TempDir()
	artifactPath := filepath.Join(workDir, "任务提示词.md")
	task := store.Task{
		ID:              "task-4",
		GitLabProjectID: 1004,
		ProjectName:     "Demo Save No Artifact",
		TaskType:        "Bug修复",
		LocalPath:       &workDir,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	session, err := testStore.CreateChatSession(task.ID, "测试会话", "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("CreateChatSession() error = %v", err)
	}

	expected := strings.Join([]string{
		"批量勾选学员后执行导出，如果中途切换筛选条件，导出结果有时还是旧筛选范围，需要保证导出始终使用用户最后一次确认的筛选结果。",
		"业务逻辑约束：没有导出权限的班级不能出现在最终导出文件里。",
	}, "\n")
	message, err := testStore.AddChatMessage(session.ID, "assistant", expected)
	if err != nil {
		t.Fatalf("AddChatMessage() error = %v", err)
	}

	if err := s.SaveMessageAsPrompt(task.ID, message.ID); err != nil {
		t.Fatalf("SaveMessageAsPrompt() error = %v", err)
	}

	content, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.TrimSpace(string(content)) != expected {
		t.Fatalf("artifact content = %q, want %q", strings.TrimSpace(string(content)), expected)
	}
}

func TestListSessionsFiltersByModel(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &ChatService{store: testStore}
	task := store.Task{
		ID:              "task-list-sessions",
		GitLabProjectID: 1004,
		ProjectName:     "Demo Session Filter",
		TaskType:        "Bug修复",
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	sonnetSessionA, err := testStore.CreateChatSession(task.ID, "Sonnet A", "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("CreateChatSession(sonnet A) error = %v", err)
	}
	opusSession, err := testStore.CreateChatSession(task.ID, "Opus", "claude-opus-4-6")
	if err != nil {
		t.Fatalf("CreateChatSession(opus) error = %v", err)
	}
	sonnetSessionB, err := testStore.CreateChatSession(task.ID, "Sonnet B", "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("CreateChatSession(sonnet B) error = %v", err)
	}

	sonnetSessions, err := s.ListSessions(task.ID, "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("ListSessions(sonnet) error = %v", err)
	}
	if len(sonnetSessions) != 2 {
		t.Fatalf("ListSessions(sonnet) len = %d, want 2", len(sonnetSessions))
	}

	sonnetIDs := map[string]bool{
		sonnetSessionA.ID: false,
		sonnetSessionB.ID: false,
	}
	for _, session := range sonnetSessions {
		if session.Model != "claude-sonnet-4-6" {
			t.Fatalf("ListSessions(sonnet) returned model %q, want claude-sonnet-4-6", session.Model)
		}
		if _, ok := sonnetIDs[session.ID]; !ok {
			t.Fatalf("ListSessions(sonnet) returned unexpected session %q", session.ID)
		}
		sonnetIDs[session.ID] = true
	}
	for id, seen := range sonnetIDs {
		if !seen {
			t.Fatalf("ListSessions(sonnet) missing session %q", id)
		}
	}

	opusSessions, err := s.ListSessions(task.ID, "claude-opus-4-6")
	if err != nil {
		t.Fatalf("ListSessions(opus) error = %v", err)
	}
	if len(opusSessions) != 1 {
		t.Fatalf("ListSessions(opus) len = %d, want 1", len(opusSessions))
	}
	if opusSessions[0].ID != opusSession.ID {
		t.Fatalf("ListSessions(opus)[0].ID = %q, want %q", opusSessions[0].ID, opusSession.ID)
	}
}

func TestSendMessageStartupFailureCleansMessagesAndFailsPromptGeneration(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	workDir := t.TempDir()
	task := store.Task{
		ID:              "task-send-fail",
		GitLabProjectID: 1004,
		ProjectName:     "Demo Send Fail",
		TaskType:        "Bug修复",
		LocalPath:       &workDir,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	session, err := testStore.CreateChatSession(task.ID, "测试会话", "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("CreateChatSession() error = %v", err)
	}

	// Simulate an environment where the claude binary is unavailable by using a
	// resolver that always fails (t.Setenv alone is insufficient because
	// ResolveCLI also checks hardcoded paths and the login shell).
	unavailableCLI := appcli.NewWithResolver(func(name string) (string, error) {
		return "", fmt.Errorf("%s: binary not found (simulated for test)", name)
	})
	s := &ChatService{store: testStore, cliSvc: unavailableCLI}

	_, err = s.SendMessage(SendMessageRequest{
		SessionID:      session.ID,
		Content:        "请帮我生成提示词",
		Model:          "claude-sonnet-4-6",
		ThinkingDepth:  "",
		Mode:           "agent",
		WorkDir:        workDir,
		PermissionMode: "",
		AutoSavePrompt: true,
	})
	if err == nil {
		t.Fatalf("expected SendMessage() to fail when claude is unavailable")
	}

	messages, err := testStore.ListChatMessages(session.ID)
	if err != nil {
		t.Fatalf("ListChatMessages() error = %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("expected failed startup to cleanup messages, got %d", len(messages))
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected task after SendMessage failure")
	}
	if savedTask.PromptGenerationStatus != "error" {
		t.Fatalf("PromptGenerationStatus = %q, want error", savedTask.PromptGenerationStatus)
	}
	if savedTask.PromptGenerationError == nil || !strings.Contains(*savedTask.PromptGenerationError, "启动失败") {
		t.Fatalf("PromptGenerationError = %v, want startup failure message", savedTask.PromptGenerationError)
	}
}
