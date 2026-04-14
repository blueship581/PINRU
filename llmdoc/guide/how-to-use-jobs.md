# Job System — 操作指南

> 本指南面向开发者，说明如何在 PINRU 中使用后台任务系统（Job）。
> 源文件：`app/job/service.go`
> 更新日期：2026-04-14

---

## 1. 提交各类 Job

所有任务均通过 `JobService.SubmitJob(SubmitJobRequest)` 提交。`InputPayload` 为 JSON 字符串，结构因 `JobType` 不同而不同。

### 通用字段说明

```go
type SubmitJobRequest struct {
    JobType        string // 任务类型（见下方各节）
    TaskID         string // 关联 Task ID（session_sync / ai_review 必填）
    InputPayload   string // JSON 字符串，各类型结构见下方
    MaxRetries     int    // 可选，<=0 时默认 3
    TimeoutSeconds int    // 可选，<=0 时默认 300 秒
}
```

---

### 1.1 提交 `prompt_generate`

生成任务提示词，依赖 `PromptService.GenerateTaskPromptWithContext`。

```json
{
    "jobType": "prompt_generate",
    "taskId": "task-uuid-xxx",
    "inputPayload": "{\"taskType\": \"feature\", ...}"
}
```

`inputPayload` 内容透传给 `appprompt.GeneratePromptRequest`，具体字段参见 `app/prompt` 包定义。

---

### 1.2 提交 `session_sync`

同步指定 Task 的最新 Session 数据，`taskId` 为必填项。

```json
{
    "jobType": "session_sync",
    "taskId": "task-uuid-xxx",
    "inputPayload": "{}"
}
```

`inputPayload` 可为空 JSON 对象 `{}`，实际参数仅依赖 `taskId`。

---

### 1.3 提交 `git_clone`

从远程仓库克隆代码，并可选复制到多个本地目录。

```json
{
    "jobType": "git_clone",
    "taskId": "task-uuid-xxx",
    "inputPayload": "{\"cloneUrl\": \"https://github.com/owner/repo.git\", \"sourcePath\": \"/data/projects/repo-main\", \"sourceModelId\": \"model-A\", \"copyTargets\": [{\"modelId\": \"model-B\", \"path\": \"/data/projects/repo-b\"}, {\"modelId\": \"model-C\", \"path\": \"/data/projects/repo-c\"}]}"
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cloneUrl` | string | 远程仓库 URL |
| `sourcePath` | string | 主克隆目录（必须不存在，否则报目录冲突） |
| `sourceModelId` | string | 主克隆对应的模型 ID（可选，默认 `"ORIGIN"`） |
| `copyTargets` | array | 克隆成功后追加复制的目录列表 |

注意：目标目录必须不存在（系统启动时检查），否则任务会报错退出。

---

### 1.4 提交 `pr_submit`

将本地代码推送到 GitHub 并创建 PR。

```json
{
    "jobType": "pr_submit",
    "taskId": "task-uuid-xxx",
    "inputPayload": "{\"githubAccountId\": \"account-uuid\", \"taskId\": \"task-uuid-xxx\", \"models\": [\"model-A\", \"model-B\"], \"targetRepo\": \"owner/repo\", \"sourceModelName\": \"model-A\", \"githubUsername\": \"octocat\", \"githubToken\": \"ghp_xxx\"}"
}
```

注意：`githubToken` 仅在 payload 中临时传输，不应持久化明文存储。

---

### 1.5 提交 `ai_review`

对指定本地路径的代码执行 AI 复审，`taskId` 用于去重和轮次计算。

```json
{
    "jobType": "ai_review",
    "taskId": "task-uuid-xxx",
    "inputPayload": "{\"modelRunId\": \"run-uuid-xxx\", \"modelName\": \"model-A\", \"localPath\": \"/data/projects/repo-main\"}"
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `modelRunId` | string? | 模型运行记录 ID，用于去重 key（优先）和从数据库读取历史轮次 |
| `modelName` | string | 模型名称（用于进度显示） |
| `localPath` | string | 本地代码目录（必填） |

若同一 `taskId` + 相同目标（相同 `modelRunId` 或相同 `localPath`）已有 `pending`/`running` 任务，`SubmitJob` 直接返回已有任务，不重复创建。

---

## 2. 监听任务进度（前端事件订阅）

后台任务执行过程中，服务端通过 Wails 事件系统广播进度事件，事件名为 `"job:progress"`。

### 事件 Payload 结构

```typescript
interface JobProgressEvent {
    id: string               // 任务 ID
    jobType: string          // 任务类型
    taskId: string | null    // 关联 Task ID
    status: string           // "running" | "done" | "error" | "cancelled"
    progress: number         // 0-100
    progressMessage: string | null  // 当前步骤描述
    errorMessage: string | null     // 错误原因（status=error 时）
}
```

### 订阅示例（Wails v3 TypeScript）

```typescript
import { Events } from '@wailsapp/runtime'

function onJobProgress(event: WailsEvent) {
    const job = event.data[0] as JobProgressEvent

    switch (job.status) {
        case 'running':
            // 更新进度条：job.progress, job.progressMessage
            break
        case 'done':
            // 任务完成，刷新相关数据
            break
        case 'error':
            // 展示错误：job.errorMessage
            break
        case 'cancelled':
            // 任务已取消
            break
    }
}

// 组件挂载时订阅
Events.On('job:progress', onJobProgress)

// 组件卸载时取消订阅，避免内存泄漏
Events.Off('job:progress', onJobProgress)
```

### 过滤特定任务

事件是全局广播的，可通过 `job.id` 或 `job.taskId` 过滤出当前关心的任务：

```typescript
Events.On('job:progress', (event: WailsEvent) => {
    const job = event.data[0] as JobProgressEvent
    if (job.taskId !== currentTaskId) return
    // 处理当前任务的进度
})
```

---

## 3. 重试失败的 Job

调用 `JobService.RetryJob(id)` 手动重试失败任务。

### 前提条件

1. 任务 `status` 必须为 `"error"`（非 pending/running/done/cancelled）
2. `retryCount < maxRetries`（默认 maxRetries = 3）

### 调用示例

```go
updatedJob, err := jobSvc.RetryJob("job-uuid-xxx")
if err != nil {
    // 可能的错误：任务不存在、状态不是 error、已达最大重试次数
}
```

重试后任务状态立即变为 `pending`，然后 `executeJob` goroutine 重新启动，进度和错误信息被清空。

`RetryCount` 计数器每次重试 +1，达到 `MaxRetries` 后拒绝继续重试。

---

## 4. 取消 Job

调用 `JobService.CancelJob(id)` 取消任务，适用于任何状态的任务。

```go
err := jobSvc.CancelJob("job-uuid-xxx")
```

执行动作：
1. 若任务正在运行（在 `running` map 中），调用其 `context.CancelFunc` 中断执行
2. 数据库状态更新为 `cancelled`，`finished_at` 设为当前时间
3. 若任务类型为 `ai_review`，自动恢复 `ModelRun` 的复审状态至上一条有效历史记录
4. 广播 `job:progress` 事件（status = "cancelled"）

取消是异步的：`cancel()` 调用后 goroutine 会在下一个 ctx 检查点退出，过程是非阻塞的。

---

## 5. 删除 ai_review 任务记录

`ai_review` 完成后的历史记录可通过 `DeleteAiReviewJob(id)` 删除。

```go
err := jobSvc.DeleteAiReviewJob("job-uuid-xxx")
```

限制：
- 只能删除 `jobType = "ai_review"` 的任务
- `pending` 或 `running` 状态的任务不允许删除（须先取消）

删除后系统自动回溯同目标的其他历史复审记录，将 `ModelRun` 的复审状态更新为最近一条有效结果，若无历史记录则重置为 `"none"`。

---

## 6. 添加新的 Job 类型（扩展指南）

### 步骤 1：定义 Payload 结构体

在 `app/job/service.go` 中定义 Input / Output 结构体：

```go
// MyNewPayload 描述一次 my_new_type 任务的参数。
type MyNewPayload struct {
    SomeField string `json:"someField"`
}

type MyNewResult struct {
    OutputField string `json:"outputField"`
}
```

### 步骤 2：实现执行方法

```go
func (s *JobService) executeMyNewType(
    ctx context.Context,
    jobID string,
    req SubmitJobRequest,
) (jobExecutionResult, error) {
    var payload MyNewPayload
    if err := json.Unmarshal([]byte(req.InputPayload), &payload); err != nil {
        return jobExecutionResult{}, fmt.Errorf("解析 my_new_type 参数失败: %w", err)
    }

    // 报告进度（可选）
    s.emitProgress(jobID, req.JobType, req.TaskID, "running", 20, strPtr("处理中…"), nil)

    // 执行业务逻辑（注意通过 ctx 支持取消/超时）
    result := MyNewResult{OutputField: "xxx"}
    outputJSON, _ := json.Marshal(result)
    outputStr := string(outputJSON)

    return jobExecutionResult{
        outputPayload: &outputStr,
        finalMessage:  strPtr("已完成"),
    }, nil
}
```

### 步骤 3：在 switch 中注册新类型

在 `executeJob` 方法的 `switch req.JobType` 中添加 case：

```go
case "my_new_type":
    execResult, execErr = s.executeMyNewType(ctx, id, req)
```

### 步骤 4：注入依赖（如需要）

若新类型依赖新的 Service，在 `JobService` 结构体中添加字段，并在 `New(...)` 构造函数中注入。

### 规范要点

- 执行方法须接受 `ctx context.Context`，所有阻塞调用（网络/文件 IO）须使用 `select { case <-ctx.Done(): }` 支持取消
- 失败时返回 `error`，框架自动调用 `FailBackgroundJob` 并广播 error 事件
- 使用 `s.emitProgress` 汇报中间进度，进度值建议按逻辑阶段分配（0→20→50→80→100）
- 若需要去重逻辑，参考 `findActiveJobLocked` 的实现模式
