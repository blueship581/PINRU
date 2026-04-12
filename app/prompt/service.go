package prompt

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	appcli "github.com/blueship581/pinru/app/cli"
	"github.com/blueship581/pinru/internal/llm"
	internalprompt "github.com/blueship581/pinru/internal/prompt"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

// Service handles prompt generation and storage for tasks.
type PromptService struct {
	store  *store.Store
	cliSvc *appcli.CliService
}

// NewService creates a new prompt service.
func New(store *store.Store, cliSvc *appcli.CliService) *PromptService {
	return &PromptService{store: store, cliSvc: cliSvc}
}

// GeneratePromptRequest carries parameters for prompt generation.
type GeneratePromptRequest struct {
	TaskID          string   `json:"taskId"`
	ProviderID      *string  `json:"providerId"`
	TaskType        string   `json:"taskType"`
	Scopes          []string `json:"scopes"`
	Constraints     []string `json:"constraints"`
	AdditionalNotes *string  `json:"additionalNotes"`
	ThinkingBudget  string   `json:"thinkingBudget"`
}

// PromptGenerationResult is returned after a successful generation.
type PromptGenerationResult struct {
	PromptText   string `json:"promptText"`
	ProviderName string `json:"providerName"`
	Model        string `json:"model"`
	Status       string `json:"status"`
}

const defaultPromptGenerationModel = "claude-sonnet-4-6"

func (s *PromptService) GenerateTaskPrompt(req GeneratePromptRequest) (*PromptGenerationResult, error) {
	return s.GenerateTaskPromptWithContext(context.Background(), req)
}

func (s *PromptService) TestLLMProvider(provider store.LLMProvider) (bool, error) {
	resolved, err := s.resolveProviderForTest(provider)
	if err != nil {
		return false, err
	}

	client, err := llm.BuildProvider(llm.Config{
		ID:           resolved.ID,
		Name:         resolved.Name,
		ProviderType: resolved.ProviderType,
		Model:        resolved.Model,
		BaseURL:      resolved.BaseURL,
		APIKey:       resolved.APIKey,
		IsDefault:    resolved.IsDefault,
	})
	if err != nil {
		return false, err
	}

	if err := client.TestConnection(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *PromptService) GenerateTaskPromptWithContext(ctx context.Context, req GeneratePromptRequest) (*PromptGenerationResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if strings.TrimSpace(req.TaskID) == "" {
		return nil, fmt.Errorf("任务不能为空")
	}
	if strings.TrimSpace(req.TaskType) == "" {
		return nil, fmt.Errorf("任务类型不能为空")
	}

	task, err := s.store.GetTask(req.TaskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("未找到任务: %s", req.TaskID)
	}
	if task.LocalPath == nil {
		return nil, fmt.Errorf("当前任务没有本地代码目录，请先完成领题 Clone")
	}

	if _, err := s.cliSvc.CheckCLI(); err != nil {
		return nil, fmt.Errorf("请先安装 Claude Code CLI: npm install -g @anthropic-ai/claude-code")
	}

	selection, err := resolveProviderForPromptGeneration(s.store, req.ProviderID)
	if err != nil {
		return nil, err
	}

	startedAt := time.Now().Unix()
	if err := s.store.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		return nil, err
	}

	// Build the [PINRU] skill prompt
	skillPrompt := buildSkillPrompt(req)

	// Execute CLI Agent with one automatic retry on failure
	workDir := util.NormalizePath(*task.LocalPath)
	promptText, err := s.executeCliWithRetry(ctx, workDir, skillPrompt, selection.Model, 1)
	if err != nil {
		errMsg := normalizePromptGenerationError(err)
		if failErr := s.store.FailTaskPromptGeneration(task.ID, errMsg, startedAt); failErr != nil {
			return nil, fmt.Errorf("%s；提示词状态回写失败: %v", errMsg, failErr)
		}
		return nil, fmt.Errorf("%s", errMsg)
	}

	if err := s.store.CompleteTaskPromptGeneration(task.ID, promptText, startedAt); err != nil {
		return nil, err
	}
	BestEffortSyncTaskPromptArtifact(task, promptText)

	return &PromptGenerationResult{
		PromptText:   promptText,
		ProviderName: selection.Name,
		Model:        selection.Model,
		Status:       "PromptReady",
	}, nil
}

func (s *PromptService) SaveTaskPrompt(taskID, promptText string) error {
	if strings.TrimSpace(taskID) == "" {
		return fmt.Errorf("任务不能为空")
	}
	if strings.TrimSpace(promptText) == "" {
		return fmt.Errorf("提示词内容不能为空")
	}

	task, err := LoadTaskForPromptSync(s.store, taskID)
	if err != nil {
		return err
	}

	if err := s.store.UpdateTaskPrompt(taskID, promptText); err != nil {
		return err
	}

	BestEffortSyncTaskPromptArtifact(task, promptText)
	return nil
}

// ── CLI Agent 执行 ──────────────────────────────────────────────────────────

// executeCliWithRetry 执行 CLI Agent 生成提示词，失败时自动重试指定次数。
func (s *PromptService) executeCliWithRetry(ctx context.Context, workDir, prompt, model string, maxRetries int) (string, error) {
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		promptText, err := s.executeCliPromptGeneration(ctx, workDir, prompt, model)
		if err == nil {
			return promptText, nil
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", err
		}
		lastErr = err
	}
	return "", fmt.Errorf("提示词生成失败，已重试 %d 次。请检查 Claude Code 配置后重试。最后一次错误: %v", maxRetries, lastErr)
}

// executeCliPromptGeneration 启动一次 CLI Agent 执行并从输出中提取提示词。
func (s *PromptService) executeCliPromptGeneration(ctx context.Context, workDir, prompt, model string) (string, error) {
	additionalDirs := cliAdditionalDirs()

	resp, err := s.cliSvc.StartClaude(appcli.StartClaudeRequest{
		WorkDir:        workDir,
		Prompt:         prompt,
		Model:          model,
		PermissionMode: "bypassPermissions",
		AdditionalDirs: additionalDirs,
	})
	if err != nil {
		return "", fmt.Errorf("启动 Claude Code 失败: %w", err)
	}

	output, err := s.waitForCliCompletion(ctx, resp.SessionID)
	if err != nil {
		return "", err
	}

	promptText, err := ExtractPromptFromCLIOutput(output)
	if err != nil {
		return "", fmt.Errorf("无法从 Agent 输出中提取提示词: %w", err)
	}

	return promptText, nil
}

// waitForCliCompletion 同步轮询等待 CLI 执行完成，返回完整输出。
func (s *PromptService) waitForCliCompletion(ctx context.Context, sessionID string) (string, error) {
	var lines []string
	offset := 0

	for {
		select {
		case <-ctx.Done():
			_ = s.cliSvc.CancelSession(sessionID)
			return "", ctx.Err()
		default:
		}

		poll, err := s.cliSvc.PollOutput(appcli.PollOutputRequest{
			SessionID: sessionID,
			Offset:    offset,
		})
		if err != nil {
			return "", fmt.Errorf("轮询 CLI 输出失败: %w", err)
		}

		lines = append(lines, poll.Lines...)
		offset += len(poll.Lines)

		if poll.Done {
			if poll.ErrMsg != "" {
				return "", fmt.Errorf("Claude Code 执行出错: %s", poll.ErrMsg)
			}
			combined := strings.Join(lines, "\n")
			if strings.Contains(combined, "No available accounts") || strings.Contains(combined, "no available accounts") {
				return "", fmt.Errorf("Claude Code ACP 账号池暂时耗尽（503），请稍后重试或检查 ACP 配置")
			}
			return combined, nil
		}

		timer := time.NewTimer(500 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			_ = s.cliSvc.CancelSession(sessionID)
			return "", ctx.Err()
		case <-timer.C:
		}
	}
}

// ── 辅助函数 ────────────────────────────────────────────────────────────────

// buildSkillPrompt 构建 Claude Code 技能调用格式的消息。
// 使用 "/技能名 参数" 格式，这是 claude -p 模式下唯一能正确触发
// skill 加载（展开 SKILL.md 完整内容到上下文）的方式。
// XML 标签格式（<command-name>）在非交互模式下不会触发 skill 展开。
func buildSkillPrompt(req GeneratePromptRequest) string {
	const skillName = "评审项目提示词生成"
	var sb strings.Builder
	sb.WriteString("/")
	sb.WriteString(skillName)
	sb.WriteString(" [PINRU]\ntaskType: ")
	sb.WriteString(internalprompt.NormalizeTaskType(req.TaskType))
	sb.WriteString("\n")

	if len(req.Constraints) > 0 {
		sb.WriteString("constraints: ")
		sb.WriteString(strings.Join(req.Constraints, ","))
		sb.WriteString("\n")
	} else {
		sb.WriteString("constraints: 无约束\n")
	}

	if len(req.Scopes) > 0 {
		sb.WriteString("scope: ")
		sb.WriteString(strings.Join(req.Scopes, ","))
		sb.WriteString("\n")
	}

	if req.AdditionalNotes != nil && strings.TrimSpace(*req.AdditionalNotes) != "" {
		sb.WriteString("notes: ")
		sb.WriteString(strings.TrimSpace(*req.AdditionalNotes))
		sb.WriteString("\n")
	}

	return sb.String()
}

type promptProviderSelection struct {
	Name  string
	Model string
}

// resolveProviderForPromptGeneration 从 LLM provider 配置中解析出提示词生成使用的 Claude Code provider。
func resolveProviderForPromptGeneration(st *store.Store, requestedID *string) (promptProviderSelection, error) {
	providers, err := st.ListLLMProviders()
	if err != nil {
		return promptProviderSelection{}, err
	}
	if len(providers) == 0 {
		return promptProviderSelection{
			Name:  "Claude Code CLI",
			Model: defaultPromptGenerationModel,
		}, nil
	}

	if requestedID != nil && strings.TrimSpace(*requestedID) != "" {
		selected := selectProvider(providers, requestedID)
		if selected == nil {
			return promptProviderSelection{}, fmt.Errorf("未找到所选的提示词提供商，请重新选择 Claude Code (ACP)")
		}
		if selected.ProviderType != "claude_code_acp" {
			return promptProviderSelection{}, fmt.Errorf("生成提示词当前仅支持 Claude Code (ACP) 提供商，请在设置中改为 Claude Code (ACP)")
		}
		return buildPromptProviderSelection(*selected), nil
	}

	if selected := selectDefaultClaudeCodeProvider(providers); selected != nil {
		return buildPromptProviderSelection(*selected), nil
	}
	if selected := selectFirstClaudeCodeProvider(providers); selected != nil {
		return buildPromptProviderSelection(*selected), nil
	}

	return promptProviderSelection{}, fmt.Errorf("未找到可用的 Claude Code (ACP) 提供商，请先在设置中配置一个")
}

func buildPromptProviderSelection(provider store.LLMProvider) promptProviderSelection {
	name := strings.TrimSpace(provider.Name)
	if name == "" {
		name = "Claude Code CLI"
	}
	return promptProviderSelection{
		Name:  name,
		Model: strings.TrimSpace(provider.Model),
	}
}

func selectDefaultClaudeCodeProvider(providers []store.LLMProvider) *store.LLMProvider {
	for i := range providers {
		if providers[i].IsDefault && providers[i].ProviderType == "claude_code_acp" {
			return &providers[i]
		}
	}
	return nil
}

func selectFirstClaudeCodeProvider(providers []store.LLMProvider) *store.LLMProvider {
	for i := range providers {
		if providers[i].ProviderType == "claude_code_acp" {
			return &providers[i]
		}
	}
	return nil
}

func normalizePromptGenerationError(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "提示词生成超时，请稍后重试"
	case errors.Is(err, context.Canceled):
		return "提示词生成已取消"
	default:
		msg := err.Error()
		if strings.Contains(msg, "No available accounts") || strings.Contains(msg, "no available accounts") {
			return "Claude Code ACP 账号池暂时耗尽（503），请稍后重试或检查 ACP 配置"
		}
		return msg
	}
}

func selectProvider(providers []store.LLMProvider, requestedID *string) *store.LLMProvider {
	if requestedID != nil && strings.TrimSpace(*requestedID) != "" {
		for i := range providers {
			if providers[i].ID == *requestedID {
				return &providers[i]
			}
		}
		return nil
	}
	for i := range providers {
		if providers[i].IsDefault {
			return &providers[i]
		}
	}
	if len(providers) > 0 {
		return &providers[0]
	}
	return nil
}

// cliAdditionalDirs 返回 CLI Agent 需要访问的额外目录（执行手册目录）。
func cliAdditionalDirs() []string {
	dir := internalprompt.DefaultManualDir()
	if dir == "" {
		return nil
	}
	return []string{dir}
}

func (s *PromptService) resolveProviderForTest(provider store.LLMProvider) (store.LLMProvider, error) {
	provider.ID = strings.TrimSpace(provider.ID)
	provider.Name = strings.TrimSpace(provider.Name)
	provider.ProviderType = strings.TrimSpace(provider.ProviderType)
	provider.Model = strings.TrimSpace(provider.Model)

	if provider.ID != "" && !llm.IsACPProvider(provider.ProviderType) && strings.TrimSpace(provider.APIKey) == "" {
		storedProvider, err := s.store.GetLLMProvider(provider.ID)
		if err != nil {
			return store.LLMProvider{}, err
		}
		if storedProvider != nil && strings.TrimSpace(storedProvider.APIKey) != "" {
			provider.APIKey = storedProvider.APIKey
		}
	}

	if provider.ProviderType == "" {
		return store.LLMProvider{}, fmt.Errorf("提供商类型不能为空")
	}
	if provider.Model == "" {
		return store.LLMProvider{}, fmt.Errorf("模型名称不能为空")
	}

	baseURL := provider.BaseURL
	if baseURL != nil {
		trimmed := strings.TrimSpace(*baseURL)
		if trimmed == "" {
			baseURL = nil
		} else {
			baseURL = &trimmed
		}
	}
	provider.BaseURL = baseURL

	return provider, nil
}
