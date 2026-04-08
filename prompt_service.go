package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/analysis"
	"github.com/blueship581/pinru/internal/llm"
	"github.com/blueship581/pinru/internal/prompt"
	"github.com/blueship581/pinru/internal/store"
)

type PromptService struct {
	store *store.Store
}

type GeneratePromptRequest struct {
	TaskID          string   `json:"taskId"`
	ProviderID      *string  `json:"providerId"`
	TaskType        string   `json:"taskType"`
	Scopes          []string `json:"scopes"`
	Constraints     []string `json:"constraints"`
	AdditionalNotes *string  `json:"additionalNotes"`
}

type PromptGenerationResult struct {
	PromptText   string           `json:"promptText"`
	Analysis     analysis.Summary `json:"analysis"`
	ProviderName string           `json:"providerName"`
	Model        string           `json:"model"`
	Status       string           `json:"status"`
}

func (s *PromptService) TestLLMProvider(cfg llm.Config) (bool, error) {
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
		_ = s.store.FailTaskPromptGeneration(task.ID, err.Error(), startedAt)
		return nil, err
	}

	taskInfo := prompt.TaskInfo{
		ID:              task.ID,
		GitLabProjectID: task.GitLabProjectID,
		ProjectName:     task.ProjectName,
		Status:          task.Status,
	}
	promptReq := prompt.PromptRequest{
		TaskType:        req.TaskType,
		Scopes:          req.Scopes,
		Constraints:     req.Constraints,
		AdditionalNotes: req.AdditionalNotes,
	}

	systemPrompt := prompt.BuildSystemPrompt()
	userPrompt := prompt.BuildUserPrompt(taskInfo, promptReq, *summary, provider.Name())

	promptText, err := provider.Generate(systemPrompt, userPrompt)
	if err != nil {
		_ = s.store.FailTaskPromptGeneration(task.ID, err.Error(), startedAt)
		return nil, err
	}
	if strings.TrimSpace(promptText) == "" {
		_ = s.store.FailTaskPromptGeneration(task.ID, "模型没有返回可用的提示词内容", startedAt)
		return nil, fmt.Errorf("模型没有返回可用的提示词内容")
	}

	if err := s.store.CompleteTaskPromptGeneration(task.ID, promptText, startedAt); err != nil {
		return nil, err
	}

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
	return s.store.UpdateTaskPrompt(taskID, promptText)
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
