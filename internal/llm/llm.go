package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/util"
)

const anthropicVersion = "2023-06-01"

type Provider interface {
	Name() string
	Model() string
	TestConnection() error
	Generate(systemPrompt, userPrompt string) (string, error)
}

type Config struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	ProviderType   string  `json:"providerType"`
	Model          string  `json:"model"`
	BaseURL        *string `json:"baseUrl"`
	APIKey         string  `json:"apiKey"`
	IsDefault      bool    `json:"isDefault"`
	ThinkingBudget string  `json:"thinkingBudget"` // "" | "low" | "medium" | "high"
}

func IsACPProvider(providerType string) bool {
	return providerType == "claude_code_acp" || providerType == "codex_acp"
}

func thinkingBudgetTokens(budget string) int {
	switch budget {
	case "low":
		return 1024
	case "medium":
		return 4096
	case "high":
		return 10240
	default:
		return 0
	}
}

func BuildProvider(cfg Config) (Provider, error) {
	if !IsACPProvider(cfg.ProviderType) && strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("API Key 不能为空")
	}
	switch cfg.ProviderType {
	case "openai_compatible":
		timeout := 60 * time.Second
		if cfg.ThinkingBudget != "" {
			timeout = 180 * time.Second
		}
		return &openaiProvider{cfg: cfg, client: &http.Client{Timeout: timeout}}, nil
	case "anthropic":
		timeout := 60 * time.Second
		if cfg.ThinkingBudget != "" {
			timeout = 180 * time.Second
		}
		return &anthropicProvider{cfg: cfg, client: &http.Client{Timeout: timeout}}, nil
	case "claude_code_acp":
		return &claudeCodeACPProvider{cfg: cfg}, nil
	case "codex_acp":
		return &codexACPProvider{cfg: cfg}, nil
	default:
		return nil, fmt.Errorf("unknown provider type: %s", cfg.ProviderType)
	}
}

// --- OpenAI Compatible Provider ---

type openaiProvider struct {
	cfg    Config
	client *http.Client
}

func (p *openaiProvider) Name() string  { return p.cfg.Name }
func (p *openaiProvider) Model() string { return p.cfg.Model }
func (p *openaiProvider) baseURL() string {
	if p.cfg.BaseURL != nil && strings.TrimSpace(*p.cfg.BaseURL) != "" {
		return strings.TrimRight(*p.cfg.BaseURL, "/")
	}
	return "https://api.openai.com/v1"
}

func (p *openaiProvider) TestConnection() error {
	body, _ := json.Marshal(map[string]interface{}{
		"model":       p.cfg.Model,
		"max_tokens":  1,
		"temperature": 0,
		"messages":    []map[string]string{{"role": "user", "content": "ping"}},
	})
	resp, err := p.doRequest(body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkLLMResponse(resp)
}

func (p *openaiProvider) Generate(systemPrompt, userPrompt string) (string, error) {
	payload := map[string]interface{}{
		"model":       p.cfg.Model,
		"temperature": 0.2,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
	}
	if p.cfg.ThinkingBudget != "" {
		payload["reasoning_effort"] = p.cfg.ThinkingBudget
	}
	body, _ := json.Marshal(payload)
	resp, err := p.doRequest(body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if err := checkLLMResponse(resp); err != nil {
		return "", err
	}
	return extractOpenAIText(resp)
}

func (p *openaiProvider) doRequest(body []byte) (*http.Response, error) {
	req, _ := http.NewRequest("POST", p.baseURL()+"/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(p.cfg.APIKey))
	req.Header.Set("Content-Type", "application/json")
	return p.client.Do(req)
}

// --- Anthropic Provider ---

type anthropicProvider struct {
	cfg    Config
	client *http.Client
}

func (p *anthropicProvider) Name() string  { return p.cfg.Name }
func (p *anthropicProvider) Model() string { return p.cfg.Model }
func (p *anthropicProvider) baseURL() string {
	if p.cfg.BaseURL != nil && strings.TrimSpace(*p.cfg.BaseURL) != "" {
		return strings.TrimRight(*p.cfg.BaseURL, "/")
	}
	return "https://api.anthropic.com/v1"
}

func (p *anthropicProvider) TestConnection() error {
	body, _ := json.Marshal(map[string]interface{}{
		"model":      p.cfg.Model,
		"max_tokens": 1,
		"messages":   []map[string]string{{"role": "user", "content": "ping"}},
	})
	resp, err := p.doRequest(body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkLLMResponse(resp)
}

func (p *anthropicProvider) Generate(systemPrompt, userPrompt string) (string, error) {
	budgetTokens := thinkingBudgetTokens(p.cfg.ThinkingBudget)
	payload := map[string]interface{}{
		"model":  p.cfg.Model,
		"system": systemPrompt,
		"messages": []map[string]interface{}{
			{"role": "user", "content": userPrompt},
		},
	}
	if budgetTokens > 0 {
		payload["max_tokens"] = 16384
		payload["temperature"] = 1
		payload["thinking"] = map[string]interface{}{
			"type":          "enabled",
			"budget_tokens": budgetTokens,
		}
	} else {
		payload["max_tokens"] = 4096
		payload["temperature"] = 0.2
	}
	body, _ := json.Marshal(payload)
	resp, err := p.doRequest(body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if err := checkLLMResponse(resp); err != nil {
		return "", err
	}
	return extractAnthropicText(resp)
}

func (p *anthropicProvider) doRequest(body []byte) (*http.Response, error) {
	req, _ := http.NewRequest("POST", p.baseURL()+"/messages", bytes.NewReader(body))
	req.Header.Set("x-api-key", strings.TrimSpace(p.cfg.APIKey))
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("Content-Type", "application/json")
	return p.client.Do(req)
}

// --- Helpers ---

func checkLLMResponse(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(resp.Body)
	msg := string(body)
	if len(msg) > 320 {
		msg = msg[:320] + "..."
	}
	return fmt.Errorf("模型请求失败（%d）: %s", resp.StatusCode, strings.TrimSpace(msg))
}

func extractOpenAIText(resp *http.Response) (string, error) {
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析模型响应失败: %w", err)
	}
	choices, _ := result["choices"].([]interface{})
	if len(choices) == 0 {
		return "", fmt.Errorf("OpenAI 兼容模型未返回可用的文本内容")
	}
	choice, _ := choices[0].(map[string]interface{})
	msg, _ := choice["message"].(map[string]interface{})
	content, _ := msg["content"].(string)
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("OpenAI 兼容模型未返回可用的文本内容")
	}
	return strings.TrimSpace(content), nil
}

func extractAnthropicText(resp *http.Response) (string, error) {
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("解析模型响应失败: %w", err)
	}
	contentArr, _ := result["content"].([]interface{})
	var texts []string
	for _, item := range contentArr {
		block, _ := item.(map[string]interface{})
		if text, ok := block["text"].(string); ok && strings.TrimSpace(text) != "" {
			texts = append(texts, strings.TrimSpace(text))
		}
	}
	if len(texts) == 0 {
		return "", fmt.Errorf("Anthropic 模型未返回可用的文本内容")
	}
	return strings.Join(texts, "\n\n"), nil
}

// --- Claude Code ACP Provider ---

type claudeCodeACPProvider struct {
	cfg Config
}

func (p *claudeCodeACPProvider) Name() string  { return p.cfg.Name }
func (p *claudeCodeACPProvider) Model() string { return p.cfg.Model }

func (p *claudeCodeACPProvider) TestConnection() error {
	// 先检查 CLI 是否安装（支持打包应用的受限 PATH 环境）
	claudePath, err := util.ResolveCLI("claude")
	if err != nil {
		return fmt.Errorf("Claude Code CLI 未安装，请执行: npm install -g @anthropic-ai/claude-code")
	}

	// 真实发一次 API 请求，验证 ACP 代理可达且有可用账号
	// 不传 --model，让全局配置决定模型，与提示词生成保持一致
	args := []string{"-p", "respond with the single word: ok", "--dangerously-skip-permissions"}
	cmd := exec.Command(claudePath, args...)

	type result struct {
		out []byte
		err error
	}
	ch := make(chan result, 1)
	go func() {
		out, err := cmd.CombinedOutput()
		ch <- result{out, err}
	}()

	timer := time.NewTimer(60 * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
		_ = cmd.Process.Kill()
		return fmt.Errorf("Claude Code ACP 连接超时（60s），请检查网络或 ACP 配置")
	case r := <-ch:
		output := strings.TrimSpace(string(r.out))
		if r.err != nil {
			if strings.Contains(output, "No available accounts") || strings.Contains(output, "no available accounts") {
				return fmt.Errorf("ACP 账号池暂时耗尽（503），请稍后重试")
			}
			if strings.Contains(output, "模型配置不存在") {
				return fmt.Errorf("ACP 代理不支持当前模型，请检查 ACP 配置")
			}
			if output != "" {
				return fmt.Errorf("Claude Code ACP 调用失败: %s", output)
			}
			return fmt.Errorf("Claude Code ACP 调用失败: %v", r.err)
		}
		return nil
	}
}

func (p *claudeCodeACPProvider) Generate(systemPrompt, userPrompt string) (string, error) {
	claudePath, err := util.ResolveCLI("claude")
	if err != nil {
		return "", fmt.Errorf("Claude Code CLI 未安装，请执行: npm install -g @anthropic-ai/claude-code")
	}
	prompt := systemPrompt + "\n\n" + userPrompt
	args := []string{"--print", "--model", p.cfg.Model, prompt}
	cmd := exec.Command(claudePath, args...)
	cmd.Stdin = nil
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("Claude Code CLI 调用失败: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("Claude Code CLI 调用失败: %w", err)
	}
	result := strings.TrimSpace(string(out))
	if result == "" {
		return "", fmt.Errorf("Claude Code CLI 未返回可用内容")
	}
	return result, nil
}

// --- Codex ACP Provider ---

type codexACPProvider struct {
	cfg Config
}

func (p *codexACPProvider) Name() string  { return p.cfg.Name }
func (p *codexACPProvider) Model() string { return p.cfg.Model }

func (p *codexACPProvider) TestConnection() error {
	codexPath, err := util.ResolveCLI("codex")
	if err != nil {
		return fmt.Errorf("Codex CLI 未安装或不可用: %v", err)
	}
	cmd := exec.Command(codexPath, "--version")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("Codex CLI 未安装或不可用: %v", strings.TrimSpace(string(out)))
	}
	return nil
}

func (p *codexACPProvider) Generate(systemPrompt, userPrompt string) (string, error) {
	codexPath, err := util.ResolveCLI("codex")
	if err != nil {
		return "", fmt.Errorf("Codex CLI 未安装，请先安装后重试")
	}
	prompt := systemPrompt + "\n\n" + userPrompt
	args := []string{"--quiet", "--model", p.cfg.Model, prompt}
	cmd := exec.Command(codexPath, args...)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("Codex CLI 调用失败: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("Codex CLI 调用失败: %w", err)
	}
	result := strings.TrimSpace(string(out))
	if result == "" {
		return "", fmt.Errorf("Codex CLI 未返回可用内容")
	}
	return result, nil
}
