package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const anthropicVersion = "2023-06-01"

type Provider interface {
	Name() string
	Model() string
	TestConnection() error
	Generate(systemPrompt, userPrompt string) (string, error)
}

type Config struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	ProviderType string  `json:"providerType"`
	Model        string  `json:"model"`
	BaseURL      *string `json:"baseUrl"`
	APIKey       string  `json:"apiKey"`
	IsDefault    bool    `json:"isDefault"`
}

func BuildProvider(cfg Config) (Provider, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("API Key 不能为空")
	}
	switch cfg.ProviderType {
	case "openai_compatible":
		return &openaiProvider{cfg: cfg, client: &http.Client{Timeout: 60 * time.Second}}, nil
	case "anthropic":
		return &anthropicProvider{cfg: cfg, client: &http.Client{Timeout: 60 * time.Second}}, nil
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
	body, _ := json.Marshal(map[string]interface{}{
		"model":       p.cfg.Model,
		"temperature": 0.2,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
	})
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
	body, _ := json.Marshal(map[string]interface{}{
		"model":       p.cfg.Model,
		"max_tokens":  4096,
		"temperature": 0.2,
		"system":      systemPrompt,
		"messages":    []map[string]string{{"role": "user", "content": userPrompt}},
	})
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
