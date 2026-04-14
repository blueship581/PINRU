# LLM Provider 抽象层

## 概述

`internal/llm/llm.go` 定义了统一的 Provider 接口，屏蔽不同 LLM 服务商的调用差异。所有上层模块（prompt 生成、ai_review 等）均面向 `Provider` 接口编程。

---

## Provider 接口定义

```go
type Provider interface {
    Name() string
    Model() string
    TestConnection() error
    Generate(systemPrompt, userPrompt string) (string, error)
}
```

| 方法 | 说明 |
|------|------|
| `Name()` | 返回配置中的提供商名称（用于日志/展示） |
| `Model()` | 返回当前使用的模型 ID |
| `TestConnection()` | 发送探测请求，验证连接和凭证是否有效 |
| `Generate(system, user)` | 输入系统提示词和用户提示词，返回模型生成的文本 |

---

## Config 结构体字段

```go
type Config struct {
    ID             string  `json:"id"`
    Name           string  `json:"name"`
    ProviderType   string  `json:"providerType"`   // 见下方提供商类型
    Model          string  `json:"model"`
    BaseURL        *string `json:"baseUrl"`         // 可选，留空使用默认端点
    APIKey         string  `json:"apiKey"`
    IsDefault      bool    `json:"isDefault"`
    ThinkingBudget string  `json:"thinkingBudget"` // "" | "low" | "medium" | "high"
}
```

`ThinkingBudget` 对应的 token 数：
- `"low"` → 1024
- `"medium"` → 4096
- `"high"` → 10240
- `""` → 0（不启用扩展推理）

---

## 4 种提供商类型

### 1. openai_compatible

适用于所有兼容 OpenAI Chat Completions API 的服务（OpenAI、DeepSeek、本地 Ollama 等）。

- 端点：`{BaseURL}/chat/completions`（默认 `https://api.openai.com/v1`）
- 认证：`Authorization: Bearer <APIKey>`
- 超时：默认 60s；启用 `ThinkingBudget` 时延长至 180s
- ThinkingBudget：映射为请求体中的 `reasoning_effort` 字段
- temperature：固定 0.2

### 2. anthropic

调用 Anthropic Messages API。

- 端点：`{BaseURL}/messages`（默认 `https://api.anthropic.com/v1`）
- 认证：`x-api-key: <APIKey>`，同时携带 `anthropic-version: 2023-06-01`
- 超时：默认 60s；启用 ThinkingBudget 时延长至 180s
- ThinkingBudget：映射为请求体中的 `thinking.budget_tokens` 字段，同时将 `max_tokens` 提升至 16384，`temperature` 固定为 1
- 无 ThinkingBudget 时：`max_tokens` = 4096，`temperature` = 0.2
- 响应解析：遍历 `content[]` 数组，拼接所有 `type="text"` 块

### 3. claude_code_acp

通过本机安装的 `claude` CLI（`@anthropic-ai/claude-code`）进行调用，由 ACP（Agent-side Compute Provider）代理实际的账号池和模型分配。

- 不需要 APIKey（`IsACPProvider` 返回 true，跳过 APIKey 校验）
- `TestConnection`：执行 `claude -p "respond with the single word: ok" --dangerously-skip-permissions`，超时 60s；检测 "No available accounts" 等错误信息
- `Generate`：执行 `claude --print --model <model> "<systemPrompt>\n\n<userPrompt>"`
- CLI 路径通过 `util.ResolveCLI("claude")` 解析，支持受限 PATH 环境（打包应用）

### 4. codex_acp

通过本机安装的 `codex` CLI 调用，同样走 ACP 代理。

- 不需要 APIKey
- `TestConnection`：执行 `codex --version` 确认 CLI 可用
- `Generate`：执行 `codex --quiet --model <model> "<systemPrompt>\n\n<userPrompt>"`
- CLI 路径通过 `util.ResolveCLI("codex")` 解析

---

## BuildProvider 工厂函数逻辑

```go
func BuildProvider(cfg Config) (Provider, error)
```

1. 若非 ACP 类型（`!IsACPProvider`），检查 `APIKey` 非空，否则返回错误。
2. 按 `cfg.ProviderType` switch：
   - `"openai_compatible"` → 创建 `openaiProvider`，按 ThinkingBudget 设置超时
   - `"anthropic"` → 创建 `anthropicProvider`，按 ThinkingBudget 设置超时
   - `"claude_code_acp"` → 创建 `claudeCodeACPProvider`（无 HTTP client）
   - `"codex_acp"` → 创建 `codexACPProvider`（无 HTTP client）
   - 其他 → 返回 `fmt.Errorf("unknown provider type: %s", ...)`

辅助函数：

```go
func IsACPProvider(providerType string) bool {
    return providerType == "claude_code_acp" || providerType == "codex_acp"
}
```

---

## 如何添加新 Provider

1. 在 `internal/llm/llm.go` 中新建结构体，实现 `Provider` 接口的 4 个方法。
2. 若该提供商不需要 APIKey，在 `IsACPProvider` 中增加类型名判断。
3. 在 `BuildProvider` 的 switch 中增加对应 case，实例化新结构体。
4. 在 `store.LLMProvider.ProviderType` 和前端配置表单中注册新的类型值。
5. 若有特殊超时需求，在实例化时传入自定义 `http.Client`。

HTTP 类 provider 可直接复用 `checkLLMResponse`（状态码校验）、`extractOpenAIText` / `extractAnthropicText`（响应解析）等工具函数。
