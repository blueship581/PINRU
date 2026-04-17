package prompt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/app/testutil"
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

func TestSaveTaskPromptCreatesMissingArtifact(t *testing.T) {
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

	content, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.TrimSpace(string(content)) != expected {
		t.Fatalf("artifact content = %q, want %q", strings.TrimSpace(string(content)), expected)
	}
}

func TestBuildPolishSkillPrompt(t *testing.T) {
	result := buildPolishSkillPrompt("  这是一段需要润色的文本。  ")
	if !strings.HasPrefix(result, "/humanizer-zh") {
		t.Fatalf("buildPolishSkillPrompt() prefix = %q", result)
	}
	checks := []string{
		"请把下面内容改成更自然、更口语化的业务描述。",
		"不要出现代码片段、伪代码、命令、路径、变量名或技术实现细节。",
		"重点保留业务现象、用户感知、场景变化和需要补齐的业务处理。",
		"只返回润色后的正文。",
		"这是一段需要润色的文本。",
	}
	for _, want := range checks {
		if !strings.Contains(result, want) {
			t.Fatalf("buildPolishSkillPrompt() missing %q in: %q", want, result)
		}
	}
}

func TestResolveProviderForPolish(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	selection, err := resolveProviderForPolish(testStore, nil)
	if err != nil {
		t.Fatalf("resolveProviderForPolish(no providers) error = %v", err)
	}
	if selection.Model != defaultPromptGenerationModel {
		t.Fatalf("resolveProviderForPolish(no providers).Model = %q, want %q", selection.Model, defaultPromptGenerationModel)
	}

	if err := testStore.CreateLLMProvider(store.LLMProvider{
		ID:           "provider-openai",
		Name:         "OpenAI",
		ProviderType: "openai_compatible",
		Model:        "gpt-5.4",
		APIKey:       "test-key",
		IsDefault:    true,
	}); err != nil {
		t.Fatalf("CreateLLMProvider() error = %v", err)
	}
	if err := testStore.CreateLLMProvider(store.LLMProvider{
		ID:           "provider-claude",
		Name:         "Claude ACP",
		ProviderType: "claude_code_acp",
		Model:        "claude-opus-4-6",
		IsDefault:    false,
	}); err != nil {
		t.Fatalf("CreateLLMProvider() error = %v", err)
	}

	selection, err = resolveProviderForPolish(testStore, nil)
	if err != nil {
		t.Fatalf("resolveProviderForPolish(fallback claude provider) error = %v", err)
	}
	if selection.Name != "Claude ACP" {
		t.Fatalf("resolveProviderForPolish(fallback claude provider).Name = %q, want Claude ACP", selection.Name)
	}

	openaiID := "provider-openai"
	if _, err := resolveProviderForPolish(testStore, &openaiID); err == nil {
		t.Fatalf("resolveProviderForPolish(openai provider) expected error")
	}

	claudeID := "provider-claude"
	selection, err = resolveProviderForPolish(testStore, &claudeID)
	if err != nil {
		t.Fatalf("resolveProviderForPolish(claude provider) error = %v", err)
	}
	if selection.Model != "claude-opus-4-6" {
		t.Fatalf("resolveProviderForPolish(claude provider).Model = %q, want claude-opus-4-6", selection.Model)
	}
}

func TestBuildSkillPrompt(t *testing.T) {
	tests := []struct {
		name     string
		req      GeneratePromptRequest
		contains []string
	}{
		{
			name: "full parameters",
			req: GeneratePromptRequest{
				TaskType:    "Bug修复",
				Scopes:      []string{"单文件", "模块内多文件"},
				Constraints: []string{"业务逻辑约束", "代码风格或规范约束"},
			},
			contains: []string{
				"/评审项目提示词生成 [PINRU]",
				"taskType: Bug修复",
				"constraints: 业务逻辑约束,代码风格或规范约束",
				"scope: 单文件,模块内多文件",
			},
		},
		{
			name: "no constraints",
			req: GeneratePromptRequest{
				TaskType: "代码生成",
				Scopes:   []string{"跨模块多文件"},
			},
			contains: []string{
				"taskType: 代码生成",
				"constraints: 无约束",
				"scope: 跨模块多文件",
			},
		},
		{
			name: "no scope",
			req: GeneratePromptRequest{
				TaskType:    "Feature迭代",
				Constraints: []string{"技术栈或依赖约束"},
			},
			contains: []string{
				"taskType: Feature迭代",
				"constraints: 技术栈或依赖约束",
			},
		},
		{
			name: "with notes",
			req: GeneratePromptRequest{
				TaskType:        "Feature迭代",
				Scopes:          []string{"跨模块多文件"},
				Constraints:     []string{"无约束"},
				AdditionalNotes: strPtr("优先围绕最近改动的看板交互出题"),
			},
			contains: []string{
				"notes: 优先围绕最近改动的看板交互出题",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := buildSkillPrompt(tc.req)
			for _, want := range tc.contains {
				if !strings.Contains(result, want) {
					t.Errorf("buildSkillPrompt() missing %q in:\n%s", want, result)
				}
			}
		})
	}

	// Verify no scope line when scopes are empty
	noScopeResult := buildSkillPrompt(GeneratePromptRequest{
		TaskType:    "Feature迭代",
		Constraints: []string{"技术栈或依赖约束"},
	})
	if strings.Contains(noScopeResult, "scope:") {
		t.Errorf("buildSkillPrompt() should not contain scope line when scopes are empty, got:\n%s", noScopeResult)
	}
}

func TestResolveProviderForPromptGeneration(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	selection, err := resolveProviderForPromptGeneration(testStore, nil)
	if err != nil {
		t.Fatalf("resolveProviderForPromptGeneration(no providers) error = %v", err)
	}
	if err := testStore.CreateLLMProvider(store.LLMProvider{
		ID:           "provider-openai",
		Name:         "OpenAI",
		ProviderType: "openai_compatible",
		Model:        "gpt-5.4",
		APIKey:       "test-key",
		IsDefault:    true,
	}); err != nil {
		t.Fatalf("CreateLLMProvider() error = %v", err)
	}
	if selection.Model != defaultPromptGenerationModel {
		t.Fatalf("resolveProviderForPromptGeneration(no providers).Model = %q, want %q", selection.Model, defaultPromptGenerationModel)
	}

	if err := testStore.CreateLLMProvider(store.LLMProvider{
		ID:           "provider-claude",
		Name:         "Claude ACP",
		ProviderType: "claude_code_acp",
		Model:        "claude-opus-4-6",
		IsDefault:    false,
	}); err != nil {
		t.Fatalf("CreateLLMProvider() error = %v", err)
	}

	selection, err = resolveProviderForPromptGeneration(testStore, nil)
	if err != nil {
		t.Fatalf("resolveProviderForPromptGeneration(fallback claude provider) error = %v", err)
	}
	if selection.Model != "claude-opus-4-6" {
		t.Fatalf("resolveProviderForPromptGeneration(fallback claude provider).Model = %q, want claude-opus-4-6", selection.Model)
	}

	openaiID := "provider-openai"
	if _, err := resolveProviderForPromptGeneration(testStore, &openaiID); err == nil {
		t.Fatalf("resolveProviderForPromptGeneration(openai provider) expected error")
	}

	claudeID := "provider-claude"
	selection, err = resolveProviderForPromptGeneration(testStore, &claudeID)
	if err != nil {
		t.Fatalf("resolveProviderForPromptGeneration(claude provider) error = %v", err)
	}
	if selection.Name != "Claude ACP" {
		t.Fatalf("resolveProviderForPromptGeneration(claude provider).Name = %q, want Claude ACP", selection.Name)
	}
}

func TestResolveProviderForTestPreservesStoredAPIKey(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	if err := testStore.CreateLLMProvider(store.LLMProvider{
		ID:           "provider-openai",
		Name:         "OpenAI",
		ProviderType: "openai_compatible",
		Model:        "gpt-5.4",
		APIKey:       "stored-secret",
		IsDefault:    true,
	}); err != nil {
		t.Fatalf("CreateLLMProvider() error = %v", err)
	}

	svc := &PromptService{store: testStore}
	provider, err := svc.resolveProviderForTest(store.LLMProvider{
		ID:           "provider-openai",
		Name:         "OpenAI",
		ProviderType: "openai_compatible",
		Model:        "gpt-5.4",
		APIKey:       "",
	})
	if err != nil {
		t.Fatalf("resolveProviderForTest() error = %v", err)
	}
	if provider.APIKey != "stored-secret" {
		t.Fatalf("resolveProviderForTest().APIKey = %q, want stored-secret", provider.APIKey)
	}
}

func strPtr(value string) *string {
	return &value
}

func TestExtractPromptFromCLIOutputJSON(t *testing.T) {
	expected := "订单列表筛选条件切换得太快时，列表内容会短暂停留在上一组条件。"
	payload := `{"version":1,"prompt":"` + expected + `","artifactPath":"/tmp/test.md","fileWritten":true}`

	got, err := ExtractPromptFromCLIOutput(payload)
	if err != nil {
		t.Fatalf("ExtractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("ExtractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

// TestExtractPromptFromCLIOutputJSONAfterToolResult 验证当 Claude Code 在最终 payload 前
// 输出了工具调用结果 JSON（如文件写入确认）时，提取仍然能找到正确的提示词 payload。
// 这是历史上的 bug 场景：extractFirstJSONObject 只取第一个 JSON，命中工具结果后
// tryParsePromptJSONPayload 返回 ok=true、err="JSON 中 prompt 为空"，导致直接报错退出。
func TestExtractPromptFromCLIOutputJSONAfterToolResult(t *testing.T) {
	expected := "用户常想回放刚才听过的歌，现在关了页面就找不回播放记录。需要在主界面加一个入口打开历史记录面板，列出最近听过的音乐和播放时间，按最近播放倒序排列，列表里直接点就能重新播放。"
	output := strings.Join([]string{
		`{"type":"tool_result","tool":"Write","status":"ok","path":"/tmp/任务提示词.md"}`,
		`{"version":1,"prompt":"` + expected + `","artifactPath":"/tmp/任务提示词.md","fileWritten":true}`,
	}, "\n")

	got, err := ExtractPromptFromCLIOutput(output)
	if err != nil {
		t.Fatalf("ExtractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("ExtractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

func TestExtractPromptFromCLIOutputMarkers(t *testing.T) {
	expected := "购物车同时勾选多件商品时，结算页的总价偶尔还是上一轮的结果。"
	output := strings.Join([]string{
		"已完成，结果如下：",
		PromptOutputStartMarker,
		expected,
		PromptOutputEndMarker,
		"已写入：/tmp/demo/任务提示词.md",
	}, "\n")

	got, err := ExtractPromptFromCLIOutput(output)
	if err != nil {
		t.Fatalf("ExtractPromptFromCLIOutput() error = %v", err)
	}
	if got != expected {
		t.Fatalf("ExtractPromptFromCLIOutput() = %q, want %q", got, expected)
	}
}

func TestExtractHumanizedTextFromCLIOutput(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{
			name:  "plain text",
			input: "这是一段更自然、更像人写的表达。",
			want:  "这是一段更自然、更像人写的表达。",
		},
		{
			name:  "with lead in",
			input: "以下是润色后的文本：\n\n这是一段更自然的表达。",
			want:  "这是一段更自然的表达。",
		},
		{
			name:  "with code fence",
			input: "```markdown\n这是一段放在代码块里的自然表达。\n```",
			want:  "这是一段放在代码块里的自然表达。",
		},
		{
			name: "with explanation and body",
			input: strings.Join([]string{
				"我已经将文本调整为更自然的表达：",
				"",
				"这是一段最终正文，应该被提取出来。",
			}, "\n"),
			want: "这是一段最终正文，应该被提取出来。",
		},
		{
			name:    "empty",
			input:   "   ",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ExtractHumanizedTextFromCLIOutput(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ExtractHumanizedTextFromCLIOutput() expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("ExtractHumanizedTextFromCLIOutput() error = %v", err)
			}
			if got != tc.want {
				t.Fatalf("ExtractHumanizedTextFromCLIOutput() = %q, want %q", got, tc.want)
			}
		})
	}
}
