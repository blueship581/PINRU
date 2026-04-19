# 提示词生成操作指南

## 1. GeneratePromptRequest 字段详解

源文件：`app/prompt/service.go`

```go
type GeneratePromptRequest struct {
    TaskID          string   `json:"taskId"`
    ProviderID      *string  `json:"providerId"`
    TaskType        string   `json:"taskType"`
    Scopes          []string `json:"scopes"`
    Constraints     []string `json:"constraints"`
    AdditionalNotes *string  `json:"additionalNotes"`
    ThinkingBudget  string   `json:"thinkingBudget"`
}
```

### TaskID（必填）

任务的唯一标识符。对应的任务必须已完成领题 Clone（即 `task.LocalPath` 非 nil），否则返回错误「当前任务没有本地代码目录，请先完成领题 Clone」。

### TaskType（必填）

任务类型字符串，由 `NormalizeTaskType` 进行别名归一化，支持中英文混用。

**枚举值与别名：**

| 标准值        | 接受的别名                                  |
|--------------|-------------------------------------------|
| 未归类        | uncategorized、unclassified、未分类、未归类  |
| Bug修复       | bugfix、bug修复、缺陷修复                    |
| 代码生成       | 代码生成                                   |
| Feature迭代   | feature、feature迭代、功能开发              |
| 代码理解       | 代码理解                                   |
| 代码重构       | refactor、代码重构                          |
| 性能优化       | perf、性能优化                              |
| 工程化        | 工程化                                     |
| 代码测试       | test、测试、测试补全、代码测试               |

归一化规则：去除首尾空白 → 转全小写 → 去除空格 → 查别名表；未匹配则直接使用原始值。

### ProviderID（可选）

指定使用的 LLM Provider ID（`*string`）。为 nil 或空字符串时按默认选择逻辑执行（见第 2 节）。指定的 Provider 必须为 `claude_code_acp` 类型，否则报错。

### Scopes（可选）

修改范围标签数组，可多选。枚举值：

| 值           | 含义                                           |
|-------------|-----------------------------------------------|
| 单文件        | 改动仅限于单一功能点或单一页面                    |
| 模块内多文件   | 改动涉及同一功能模块内的多个协作部分               |
| 跨模块多文件   | 改动需要跨越多个不同功能模块                      |
| 跨系统多模块   | 改动涉及前后端联动、多个子系统或数据存储与业务逻辑联动 |

传入空数组或 nil 时，不向 LLM 提供范围限制。

### Constraints（可选）

约束标签数组，可多选。枚举值：

| 值               | 对应提示词标签名    |
|-----------------|-----------------|
| 技术栈或依赖约束   | 技术栈约束         |
| 架构或模式约束     | 架构约束           |
| 代码风格或规范约束  | 代码规范约束        |
| 非代码回复约束     | 非代码回复约束      |
| 业务逻辑约束       | 业务逻辑约束        |
| 无约束            | （过滤，不生成标签） |

「无约束」会被过滤，其他值若未命中映射表则原样传入 LLM。

### AdditionalNotes（可选）

`*string`，额外补充说明，会作为「额外要求」段落注入到 User Prompt，影响 LLM 出题方向。

### ThinkingBudget（可选）

字段保留，当前版本未用于 CLI 执行逻辑，可传空字符串。

---

## 2. LLM 提供商选择逻辑

函数：`resolveProviderForPromptGeneration`，`app/prompt/service.go`

生成提示词**只支持** `claude_code_acp` 类型的 Provider，不支持直接 API Key 类型。

**选择优先级：**

```
1. ProviderID 已指定
   → 在 providers 列表中精确匹配 ID
   → 若未找到：报错「未找到所选的提示词提供商，请重新选择 Claude Code (ACP)」
   → 若类型非 claude_code_acp：报错「生成提示词当前仅支持 Claude Code (ACP) 提供商」

2. ProviderID 未指定
   → 优先选 IsDefault=true 且 ProviderType=claude_code_acp 的 Provider
   → 若无：选第一个 ProviderType=claude_code_acp 的 Provider
   → 若均无：报错「未找到可用的 Claude Code (ACP) 提供商，请先在设置中配置一个」

3. providers 列表为空（未配置任何 Provider）
   → 使用内置默认值：Name="Claude Code CLI"，Model="claude-sonnet-4-6"
```

**默认模型：**

```go
const defaultPromptGenerationModel = "claude-sonnet-4-6"
```

---

## 3. 手动保存提示词（SaveTaskPrompt）

函数签名：

```go
func (s *PromptService) SaveTaskPrompt(taskID, promptText string) error
```

适用场景：用户在前端编辑或粘贴提示词内容后，跳过生成流程直接持久化。

**执行步骤：**

1. 校验 `taskID` 和 `promptText` 均非空字符串（去空格后）。
2. 调用 `LoadTaskForPromptSync` 获取任务，确保任务存在。
3. `store.UpdateTaskPrompt(taskID, promptText)` 写入数据库。
4. `BestEffortSyncTaskPromptArtifact` 同步写入本地文件（尽力，失败只记日志不报错）。

注意：`SaveTaskPrompt` 不更改任务的提示词状态（不调用 `Start/Complete/Fail`），仅更新内容字段。

---

## 4. 提示词文件同步路径

**文件名：** `任务提示词.md`

**路径计算：**

```go
func PromptArtifactPath(workDir string) string {
    return filepath.Join(workDir, "任务提示词.md")
}
```

`workDir` 来自 `task.LocalPath`，经 `util.NormalizePath` 展开（处理 `~/` 前缀等平台差异）。

**写入时机：**

| 时机                        | 调用函数                            |
|---------------------------|-------------------------------------|
| 自动生成成功后               | `BestEffortSyncTaskPromptArtifact`  |
| 手动保存（SaveTaskPrompt）   | `BestEffortSyncTaskPromptArtifact`  |

`BestEffortSyncTaskPromptArtifact` 是「尽力写入」封装：写入失败只通过 `slog.Error` 记录日志，不向调用方传播错误。

**文件格式：** `strings.TrimSpace(promptText) + "\n"`，纯文本，UTF-8，权限 `0o644`。

**前置条件：**
- `task.LocalPath` 非 nil
- 目录必须已存在（不会自动创建目录）
- 目录不能是文件

---

## 5. 常见错误排查

### 5.1 ACP 账号池耗尽

**现象：** 错误信息包含「Claude Code ACP 账号池暂时耗尽（503）」

**原因：** CLI 输出中出现 `No available accounts` 或 `no available accounts`，由 `waitForCliCompletion` 检测后转换为用户友好信息。

**排查步骤：**
1. 等待 1–5 分钟后重试，ACP 账号池为共享资源，高峰期会临时耗尽。
2. 检查 ACP 配置（账号数量、并发上限、地区设置）。
3. 若持续出现，联系 ACP 管理员确认账号池状态。

### 5.2 提示词超长（自动压缩失败）

**现象：** 生成的提示词正文超过 80 字（`PromptBodyRuneCount > 80`）

**背景：** 压缩由 System Prompt 规则要求 LLM 自检，若 LLM 未遵守则由调用方二次调用压缩专用 Prompt。

**排查步骤：**
1. 使用 `PromptBodyRuneCount(promptText)` 确认全文字数（空白字符不计入；兼容旧格式时排除约束标签行）。
2. 手动调用 `BuildShortenSystemPrompt` + `BuildShortenUserPrompt` 发起压缩请求。
3. 压缩后调用 `SaveTaskPrompt` 保存结果。

### 5.3 提示词提取失败

**现象：** 错误信息「无法从 Agent 输出中提取提示词」或「模型输出中没有识别到可用的提示词正文」

**原因：** 4 层降级策略均未找到得分 >= 4 的候选文本。

**排查步骤：**
1. 查看 slog 日志中 CLI 的原始输出内容，确认 LLM 是否有实质性输出。
2. 若输出为空，检查 Claude Code CLI 是否正常安装：`claude --version`。
3. 若输出包含报错（如权限问题、网络超时），优先解决 CLI 执行问题。
4. 若输出有内容但提取失败，可能是 LLM 输出含大量干扰行（状态行、路径行）。检查 `IsPromptStatusLine` 和 `IsPromptNoiseLine` 过滤后的剩余内容。
5. 最后确认输出是否包含中文字符（`containsHanRune`）和自然语言句子（含 `。！？`），评分不足 4 分时提取会失败。

### 5.4 Claude Code CLI 未安装

**现象：** 错误信息「请先安装 Claude Code CLI: npm install -g @anthropic-ai/claude-code」

**解决方案：** 按提示安装后重试。安装后系统调用 `cliSvc.CheckCLI()` 验证可用性。

### 5.5 提示词生成超时或取消

**现象：**
- 超时：「提示词生成超时，请稍后重试」（`context.DeadlineExceeded`）
- 取消：「提示词生成已取消」（`context.Canceled`）

**说明：** 超时和取消不会触发自动重试（`executeCliWithRetry` 对这两种错误直接返回，不消耗重试次数）。取消时会调用 `cliSvc.CancelSession` 清理后台 CLI 进程。

### 5.6 重试耗尽

**现象：** 「提示词生成失败，已重试 1 次。请检查 Claude Code 配置后重试。最后一次错误: ...」

**说明：** 当前 `maxRetries=1`，即最多执行 2 次（1 次初始 + 1 次重试）。检查 Claude Code 配置、网络连接、ACP 账号后重试整个生成流程。
