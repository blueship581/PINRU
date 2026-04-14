# Job System — 架构文档

> 源文件：`app/job/service.go` / `internal/store/background_job.go`
> 更新日期：2026-04-14

---

## 1. BackgroundJob 数据结构

```go
type BackgroundJob struct {
    ID              string  // UUID，任务唯一标识
    JobType         string  // 任务类型，见第 2 节
    TaskID          *string // 关联的 Task ID（可选）
    Status          string  // 状态，见第 3 节
    Progress        int     // 进度 0-100
    ProgressMessage *string // 当前进度描述文字
    ErrorMessage    *string // 失败原因（仅 status=error 时有值）
    InputPayload    string  // JSON 字符串，提交时传入的参数
    OutputPayload   *string // JSON 字符串，执行完成后的输出结果
    RetryCount      int     // 已重试次数
    MaxRetries      int     // 最大允许重试次数（默认 3）
    TimeoutSeconds  int     // 执行超时秒数（默认 300）
    CreatedAt       int64   // Unix 时间戳：创建时间
    StartedAt       *int64  // Unix 时间戳：开始执行时间
    FinishedAt      *int64  // Unix 时间戳：结束时间（done/error/cancelled）
}
```

`InputPayload` 和 `OutputPayload` 均为序列化 JSON，具体结构因 `JobType` 不同而异（见第 2 节）。

---

## 2. 任务类型及 Payload 结构

### 2.1 `prompt_generate` — 提示词生成

**InputPayload** — `appprompt.GeneratePromptRequest`（由 prompt 包定义，透传）

**OutputPayload** — `appprompt.GeneratePromptResponse`（含 `model`、生成的提示词内容等字段）

执行流程：调用 `PromptService.GenerateTaskPromptWithContext`，分析代码仓库后生成任务提示词。

---

### 2.2 `session_sync` — Session 同步

**InputPayload** — 无需额外字段，依赖 `taskId`（必填）

**OutputPayload** — `apptask.SyncTaskSessionsResult`（含 `updatedTargetCount` 等字段）

执行流程：调用 `TaskService.SyncLatestTaskSessions(taskID)`，同步最新 Session 数据。

---

### 2.3 `git_clone` — Git 仓库拉取与复制

**InputPayload — `GitClonePayload`**

```go
type GitClonePayload struct {
    CloneURL      string               // 远程仓库 URL
    SourcePath    string               // 主克隆目录（第一份）
    SourceModelID string               // 对应的模型 ID（可选，默认 "ORIGIN"）
    CopyTargets   []GitCloneCopyTarget // 克隆完成后需要复制到的其他目录
}

type GitCloneCopyTarget struct {
    ModelID string // 目标模型 ID
    Path    string // 目标目录路径
}
```

**OutputPayload — `GitCloneResult`**

```go
type GitCloneResult struct {
    SourcePath       string            // 主克隆目录
    SuccessfulModels []string          // 成功的模型 ID 列表
    FailedModels     []GitCloneFailure // 失败的模型列表
}

type GitCloneFailure struct {
    ModelID string // 失败的模型 ID
    Message string // 失败原因
}
```

---

### 2.4 `pr_submit` — GitHub PR 提交

**InputPayload — `PrSubmitPayload`**

```go
type PrSubmitPayload struct {
    GitHubAccountID string   // GitHub 账号 ID
    TaskID          string   // 任务 ID
    Models          []string // 要提交的模型列表
    TargetRepo      string   // 目标仓库（owner/repo）
    SourceModelName string   // 源模型名称
    GitHubUsername  string   // GitHub 用户名
    GitHubToken     string   // GitHub Token（敏感，仅在 payload 中传输，不持久化明文）
}
```

**OutputPayload** — `appsubmit.SubmitAllResult`（含各模型 PR URL 等字段）

---

### 2.5 `ai_review` — AI 代码复审

**InputPayload — `AiReviewPayload`**

```go
type AiReviewPayload struct {
    ModelRunID *string // 模型运行记录 ID（可选，用于去重 key 和轮次计算）
    ModelName  string  // 模型名称（用于日志和进度显示）
    LocalPath  string  // 本地代码目录路径（必填）
}
```

**OutputPayload — `AiReviewResult`**

```go
type AiReviewResult struct {
    ModelRunID   string // 模型运行记录 ID
    ModelName    string // 模型名称
    ReviewStatus string // "pass" | "warning"
    ReviewRound  int    // 本次为第几轮复审
    ReviewNotes  string // 复审备注
    NextPrompt   string // 下一轮建议提示词
    IsCompleted  bool   // 是否完成
    IsSatisfied  bool   // 是否满足要求
    ProjectType  string // 项目类型
    ChangeScope  string // 变更范围
    KeyLocations string // 关键代码位置
}
```

---

## 3. 状态机

```
pending ──[executeJob goroutine 启动]──► running
                                          │
                        ┌─────────────────┼─────────────────┐
                        ▼                 ▼                  ▼
                      done             error            cancelled
```

状态转换规则：

| 转换 | 触发条件 | Store 方法 |
|---|---|---|
| `pending` → `running` | `executeJob` 执行开始 | `StartBackgroundJob` |
| `running` → `done` | 执行成功完成 | `CompleteBackgroundJob` |
| `running` → `error` | 执行返回错误或超时 | `FailBackgroundJob` |
| `running` → `cancelled` | `CancelJob` 被调用 | `CancelBackgroundJob` |
| `error` → `pending` | `RetryJob` 被调用（满足条件时） | `IncrementBackgroundJobRetry` |

注意：`CancelBackgroundJob` 使用无条件 UPDATE（不过滤 status），其余状态变更 SQL 均带 `AND status != 'cancelled'` 保护，防止覆盖已取消任务。

---

## 4. Store 写入错误处理

所有对 Store 的状态写入操作均不再静默忽略错误（2026-04-14 修复，之前为 `_ = s.store.*`），改为：

```go
if err := s.store.StartBackgroundJob(id); err != nil {
    slog.Error("failed to mark job as started", "job_id", id, "error", err)
}
```

涉及的操作：

| 操作 | 触发时机 |
|---|---|
| `StartBackgroundJob` | job 开始执行时 |
| `FailBackgroundJob` | 超时或执行出错时（两处） |
| `CompleteBackgroundJob` | 执行成功时 |
| `UpdateBackgroundJobProgress` | 进度更新时 |
| `UpdateModelRunReview` | ai_review 各状态变更时（running/pass/warning，共 4 处） |

Store 写入失败不会中断 job 执行流程（仅记录日志），前端可能看到进度状态与数据库实际状态短暂不一致，但 Wails 事件系统仍会广播正确结果。

**TOCTOU 修复**：`CompleteBackgroundJob` 写入后移除了原本多余的第二次 `isJobCancelled` 检查——数据已写入，再检查取消状态无法撤销写入，且会误导读者认为该检查有防护作用。

---

## 5. 并发控制

### git_clone 信号量

```go
const gitCloneConcurrencyLimit = 3

cloneSem: make(chan struct{}, gitCloneConcurrencyLimit)
```

`git_clone` 任务在进入实际拉取前必须通过 `acquireGitCloneSlot` 获取信号量槽位（buffered channel 实现）。最多允许 3 个 `git_clone` 任务并发执行，超出的任务阻塞等待，直到 ctx 超时/取消或槽位释放。

信号量通过 `defer release()` 释放。由于 `CopyProjectDirectory` 现在接受 ctx，job 超时或取消后复制阶段的 git 子进程在 5s 内被 kill，`executeGitCloneAttempt` 随即返回，`defer release()` 释放槽位——此前复制阶段无 ctx 支持，可能长期占用槽位。

### 其他任务类型

`prompt_generate`、`session_sync`、`pr_submit`、`ai_review` 均在独立 goroutine 中执行，无额外并发限制。

---

## 6. 运行追踪（running map）

```go
type JobService struct {
    mu      sync.Mutex
    running map[string]context.CancelFunc
    ...
}
```

- 每个任务启动时：`s.running[id] = cancel`（在 `mu` 保护下写入）
- 任务结束时（无论成功/失败/取消）：`delete(s.running, id)`
- `CancelJob` 通过查找此 map 获取 `cancel` 函数，调用后触发 ctx 取消
- `isJobCancelled` 直接查询数据库 status 字段（而非依赖 map），避免竞态

---

## 7. 重试机制

### git_clone 内置重试

`git_clone` 任务在执行层面有内置的自动重试逻辑（与数据库层重试独立）：

```go
const (
    gitCloneRetryAttempts = 3        // 最多尝试 3 次
    gitCloneRetryBackoff  = 2 * time.Second  // 每次重试前等待 2 秒
    gitCloneIdleTimeout   = 30 * time.Second // 超过 30 秒无进度输出则中止
)
```

每次失败后调用 `cleanupGitCloneTargets` 清理已创建的目标目录，再等待 backoff 后重试。

由于 `CloneWithProgress` 和 `CopyProjectDirectory` 均采用了**原子临时目录**模式，最终路径在失败时不会存在，`cleanupGitCloneTargets` 作为附加保障层（处理 `os.Rename` 失败等极端情况）。主要清理逻辑已由各函数内部的 `defer os.RemoveAll(stagingPath)` 保证。

### 数据库层重试（RetryJob）

用户手动触发，通过 `RetryJob(id)` 方法：

条件：
1. 任务 `status` 必须为 `"error"`
2. `RetryCount < MaxRetries`

执行动作：
- 调用 `IncrementBackgroundJobRetry`：`retry_count += 1`，重置 status 为 `pending`，清空 `error_message`、`progress`、`started_at`、`finished_at`
- 重新启动 `executeJob` goroutine

---

## 8. ai_review 去重机制

提交 `ai_review` 任务时，`findActiveJobLocked` 在持锁状态下检查是否已有相同目标的活跃任务（`pending` 或 `running`）。

**去重 Key 的构成（`buildAiReviewTargetKey`）：**

```
优先级 1（有 ModelRunID）：  "run:<modelRunID>"
优先级 2（无 ModelRunID）：  "path:<filepath.Clean(localPath)>"
空结果（两者均为空）：        不去重
```

去重范围：同一 `taskId` 下的所有 `ai_review` 任务。

若命中已有活跃任务，`SubmitJob` 直接返回已有任务记录，不创建新任务。

---

## 9. JobProgressEvent 结构和前端订阅

### 事件结构

```go
type JobProgressEvent struct {
    ID              string  `json:"id"`              // 任务 ID
    JobType         string  `json:"jobType"`          // 任务类型
    TaskID          *string `json:"taskId"`           // 关联任务 ID（可为 null）
    Status          string  `json:"status"`           // 当前状态
    Progress        int     `json:"progress"`         // 进度 0-100
    ProgressMessage *string `json:"progressMessage"`  // 进度描述（可为 null）
    ErrorMessage    *string `json:"errorMessage"`     // 错误信息（可为 null）
}
```

事件名称：`"job:progress"`

触发时机：任务启动（running）、进度更新、完成（done）、失败（error）、取消（cancelled）。

### 前端订阅方式（Wails v3）

```typescript
// 订阅
Events.On('job:progress', (event: WailsEvent) => {
    const payload = event.data[0] as JobProgressEvent
    // 根据 payload.status 更新 UI 状态
})

// 取消订阅（组件卸载时）
Events.Off('job:progress', handler)
```

`running` 状态的事件同时会写入数据库（`UpdateBackgroundJobProgress`），其他终态事件仅通过 Wails 事件系统广播，不再写库。

---

## 10. JobService 方法签名列表

```go
// 构造
func New(st, promptSvc, gitSvc, submitSvc, taskSvc, cliSvc) *JobService

// 核心 CRUD
func (s *JobService) SubmitJob(req SubmitJobRequest) (*store.BackgroundJob, error)
func (s *JobService) GetJob(id string) (*store.BackgroundJob, error)
func (s *JobService) ListJobs(filter *store.JobFilter) ([]store.BackgroundJob, error)
func (s *JobService) RetryJob(id string) (*store.BackgroundJob, error)
func (s *JobService) CancelJob(id string) error
func (s *JobService) DeleteAiReviewJob(id string) error

// 内部执行（不对外暴露）
func (s *JobService) executeJob(id string, req SubmitJobRequest)
func (s *JobService) executePromptGenerate(ctx, jobID, req) (jobExecutionResult, error)
func (s *JobService) executeSessionSync(ctx, jobID, req) (jobExecutionResult, error)
func (s *JobService) executeGitClone(ctx, jobID, req) (jobExecutionResult, error)
func (s *JobService) executePrSubmit(ctx, jobID, req) (jobExecutionResult, error)
func (s *JobService) executeAiReview(ctx, jobID, req) (jobExecutionResult, error)
```

### SubmitJobRequest 字段

```go
type SubmitJobRequest struct {
    JobType        string // 任务类型（必填）
    TaskID         string // 关联 Task ID（部分类型必填）
    InputPayload   string // JSON 字符串（各类型结构不同）
    MaxRetries     int    // 最大重试次数（<=0 时默认 3）
    TimeoutSeconds int    // 超时秒数（<=0 时默认 300）
}
```

### Store 方法签名列表

```go
func (s *Store) CreateBackgroundJob(job BackgroundJob) error
func (s *Store) GetBackgroundJob(id string) (*BackgroundJob, error)
func (s *Store) ListBackgroundJobs(filter *JobFilter) ([]BackgroundJob, error)
func (s *Store) UpdateBackgroundJobProgress(id string, progress int, message string) error
func (s *Store) StartBackgroundJob(id string) error
func (s *Store) CompleteBackgroundJob(id string, outputPayload *string) error
func (s *Store) FailBackgroundJob(id string, errMsg string) error
func (s *Store) CancelBackgroundJob(id string) error
func (s *Store) DeleteBackgroundJob(id string) error
func (s *Store) IncrementBackgroundJobRetry(id string) error
func (s *Store) CleanupOldBackgroundJobs(maxAgeDays int) error
```
