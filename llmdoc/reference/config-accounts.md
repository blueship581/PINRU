# 配置与账户管理

## 概述

`app/config/service.go` 定义的 `ConfigService` 是前端访问所有配置数据的唯一入口，包括全局 KV 配置、项目管理、LLM Provider 管理和 GitHub 多账户管理。底层由 `internal/store` 中的 SQLite 操作层支撑。

---

## ConfigService 所有方法签名

### 全局 KV 配置

```go
func (s *ConfigService) GetConfig(key string) (string, error)
func (s *ConfigService) SetConfig(key, value string) error
```

敏感 key（`gitlab_token`）被 `isSensitiveConfigKey` 拦截，`GetConfig` 返回空字符串。

### GitLab 配置

```go
func (s *ConfigService) GetGitLabSettings() (*GitLabSettings, error)
func (s *ConfigService) SaveGitLabSettings(url, username, token string) error
func (s *ConfigService) TestGitLabConnection(url, token string) (bool, error)
```

`GetGitLabSettings` 返回 `GitLabSettings`，其中 token 脱敏为 `HasToken bool`。

### GitHubConnection 测试

```go
func (s *ConfigService) TestGitHubConnection(username, token string) (bool, error)
func (s *ConfigService) TestGitHubAccountConnection(id, username, token string) (bool, error)
```

`TestGitHubAccountConnection` 若 token 为空时自动从 store 中读取该账户的存储 token。

### 项目 CRUD

```go
func (s *ConfigService) ListProjects() ([]store.Project, error)
func (s *ConfigService) CreateProject(p store.Project) error
func (s *ConfigService) UpdateProject(p store.Project) error
func (s *ConfigService) DeleteProject(id string) error
func (s *ConfigService) ConsumeProjectQuota(projectID, taskType string) error
```

`ListProjects` 返回时自动脱敏：`GitLabToken` 置空，`HasGitLabToken` 标记是否有 token。`CloneBasePath` 通过 `util.NormalizePath` 规范化（展开 `~`）。

`UpdateProject` 若传入 token 为空，自动保留数据库中已有的 token（防止前端编辑时清空）。

### LLM Provider CRUD

```go
func (s *ConfigService) ListLLMProviders() ([]store.LLMProvider, error)
func (s *ConfigService) CreateLLMProvider(p store.LLMProvider) error
func (s *ConfigService) UpdateLLMProvider(p store.LLMProvider) error
func (s *ConfigService) DeleteLLMProvider(id string) error
```

返回列表时 `APIKey` 置空，`HasAPIKey` 标记是否已配置。`UpdateLLMProvider` 若 APIKey 为空则保留已有 key。

### GitHub 账户 CRUD

```go
func (s *ConfigService) ListGitHubAccounts() ([]store.GitHubAccount, error)
func (s *ConfigService) CreateGitHubAccount(a store.GitHubAccount) error
func (s *ConfigService) UpdateGitHubAccount(a store.GitHubAccount) error
func (s *ConfigService) DeleteGitHubAccount(id string) error
```

同样 token 脱敏，`HasToken` 标记是否有效。

### Trae IDE 路径配置

```go
func (s *ConfigService) GetTraeSettings() (*TraeSettings, error)
func (s *ConfigService) SaveTraeSettings(workspaceStoragePath, logsPath string) error
```

返回用户自定义路径和平台默认路径，前端可据此做 pre-fill。

Trae session 提取依赖 `workspaceStorage/state.vscdb` 与 `logs/`：

- `workspaceStorage` 用于读取当前 workspace 的 `memento/icube-ai-agent-storage`、输入历史以及用户维度的 `sessionRelation:*` 键。
- 当同一个 `state.vscdb` 因切换账号残留多个 Trae 用户前缀时，后端不再按任意命中的 `*_ai-chat:*` 键取第一个用户。
- 当前实现会优先根据 `currentSessionId` / `rawSessionId` 在 `sessionRelation:modelMap`、`modeMap`、`planModeMap`、`specModeMap` 中的归属来推断实际用户，再回退到旧的前缀扫描逻辑。
- 目的：避免把旧账号前缀错误拼入提取出的 Trae session 标识。

---

## 全局 KV 配置的已知 Key 列表

| Key | 说明 |
|-----|------|
| `gitlab_url` | GitLab 实例 URL |
| `gitlab_username` | GitLab 用户名 |
| `gitlab_token` | GitLab Personal Access Token（只写，GetConfig 返回空） |
| `default_models` | 全局默认克隆模型列表，换行符分隔 |
| `trae_workspace_storage_path` | Trae IDE workspace storage 自定义路径（覆盖平台默认） |
| `trae_logs_path` | Trae IDE logs 自定义路径（覆盖平台默认） |

前端通过 `getConfig(key)` / `setConfig(key, value)` 读写，底层为 `ConfigService.GetConfig` / `SetConfig`。

---

## Project 结构体字段

```go
type Project struct {
    ID                string `json:"id"`
    Name              string `json:"name"`
    GitLabURL         string `json:"gitlabUrl"`         // 项目级 GitLab URL（可覆盖全局）
    GitLabToken       string `json:"gitlabToken"`       // 已脱敏（列表接口返回为空）
    HasGitLabToken    bool   `json:"hasGitLabToken"`    // 是否已配置 token
    CloneBasePath     string `json:"cloneBasePath"`     // 代码克隆到本地的根目录
    Models            string `json:"models"`            // 换行符分隔的模型名称列表
    SourceModelFolder string `json:"sourceModelFolder"` // 源代码目录名（默认 "ORIGIN"）
    DefaultSubmitRepo string `json:"defaultSubmitRepo"` // 提交 PR 时的默认目标仓库
    TaskTypes         string `json:"taskTypes"`         // JSON 数组，任务类型名称列表
    TaskTypeQuotas    string `json:"taskTypeQuotas"`    // JSON map，各任务类型剩余配额
    TaskTypeTotals    string `json:"taskTypeTotals"`    // JSON map，各任务类型总配额
    OverviewMarkdown  string `json:"overviewMarkdown"`  // 项目简介 Markdown
    CreatedAt         int64  `json:"createdAt"`
    UpdatedAt         int64  `json:"updatedAt"`
}
```

字段说明：

- `Models`：换行符分隔的模型文件夹名，决定 clone 时创建哪些目录副本。优先级高于全局 `default_models`。
- `SourceModelFolder`：源代码副本的目录名，该名称对应的模型不参与执行计数（视为原始参照）。
- `TaskTypes`：JSON 数组如 `["feature", "bugfix", "refactor"]`，决定领题时可选的任务类型。
- `TaskTypeQuotas`：JSON map 如 `{"feature": 10, "bugfix": 5}`，记录各类型的剩余可领数量；`ConsumeProjectQuota` 每次领题时将对应值减 1（允许负数以支持超额领取）。
- `TaskTypeTotals`：JSON map，记录各类型的总配额，用于前端展示用量百分比；由 store 在 quota 首次写入时自动回填。

---

## LLMProvider 结构体字段

```go
type LLMProvider struct {
    ID           string  `json:"id"`
    Name         string  `json:"name"`           // 用于展示的名称
    ProviderType string  `json:"providerType"`   // "openai_compatible" | "anthropic" | "claude_code_acp" | "codex_acp"
    Model        string  `json:"model"`           // 模型 ID，如 "claude-3-5-sonnet-20241022"
    BaseURL      *string `json:"baseUrl"`         // 可选，覆盖默认 API 端点
    APIKey       string  `json:"apiKey"`          // 已脱敏（列表接口返回为空）
    HasAPIKey    bool    `json:"hasApiKey"`       // 是否已配置 APIKey
    IsDefault    bool    `json:"isDefault"`       // 是否为默认 Provider
    CreatedAt    int64   `json:"createdAt"`
    UpdatedAt    int64   `json:"updatedAt"`
}
```

ACP 类型（`claude_code_acp` / `codex_acp`）的 `APIKey` 可留空，因为认证由 CLI 工具自身管理。

---

## GitHubAccount 结构体字段

```go
type GitHubAccount struct {
    ID        string `json:"id"`
    Name      string `json:"name"`       // 账号别名（用于区分多账号场景）
    Username  string `json:"username"`   // GitHub 用户名
    Token     string `json:"token"`      // 已脱敏（列表接口返回为空）
    HasToken  bool   `json:"hasToken"`   // 是否已配置 token
    IsDefault bool   `json:"isDefault"`  // 是否为默认账号
    CreatedAt int64  `json:"createdAt"`
    UpdatedAt int64  `json:"updatedAt"`
}
```

---

## 多账户支持说明

PINRU 支持配置多个 GitHub 账号，用于在提交 PR 时灵活选择目标账号（例如区分个人账号和组织机器人账号）。

- 通过 `ListGitHubAccounts` 获取全部账号列表，`IsDefault` 标记默认账号。
- 提交 PR 时，前端在 Submit 页面选择账号；后端 `SubmitService` 根据选择的账号 ID 从 store 获取 token 发起 GitHub API 请求。
- `TestGitHubAccountConnection` 支持通过账号 ID 测试连通性，无需前端传递明文 token。
- token 在 `UpdateGitHubAccount` 时采用"空值保留"策略，前端编辑时不传 token 不会清除已有凭证。

GitLabSettings（`GetGitLabSettings` 返回类型）：

```go
type GitLabSettings struct {
    URL      string `json:"url"`
    Username string `json:"username"`
    HasToken bool   `json:"hasToken"` // token 脱敏，仅返回是否存在
}
```
