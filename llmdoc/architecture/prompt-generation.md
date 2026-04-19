# 提示词生成系统架构

## 1. 完整处理流程

```
GeneratePromptRequest
        |
        v
  [输入校验]
  - TaskID 非空
  - TaskType 非空
  - 任务存在且具有 LocalPath
  - Claude Code CLI 已安装
        |
        v
  [Provider 解析]
  resolveProviderForPromptGeneration
  - 优先使用 requestedID 指定的 claude_code_acp provider
  - 若无指定：优先 IsDefault=true 的 claude_code_acp
  - 退而选第一个 claude_code_acp
  - 若 providers 列表为空：fallback 到默认模型 claude-sonnet-4-6
        |
        v
  [状态写入] store.StartTaskPromptGeneration(taskID, startedAt)
        |
        v
  [构建 Skill Prompt] buildSkillPrompt(req)
  格式: "/评审项目提示词生成 [PINRU]\ntaskType: ...\nconstraints: ...\nscope: ...\nnotes: ..."
  注：constraints 仅作为方向参考传给 LLM，严禁在输出中使用"xx约束："标签格式
        |
        v
  [CLI Agent 执行] executeCliWithRetry (maxRetries=1)
        |
        +-- StartClaude(workDir, prompt, model, permissionMode="bypassPermissions")
        |         |
        |         v
        |   waitForCliCompletion (轮询间隔 500ms)
        |         |
        |         v
        |   [输出收集] PollOutput → lines 累积
        |         |
        |         v
        |   [ACP 错误检测] "No available accounts" / "no available accounts"
        |         |
        |         v
        |   完整输出字符串
        |
        v
  [提示词提取] ExtractPromptFromCLIOutput
  （4 层降级策略，见第 6 节）
        |
        v
  [状态写入] store.CompleteTaskPromptGeneration(taskID, promptText, startedAt)
        |
        v
  [文件同步] BestEffortSyncTaskPromptArtifact → 写入 任务提示词.md
        |
        v
  PromptGenerationResult { PromptText, ProviderName, Model, Status="PromptReady" }
```

---

## 2. PromptService 方法签名

所在包：`app/prompt`，源文件：`app/prompt/service.go`

```go
// 构造
func New(store *store.Store, cliSvc *appcli.CliService) *PromptService

// 主流程（不带 Context，内部使用 context.Background()）
func (s *PromptService) GenerateTaskPrompt(req GeneratePromptRequest) (*PromptGenerationResult, error)

// 主流程（带 Context，支持取消/超时）
func (s *PromptService) GenerateTaskPromptWithContext(ctx context.Context, req GeneratePromptRequest) (*PromptGenerationResult, error)

// 手动保存提示词（跳过生成，直接持久化并同步文件）
func (s *PromptService) SaveTaskPrompt(taskID, promptText string) error

// 测试 LLM Provider 连通性
func (s *PromptService) TestLLMProvider(provider store.LLMProvider) (bool, error)
```

内部方法：

```go
func (s *PromptService) executeCliWithRetry(ctx context.Context, workDir, prompt, model string, maxRetries int) (string, error)
func (s *PromptService) executeCliPromptGeneration(ctx context.Context, workDir, prompt, model string) (string, error)
func (s *PromptService) waitForCliCompletion(ctx context.Context, sessionID string) (string, error)
func (s *PromptService) resolveProviderForTest(provider store.LLMProvider) (store.LLMProvider, error)
```

---

## 3. 代码分析约束参数

所在包：`internal/analysis`，源文件：`internal/analysis/analysis.go`

| 参数名           | 值       | 说明                                   |
|----------------|---------|--------------------------------------|
| maxDepth       | 5       | 文件系统遍历最大递归深度                  |
| maxTrackedFiles| 240     | 收集文件总数上限                          |
| maxTreeEntries | 72      | 输出到 FileTree 的最大条目数              |
| maxKeyFiles    | 6       | 选出的关键文件数量上限                    |
| maxSnippetLines| 60      | 每个文件片段最大行数                      |
| maxSnippetChars| 2200    | 每个文件片段最大字符数                    |
| maxFileSizeBytes| 48×1024 | 跳过超过 48 KB 的文件                   |

忽略目录（`ignoredDirs`）：`.git`、`.idea`、`.vscode`、`.next`、`.turbo`、`node_modules`、`dist`、`build`、`coverage`、`target`、`__pycache__`

---

## 4. 技术栈检测逻辑

函数：`detectStack(files []fileEntry)`，按以下顺序检测，可叠加：

| 检测条件                                              | 识别结果              |
|------------------------------------------------------|---------------------|
| `package.json` 存在                                   | Node.js             |
| `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` | JavaScript 包管理   |
| `tsconfig.json` 存在，或任意 `.ts`/`.tsx` 文件         | TypeScript          |
| 任意 `.tsx` 文件存在                                   | React               |
| `Cargo.toml` 存在                                     | Rust                |
| `pyproject.toml` / `requirements.txt` 存在             | Python              |
| `go.mod` 存在                                         | Go                  |
| `pom.xml` / `build.gradle` 存在                        | JVM                 |
| `Dockerfile` 存在                                     | Docker              |
| 以上均不匹配                                          | 待识别项目           |

---

## 5. 关键文件优先级评分规则

函数：`filePriority(relativePath string) int`，数值越小优先级越高：

| 优先级 | 文件路径（精确匹配）                                      |
|--------|----------------------------------------------------------|
| 0      | `README.md`（根目录）                                    |
| 1      | `package.json`（根目录）                                 |
| 2      | `Cargo.toml`（根目录）                                   |
| 3      | `tsconfig.json`（根目录）                                |
| 4      | `vite.config.ts` / `vite.config.js`                     |
| 5      | `src/main.tsx` / `src/main.ts` / `src/main.rs`          |
| 6      | `src/App.tsx` / `src/App.ts` / `src/lib.rs`             |
| 7      | 文件名为 `README.md`（非根）                             |
| 8      | 文件名为 `package.json`（非根）                          |
| 9      | 文件名为 `Cargo.toml`（非根）                            |
| 10     | 文件名为 `tsconfig.json`（非根）                         |
| 20     | 路径以 `src/` 开头的其他文件                             |
| 50     | 其余所有文件                                             |

同优先级时，路径更短者优先；路径长度相同时按字典序。

选中的文件还需通过大小过滤（`maxFileSizeBytes = 48 KB`）和非空 snippet 校验，最终最多取 `maxKeyFiles = 6` 个。

---

## 6. 提示词提取 4 层降级策略

函数：`ExtractPromptFromCLIOutput(output string)`，源文件：`app/prompt/extract.go`

### 层 1 — JSON Payload 提取

调用 `ExtractPromptJSONPayload`，候选来源（按顺序尝试）：
1. 输出全文（TrimSpace）
2. 去除代码围栏（`` ``` ``）后的全文
3. 从输出中扫描第一个平衡 JSON 对象（`extractFirstJSONObject`）

结构体 `GeneratedPromptPayload` 字段：`version`、`prompt`、`promptText`、`artifactPath`/`artifact_path`、`fileWritten`/`file_written`；`prompt` 字段非空时优先于 `promptText`。

若 JSON 解析成功且 `prompt`/`promptText` 非空，直接返回。

### 层 2 — 标记间提取

调用 `ExtractPromptBetweenMarkers`，查找：
- 起始标记：`<<<PINRU_PROMPT_START>>>`
- 结束标记：`<<<PINRU_PROMPT_END>>>`

提取中间文本后经 `CleanPromptCandidate` 清洗，若 `PromptCandidateScore >= 4` 则返回。

### 层 3 — 启发式全文提取

对整个输出运行 `CleanPromptCandidate`，若 `PromptCandidateScore >= 4` 则返回。

### 层 4 — 分块最优提取

将输出按空行（`\n\n`）分块，对每块计算 `PromptCandidateScore`，选得分最高块，若 `>= 4` 则返回。

全部层级失败时返回错误：`模型输出中没有识别到可用的提示词正文`。

**PromptCandidateScore 评分规则：**

| 条件                          | 分值  |
|-------------------------------|------|
| rune 数 >= 30                 | +2   |
| rune 数 >= 12                 | +1   |
| 包含汉字                       | +2   |
| 包含 `。！？`                  | +2   |
| 非空行数 2–6 行                | +2   |
| 非空行数 = 1 行                | +1   |
| 非空行数 > 8 行                | -1   |
| 包含「任务提示词.md」           | -6   |
| 命中 `IsPromptStatusLine`     | -6   |

阈值：>= 4 分视为有效提示词候选。

---

## 7. 提示词规范 6 条要求

来源：`BuildSystemPrompt()`，`internal/prompt/prompt.go`

1. **只写业务需求，禁止写技术实现**：不能出现文件路径、类名、方法名、函数名、变量名、import 语句、package 名、数据库表名、字段名、API 路径的具体字符串；可以出现功能描述、业务场景、用户视角的操作描述。

2. **禁止 Markdown 格式**：不能出现井号标题、双星粗体、代码块、有序或无序列表符号；输出必须是纯文本段落。

3. **简短直接**：正文描述控制在 2–4 句话内，清晰表达「用户遇到了什么问题」或「需要什么新功能」；全文总长度不得超过 80 个字（空白字符不计入）；去掉所有铺垫语、客套语和废话。

4. **约束要求必须融入正文**：所有约束要求（技术栈、架构、代码风格、业务规则等）必须作为正文的自然组成部分写出，和需求描述合在同一段里；严禁将约束单独分段、分行或加任何前缀标签；严禁出现"xx约束：""xx约束:""xx要求："等"标签名称：内容"形式的分类标头；最终输出应该是一整段连贯的文字，像真实开发者在聊天窗口里一口气说完的需求；若无约束，则不要为了凑字数而添加约束相关的句子。

5. **口语化、自然**：读起来要像真实开发者或产品经理发出的任务描述；去除 AI 写作惯用的刻板措辞。

6. **输出前自检**：如果全文超过 80 个字，先自行压缩语言，再输出最终版本。

---

## 8. 自动压缩流程

### 触发条件

`PromptBodyExceedsLimit(promptText string) bool` 返回 `true`，即：
- `PromptBodyRuneCount` > `MaxPromptBodyRunes`（80）
- 计算时排除空白字符；兼容旧格式时排除约束标签行

### 实现

压缩由独立调用 LLM 完成，使用专用 System/User Prompt：

- `BuildShortenSystemPrompt(limit int)`：角色设定为「中文产品需求文案编辑」，指定字数上限，要求不改业务含义、不引入技术实现，所有约束融入正文，只输出精炼后的文字。
- `BuildShortenUserPrompt(body string, limit int)`：传入原文和上限，要求保留业务场景、问题现象和目标结果，所有内容合在一段里。

`SplitPromptSections(promptText string)` 保留用于向后兼容旧格式提示词（含约束标签行的），新生成的提示词不再有独立约束行。

---

## 9. 仓库分析入口

函数：`AnalyzeRepository(basePath string) (*Summary, error)`

**仓库根目录解析优先级：**
1. `basePath/ORIGIN` 或 `basePath/origin` 子目录
2. `basePath` 本身含 `.git`
3. `basePath` 下含 `.git` 的子目录（按字典序取第一个）
4. `basePath` 下任意子目录（按字典序取第一个）
5. 以上均失败 → 报错「未找到可分析的代码目录」

**Summary 结构：**

```go
type Summary struct {
    RepoPath      string        // 实际分析的根目录
    TotalFiles    int           // 总文件数（收集阶段）
    DetectedStack []string      // 检测到的技术栈标签
    FileTree      []string      // 格式化目录树（最多 72 条）
    KeyFiles      []FileSnippet // 关键文件片段（最多 6 个）
}
```

---

## 10. pg-code Review — 上下文采集与 Preload

### 路径解析

pg-code 脚本路径在运行时通过 `defaultPgCodeContextScriptPath()` 解析（2026-04-14 前为硬编码常量）：

```go
func defaultPgCodeContextScriptPath() string {
    home, err := os.UserHomeDir()
    if err != nil {
        return ""
    }
    return filepath.Join(home, ".codex", "skills", "pg-code", "scripts", "collect_project_context.py")
}
```

`CliService.reviewContextPath` 字段非空时优先使用，否则调用 `defaultPgCodeContextScriptPath()`。路径为空时返回 `(nil, nil)` 不报错（脚本可选）；文件不存在时返回错误。

### 采集流程（collectPgCodeReviewContext）

执行 `python3 {scriptPath} {localPath}`，将 stdout 解析为 `pgCodeProjectContext`：

```go
type pgCodeProjectContext struct {
    InputPath        string               // 用户传入路径
    ResolvedPath     string               // 实际解析路径
    Exists           bool                 // 目录是否存在
    ProjectIDGuess   string               // 项目 ID 猜测值
    PromptCandidates []string             // 候选提示词文件路径列表（由脚本输出）
    PromptSources    []pgCodePromptSource // 提示词内容预载（后端 enrichment 补充）
    Git              pgCodeGitContext     // Git 状态
    RecentFiles      []pgCodeRecentFile   // 最近修改文件
    Summary          pgCodeProjectSummary // 项目摘要
}
```

采集失败时记录 `slog.Warn` 并继续（非阻断）。

### Preload 机制（enrichPgCodeReviewContext）

采集完成后调用 `enrichPgCodeReviewContext` 进行上下文增强：

**Step 1：发现候选文件**（`discoverPromptCandidates`）
- 合并脚本已输出的候选路径
- 向上最多 4 层父目录搜索 `任务提示词.md`
- 向上最多 3 层父目录搜索文件名含 `提示词` 或 `prompt` 的 `.md` 文件
- 上限：`maxPgCodePromptCandidates = 6` 个

**Step 2：读取文件内容**（`loadPromptSources`）
- 最多读取 `maxPgCodePromptSources = 3` 个文件
- 每文件内容上限 `maxPgCodePromptContentRunes = 6000` 个字符，超出截断并标记 `Truncated: true`

```go
type pgCodePromptSource struct {
    Path      string // 文件绝对路径
    Content   string // 文件内容（可能已截断）
    Truncated bool   // 是否被截断
}
```

**作用**：让 CodeX Review Agent 在提示词中直接获取候选文件正文，无需额外读取文件，提升 Review 准确度。CodeX Review 提示词规则 #7 明确说明："预采集上下文里的 `prompt_sources` 已包含候选提示词正文……若存在多份，请优先依据正文判断原始需求。"
