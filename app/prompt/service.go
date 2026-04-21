package prompt

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	appcli "github.com/blueship581/pinru/app/cli"
	"github.com/blueship581/pinru/internal/errs"
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
		return nil, errors.New(errs.MsgTaskRequired)
	}
	if strings.TrimSpace(req.TaskType) == "" {
		return nil, errors.New(errs.MsgTaskTypeRequired)
	}

	task, err := s.store.GetTask(req.TaskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf(errs.FmtTaskNotFound, req.TaskID)
	}
	if task.LocalPath == nil {
		return nil, errors.New(errs.MsgTaskMissingWorkDir)
	}

	if _, err := s.cliSvc.CheckCLI(); err != nil {
		return nil, errors.New(errs.MsgClaudeCodeCliNotInstalledInstallGuide)
	}

	selection, err := resolveProviderForPromptGeneration(s.store, req.ProviderID)
	if err != nil {
		return nil, err
	}

	// 查询同题源下已有提示词的兄弟任务（B-35-1 的提示词要在 B-35-2 生成时传入，
	// 用于去重约束）。GitLab 和压缩包来源都通过 GitLabProjectID 聚合，无需区分。
	var siblingPrompts []siblingPrompt
	if task.ProjectConfigID != nil && strings.TrimSpace(*task.ProjectConfigID) != "" {
		siblings, err := s.store.ListSiblingTasksWithPrompt(*task.ProjectConfigID, task.GitLabProjectID, task.ID)
		if err != nil {
			slog.Warn("list sibling prompts failed", "task_id", task.ID, "error", err)
		} else {
			siblingPrompts = collectSiblingPrompts(siblings)
		}
	}

	startedAt := time.Now().Unix()
	if err := s.store.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		return nil, err
	}

	// Build the [PINRU] skill prompt
	skillPrompt := buildSkillPrompt(req, siblingPrompts)

	// Execute CLI Agent with one automatic retry on failure
	workDir := util.NormalizePath(*task.LocalPath)
	slog.Info("CLI prompt generation started",
		"project", task.ProjectName,
		"task_type", req.TaskType,
		"model", selection.Model,
		"provider", selection.Name,
	)
	cliStart := time.Now()
	promptText, err := s.executeCliWithRetry(ctx, workDir, skillPrompt, selection.Model, 1)
	if err != nil {
		slog.Error("CLI prompt generation failed",
			"project", task.ProjectName,
			"model", selection.Model,
			"elapsed", time.Since(cliStart).Round(time.Millisecond),
			"error", err,
		)
		errMsg := normalizePromptGenerationError(err)
		if failErr := s.store.FailTaskPromptGeneration(task.ID, errMsg, startedAt); failErr != nil {
			return nil, fmt.Errorf(errs.FmtPromptStatusBack, errMsg, failErr)
		}
		return nil, errors.New(errMsg)
	}
	slog.Info("CLI prompt generation completed",
		"project", task.ProjectName,
		"model", selection.Model,
		"elapsed", time.Since(cliStart).Round(time.Millisecond),
	)

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
		return errors.New(errs.MsgTaskRequired)
	}
	if strings.TrimSpace(promptText) == "" {
		return errors.New(errs.MsgPromptContentRequired)
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
		if attempt > 0 {
			slog.Warn("retrying CLI prompt generation",
				"attempt", attempt,
				"max_retries", maxRetries,
				"last_error", lastErr,
			)
		}
		promptText, err := s.executeCliPromptGeneration(ctx, workDir, prompt, model)
		if err == nil {
			return promptText, nil
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return "", err
		}
		lastErr = err
	}
	return "", fmt.Errorf(errs.FmtPromptRetryFailed, maxRetries, lastErr)
}

// executeCliPromptGeneration 启动一次 CLI Agent 执行并从输出中提取提示词。
func (s *PromptService) executeCliPromptGeneration(ctx context.Context, workDir, prompt, model string) (string, error) {
	output, err := s.executeCliRaw(ctx, workDir, prompt, model)
	if err != nil {
		return "", err
	}

	promptText, err := ExtractPromptFromCLIOutput(output)
	if err != nil {
		return "", fmt.Errorf(errs.FmtPromptExtractFail, err)
	}

	return promptText, nil
}

func (s *PromptService) executeCliHumanizer(ctx context.Context, workDir, prompt, model string) (string, error) {
	output, err := s.executeCliRaw(ctx, workDir, prompt, model)
	if err != nil {
		return "", err
	}

	humanizedText, err := ExtractHumanizedTextFromCLIOutput(output)
	if err != nil {
		return "", fmt.Errorf(errs.FmtPolishExtractFail, err)
	}

	return humanizedText, nil
}

func (s *PromptService) executeCliRaw(ctx context.Context, workDir, prompt, model string) (string, error) {
	additionalDirs := cliAdditionalDirs()

	resp, err := s.cliSvc.StartClaude(appcli.StartClaudeRequest{
		WorkDir:        workDir,
		Prompt:         prompt,
		Model:          model,
		PermissionMode: "bypassPermissions",
		AdditionalDirs: additionalDirs,
	})
	if err != nil {
		return "", fmt.Errorf(errs.FmtClaudeStartFail, err)
	}

	output, err := s.waitForCliCompletion(ctx, resp.SessionID)
	if err != nil {
		return "", err
	}
	return output, nil
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
			return "", fmt.Errorf(errs.FmtCliPollFail, err)
		}

		lines = append(lines, poll.Lines...)
		offset += len(poll.Lines)

		if poll.Done {
			if poll.ErrMsg != "" {
				return "", fmt.Errorf(errs.FmtClaudeRunErr, poll.ErrMsg)
			}
			combined := strings.Join(lines, "\n")
			if strings.Contains(combined, "No available accounts") || strings.Contains(combined, "no available accounts") {
				return "", errors.New(errs.MsgClaudeCodeAcpBusy)
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
func buildSkillPrompt(req GeneratePromptRequest, siblingPrompts []siblingPrompt) string {
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

	if len(siblingPrompts) > 0 {
		sb.WriteString("\n---\n")
		sb.WriteString("同题源已有提示词（来自同一代码仓库的其他试题）：\n")
		sb.WriteString(`要求：新生成的提示词必须在"考察点、切入角度、改动范围、描述措辞"上都与下列已有提示词明显不同，不得出现题目雷同或换皮重复；如果下列提示词已覆盖了该仓库最典型的考察方向，请改从次要的切入点切入。`)
		sb.WriteString("\n\n")
		for i, sp := range siblingPrompts {
			fmt.Fprintf(&sb, "【已有提示词 %d】taskId=%s taskType=%s\n", i+1, sp.TaskID, sp.TaskType)
			sb.WriteString(sp.PromptText)
			sb.WriteString("\n\n")
		}
	}

	return sb.String()
}

type siblingPrompt struct {
	TaskID     string
	TaskType   string
	PromptText string
}

func collectSiblingPrompts(tasks []store.Task) []siblingPrompt {
	result := make([]siblingPrompt, 0, len(tasks))
	for _, t := range tasks {
		if t.PromptText == nil {
			continue
		}
		text := strings.TrimSpace(*t.PromptText)
		if text == "" {
			continue
		}
		result = append(result, siblingPrompt{
			TaskID:     t.ID,
			TaskType:   t.TaskType,
			PromptText: text,
		})
	}
	return result
}

type promptProviderSelection struct {
	Name  string
	Model string
}

func buildPolishSkillPrompt(text string) string {
	trimmed := strings.TrimSpace(text)
	return strings.Join([]string{
		"/humanizer-zh",
		"",
		"请把下面内容改成更自然、更口语化的业务描述。",
		"不要出现代码片段、伪代码、命令、路径、变量名或技术实现细节。",
		"重点保留业务现象、用户感知、场景变化和需要补齐的业务处理。",
		"只返回润色后的正文。",
		"",
		trimmed,
	}, "\n")
}

func defaultPolishWorkDir() string {
	workDir, err := os.Getwd()
	if err != nil || strings.TrimSpace(workDir) == "" {
		return "."
	}
	return workDir
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
			return promptProviderSelection{}, errors.New(errs.MsgClaudeCodeAcpMissing)
		}
		if selected.ProviderType != "claude_code_acp" {
			return promptProviderSelection{}, errors.New(errs.MsgClaudeCodeAcpOnly)
		}
		return buildPromptProviderSelection(*selected), nil
	}

	if selected := selectDefaultClaudeCodeProvider(providers); selected != nil {
		return buildPromptProviderSelection(*selected), nil
	}
	if selected := selectFirstClaudeCodeProvider(providers); selected != nil {
		return buildPromptProviderSelection(*selected), nil
	}

	return promptProviderSelection{}, errors.New(errs.MsgClaudeCodeAcpNotConfigured)
}

func buildPromptProviderSelection(provider store.LLMProvider) promptProviderSelection {
	name := strings.TrimSpace(provider.Name)
	if name == "" {
		name = "Claude Code CLI"
	}
	model := strings.TrimSpace(provider.Model)
	if model == "" {
		model = defaultPromptGenerationModel
	}
	return promptProviderSelection{
		Name:  name,
		Model: model,
	}
}

func resolveProviderForPolish(st *store.Store, requestedID *string) (promptProviderSelection, error) {
	return resolveProviderForPromptGeneration(st, requestedID)
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
		return store.LLMProvider{}, errors.New(errs.MsgProviderTypeRequired)
	}
	if provider.Model == "" {
		return store.LLMProvider{}, errors.New(errs.MsgModelNameRequired)
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

// ── 润色文本 ────────────────────────────────────────────────────────────────

// PolishTextRequest 润色请求。
type PolishTextRequest struct {
	Text       string  `json:"text"`
	ProviderID *string `json:"providerId"`
}

// PolishTextResult 润色结果。
type PolishTextResult struct {
	PolishedText string `json:"polishedText"`
	ProviderName string `json:"providerName"`
	Model        string `json:"model"`
}

// PolishText 使用 Claude Code CLI 执行 /humanizer-zh 并返回输出正文。
func (s *PromptService) PolishText(req PolishTextRequest) (*PolishTextResult, error) {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, errors.New(errs.MsgPolishTextRequired)
	}

	if _, err := s.cliSvc.CheckCLI(); err != nil {
		return nil, errors.New(errs.MsgClaudeCodeCliNotInstalledInstallGuide)
	}

	selection, err := resolveProviderForPolish(s.store, req.ProviderID)
	if err != nil {
		return nil, err
	}

	workDir := defaultPolishWorkDir()
	skillPrompt := buildPolishSkillPrompt(text)
	slog.Info("PolishText started", "model", selection.Model, "provider", selection.Name, "textLen", len(text))
	polished, err := s.executeCliHumanizer(context.Background(), workDir, skillPrompt, selection.Model)
	if err != nil {
		return nil, fmt.Errorf(errs.FmtPolishFailed, err)
	}

	polished = strings.TrimSpace(polished)
	if polished == "" {
		return nil, errors.New(errs.MsgHumanizerEmpty)
	}

	slog.Info("PolishText completed", "model", selection.Model, "resultLen", len(polished))
	return &PolishTextResult{
		PolishedText: polished,
		ProviderName: selection.Name,
		Model:        selection.Model,
	}, nil
}
