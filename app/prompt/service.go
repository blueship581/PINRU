package prompt

import (
	"fmt"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/analysis"
	"github.com/blueship581/pinru/internal/llm"
	internalprompt "github.com/blueship581/pinru/internal/prompt"
	"github.com/blueship581/pinru/internal/store"
)

// Service handles prompt generation and storage for tasks.
type PromptService struct {
	store *store.Store
}

// NewService creates a new prompt service.
func New(store *store.Store) *PromptService {
	return &PromptService{store: store}
}

// GeneratePromptRequest carries parameters for prompt generation.
type GeneratePromptRequest struct {
	TaskID          string   `json:"taskId"`
	ProviderID      *string  `json:"providerId"`
	TaskType        string   `json:"taskType"`
	Scopes          []string `json:"scopes"`
	Constraints     []string `json:"constraints"`
	AdditionalNotes *string  `json:"additionalNotes"`
}

// PromptGenerationResult is returned after a successful generation.
type PromptGenerationResult struct {
	PromptText   string           `json:"promptText"`
	Analysis     analysis.Summary `json:"analysis"`
	ProviderName string           `json:"providerName"`
	Model        string           `json:"model"`
	Status       string           `json:"status"`
}

func (s *PromptService) TestLLMProvider(cfg llm.Config) (bool, error) {
	if strings.TrimSpace(cfg.APIKey) == "" && strings.TrimSpace(cfg.ID) != "" {
		existing, err := s.store.GetLLMProvider(cfg.ID)
		if err != nil {
			return false, err
		}
		if existing == nil {
			return false, fmt.Errorf("未找到指定的大语言模型配置")
		}
		cfg.APIKey = existing.APIKey
		if strings.TrimSpace(cfg.Name) == "" {
			cfg.Name = existing.Name
		}
		if strings.TrimSpace(cfg.ProviderType) == "" {
			cfg.ProviderType = existing.ProviderType
		}
		if strings.TrimSpace(cfg.Model) == "" {
			cfg.Model = existing.Model
		}
		if cfg.BaseURL == nil || strings.TrimSpace(*cfg.BaseURL) == "" {
			cfg.BaseURL = existing.BaseURL
		}
	}

	provider, err := llm.BuildProvider(cfg)
	if err != nil {
		return false, err
	}
	if err := provider.TestConnection(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *PromptService) GenerateTaskPrompt(req GeneratePromptRequest) (*PromptGenerationResult, error) {
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

	providers, err := s.store.ListLLMProviders()
	if err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, fmt.Errorf("请先在设置中配置至少一个大语言模型提供商")
	}

	selected := selectProvider(providers, req.ProviderID)
	if selected == nil {
		return nil, fmt.Errorf("未找到指定的大语言模型配置")
	}

	cfg := llm.Config{
		ID:           selected.ID,
		Name:         selected.Name,
		ProviderType: selected.ProviderType,
		Model:        selected.Model,
		BaseURL:      selected.BaseURL,
		APIKey:       selected.APIKey,
		IsDefault:    selected.IsDefault,
	}
	provider, err := llm.BuildProvider(cfg)
	if err != nil {
		return nil, err
	}

	startedAt := time.Now().Unix()
	if err := s.store.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		return nil, err
	}

	summary, err := analysis.AnalyzeRepository(*task.LocalPath)
	if err != nil {
		if failErr := s.store.FailTaskPromptGeneration(task.ID, err.Error(), startedAt); failErr != nil {
			return nil, fmt.Errorf("%w；提示词状态回写失败: %v", err, failErr)
		}
		return nil, err
	}

	taskInfo := internalprompt.TaskInfo{
		ID:              task.ID,
		GitLabProjectID: task.GitLabProjectID,
		ProjectName:     task.ProjectName,
		Status:          task.Status,
	}
	promptReq := internalprompt.PromptRequest{
		TaskType:        req.TaskType,
		Scopes:          req.Scopes,
		Constraints:     req.Constraints,
		AdditionalNotes: req.AdditionalNotes,
	}

	systemPrompt := internalprompt.BuildSystemPrompt()
	userPrompt := internalprompt.BuildUserPrompt(taskInfo, promptReq, *summary, provider.Name())

	promptText, err := provider.Generate(systemPrompt, userPrompt)
	if err != nil {
		if failErr := s.store.FailTaskPromptGeneration(task.ID, err.Error(), startedAt); failErr != nil {
			return nil, fmt.Errorf("%w；提示词状态回写失败: %v", err, failErr)
		}
		return nil, err
	}
	if strings.TrimSpace(promptText) == "" {
		emptyErr := fmt.Errorf("模型没有返回可用的提示词内容")
		if failErr := s.store.FailTaskPromptGeneration(task.ID, emptyErr.Error(), startedAt); failErr != nil {
			return nil, fmt.Errorf("%w；提示词状态回写失败: %v", emptyErr, failErr)
		}
		return nil, emptyErr
	}
	promptText, err = refinePromptTextIfNeeded(provider, promptText)
	if err != nil {
		if failErr := s.store.FailTaskPromptGeneration(task.ID, err.Error(), startedAt); failErr != nil {
			return nil, fmt.Errorf("%w；提示词状态回写失败: %v", err, failErr)
		}
		return nil, err
	}

	if err := s.store.CompleteTaskPromptGeneration(task.ID, promptText, startedAt); err != nil {
		return nil, err
	}
	BestEffortSyncTaskPromptArtifact(task, promptText)

	return &PromptGenerationResult{
		PromptText:   promptText,
		Analysis:     *summary,
		ProviderName: provider.Name(),
		Model:        provider.Model(),
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

func refinePromptTextIfNeeded(provider llm.Provider, promptText string) (string, error) {
	current := strings.TrimSpace(promptText)
	if current == "" {
		return "", fmt.Errorf("提示词内容不能为空")
	}

	body, constraints := internalprompt.SplitPromptSections(current)
	if !internalprompt.PromptBodyExceedsLimit(current) {
		return current, nil
	}
	if strings.TrimSpace(body) == "" {
		return "", fmt.Errorf("提示词正文为空，无法精炼")
	}

	for attempt := 0; attempt < 2; attempt++ {
		refinedBody, err := provider.Generate(
			internalprompt.BuildShortenSystemPrompt(internalprompt.MaxPromptBodyRunes),
			internalprompt.BuildShortenUserPrompt(body, internalprompt.MaxPromptBodyRunes),
		)
		if err != nil {
			return "", fmt.Errorf("提示词正文超过%d字，精炼失败: %w", internalprompt.MaxPromptBodyRunes, err)
		}

		refinedBody = strings.TrimSpace(refinedBody)
		if refinedBody == "" {
			return "", fmt.Errorf("提示词正文超过%d字，但精炼结果为空", internalprompt.MaxPromptBodyRunes)
		}

		current = refinedBody
		if len(constraints) > 0 {
			current += "\n" + strings.Join(constraints, "\n")
		}
		if !internalprompt.PromptBodyExceedsLimit(current) {
			return current, nil
		}
		body = refinedBody
	}

	return "", fmt.Errorf("提示词正文精炼后仍超过%d字", internalprompt.MaxPromptBodyRunes)
}
