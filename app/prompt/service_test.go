package prompt

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/app/testutil"
	internalprompt "github.com/blueship581/pinru/internal/prompt"
	"github.com/blueship581/pinru/internal/store"
)

func TestSaveTaskPromptSyncsExistingArtifact(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	workDir := t.TempDir()
	artifactPath := filepath.Join(workDir, "任务提示词.md")
	if err := os.WriteFile(artifactPath, []byte("旧提示词\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	s := &PromptService{store: testStore}
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
	if err := s.SaveTaskPrompt(task.ID, expected); err != nil {
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
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	workDir := t.TempDir()
	artifactPath := filepath.Join(workDir, "任务提示词.md")

	s := &PromptService{store: testStore}
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
	if err := s.SaveTaskPrompt(task.ID, expected); err != nil {
		t.Fatalf("SaveTaskPrompt() error = %v", err)
	}

	if _, err := os.Stat(artifactPath); !os.IsNotExist(err) {
		t.Fatalf("artifact should not be created, stat err = %v", err)
	}
}

func TestGenerateTaskPromptRefinesLongBodyBeforeSave(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	workDir := t.TempDir()
	seedPromptRepo(t, workDir)

	task := store.Task{
		ID:              "task-generate-prompt-1",
		GitLabProjectID: 3001,
		ProjectName:     "Prompt Generate Demo",
		TaskType:        "Bug修复",
		LocalPath:       &workDir,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	longBody := "会员列表切换筛选条件和分页后，页面会短暂显示上一组查询结果，运营会误以为刚才的筛选没有生效，还可能继续在旧数据上批量操作，需要保证列表、统计数字和批量选择状态始终只对应最后一次查询。"
	constraintLine := "业务逻辑约束：已失效会员不能再出现在可批量操作名单里。"
	shortBody := "会员列表切换筛选和分页后会短暂显示旧结果，需要确保列表、统计和勾选状态始终只对应最后一次查询。"

	if !internalprompt.PromptBodyExceedsLimit(longBody + "\n" + constraintLine) {
		t.Fatalf("expected long prompt body to exceed %d runes", internalprompt.MaxPromptBodyRunes)
	}
	if internalprompt.PromptBodyExceedsLimit(shortBody + "\n" + constraintLine) {
		t.Fatalf("expected refined prompt body to fit within %d runes", internalprompt.MaxPromptBodyRunes)
	}

	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++

		var responseText string
		switch callCount {
		case 1:
			responseText = longBody + "\n" + constraintLine
		case 2:
			responseText = shortBody
		default:
			t.Fatalf("unexpected provider call count: %d", callCount)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]string{
						"content": responseText,
					},
				},
			},
		}); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}))
	defer server.Close()

	baseURL := server.URL
	if err := testStore.CreateLLMProvider(store.LLMProvider{
		ID:           "provider-openai-mock",
		Name:         "Mock OpenAI",
		ProviderType: "openai_compatible",
		Model:        "gpt-test",
		BaseURL:      &baseURL,
		APIKey:       "test-key",
		IsDefault:    true,
	}); err != nil {
		t.Fatalf("CreateLLMProvider() error = %v", err)
	}

	s := &PromptService{store: testStore}
	result, err := s.GenerateTaskPrompt(GeneratePromptRequest{
		TaskID:      task.ID,
		TaskType:    "Bug修复",
		Scopes:      []string{"单文件"},
		Constraints: []string{"业务逻辑约束"},
	})
	if err != nil {
		t.Fatalf("GenerateTaskPrompt() error = %v", err)
	}

	expected := shortBody + "\n" + constraintLine
	if result.PromptText != expected {
		t.Fatalf("PromptText = %q, want %q", result.PromptText, expected)
	}
	if callCount != 2 {
		t.Fatalf("provider call count = %d, want 2", callCount)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil || savedTask.PromptText == nil || *savedTask.PromptText != expected {
		t.Fatalf("saved PromptText = %v, want %q", savedTask.PromptText, expected)
	}
}

func seedPromptRepo(t *testing.T, workDir string) {
	t.Helper()

	for path, content := range map[string]string{
		".git/HEAD":          "ref: refs/heads/main\n",
		"README.md":          "# Demo Repo\n\n会员管理后台。\n",
		"package.json":       "{\n  \"name\": \"prompt-demo\"\n}\n",
		"src/App.tsx":        "export function App() { return <div>会员管理</div>; }\n",
		"src/member.ts":      "export const members = [];\n",
		"src/member.test.ts": "test('member', () => {});\n",
	} {
		fullPath := filepath.Join(workDir, path)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatalf("MkdirAll(%q) error = %v", fullPath, err)
		}
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", fullPath, err)
		}
	}
}
