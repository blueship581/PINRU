# 如何管理任务（Task）与模型运行（ModelRun）

## 如何创建任务

入口方法：`TaskService.CreateTask(req CreateTaskRequest)`

### CreateTaskRequest 字段详解

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `gitlabProjectId` | int64 | 是 | GitLab 项目 ID，用于生成任务 ID 和查重 |
| `projectName` | string | 是 | 项目名称，仅作展示用 |
| `taskType` | string | 否 | 任务类型，空时默认 `未归类`；已知类型：`bug修复` / `feature迭代` / `代码生成` / `代码理解` / `代码重构` / `工程化` / `代码测试` |
| `claimSequence` | *int | 否 | 领题序号，用于同项目多次领题的 ID 区分；留空时从 `localPath` / `sourceLocalPath` 自动解析 |
| `localPath` | *string | 否 | 任务根目录本地路径；模型副本目录默认为此路径下以模型名命名的子目录 |
| `sourceModelName` | *string | 否 | 源模型名称（即参考答案所在目录），默认为 `ORIGIN`；名称匹配时 LocalPath 使用 `sourceLocalPath` |
| `sourceLocalPath` | *string | 否 | 源模型本地目录路径；当某个模型名与 `sourceModelName` 大小写不敏感匹配时，该模型的 LocalPath 取此值 |
| `models` | []string | 是 | 要创建的模型名列表，每个模型生成一条 ModelRun；不能有重复，不能有空字符串 |
| `projectConfigId` | *string | 否 | 关联项目配置 ID；提供后才会校验任务类型配额上限 |

### 模型副本目录规划规则

```
给定 localPath = "/workspace/tasks/task-001"，models = ["ORIGIN", "gpt-4o", "claude-3"]，
sourceModelName = "ORIGIN"，sourceLocalPath = "/workspace/source/origin-dir"

结果：
  ORIGIN     -> LocalPath = "/workspace/source/origin-dir"  （使用 sourceLocalPath）
  gpt-4o     -> LocalPath = "/workspace/tasks/task-001/gpt-4o"
  claude-3   -> LocalPath = "/workspace/tasks/task-001/claude-3"
```

### 创建行为说明

- 同一项目（`projectConfigID` + `gitLabProjectID` + `taskType` 的组合）若已存在任务则报错，不重复创建。
- `projectConfigID` 对应的项目配置中若设置了 `task_type_quotas`，则创建时校验领题数上限。
- 任务和所有 ModelRun 在同一个数据库事务中写入，保证原子性。
- 新建任务的 `status` 固定为 `Claimed`，ModelRun 的 `status` 固定为 `pending`。

---

## 如何查询任务

### 列表查询

```go
tasks, err := svc.ListTasks(projectConfigID)
// projectConfigID 为 nil 时返回全部任务
// projectConfigID 非空时过滤指定项目配置下的任务
// 结果按 created_at 降序排列
// LocalPath 会经过 tilde 展开规范化
```

### 单条查询

```go
task, err := svc.GetTask(id)
// id 不存在时返回 (nil, nil)，区别于错误
// LocalPath 同样经过规范化
```

---

## 如何更新任务状态

### 更新单个任务状态

```go
err := svc.UpdateTaskStatus(id, status)
// status 为任意字符串，Store 层不做枚举验证
// 任务不存在时返回错误
```

常见状态值：`Claimed` / `PromptReady` / `Submitted` / `ExecutionCompleted`

### 更新任务类型

```go
err := svc.UpdateTaskType(id, taskType)
// 同步更新 session_list[0].TaskType
// 同步调整 project.task_type_quotas（配额加减，不强制上限）
// 若注入了 GitService，还会触发本地源目录归一操作
```

### 批量更新

```go
result, err := svc.BatchUpdateTasks(BatchUpdateTasksRequest{
    TaskIDs: []string{"id1", "id2"},
    Field:   "status",   // 或 "taskType"
    Value:   "Submitted",
})
// result.Total / result.Succeeded / result.Failed 反映执行情况
// 单条失败不中断其他条目
```

### 更新会话列表

```go
err := svc.UpdateTaskSessionList(UpdateTaskSessionListRequest{
    ID:          taskID,
    ModelRunID:  nil,        // nil 时更新 Task 的 session_list
    SessionList: sessions,
})
// 若 ModelRunID 非空，则更新对应 ModelRun 的 session_list
// 写入前会校验每个 session 的 IsCompleted 和 IsSatisfied 必须非 nil
// 同步调整 project.task_type_quotas
```

---

## 如何管理模型运行（ModelRun）

### 查询 ModelRun 列表

```go
runs, err := svc.ListModelRuns(taskID)
// ORIGIN 模型排在最前，其余按 model_name 字母升序
// LocalPath 经过规范化
// 空结果返回 []store.ModelRun{}（非 nil slice）
```

### 更新 ModelRun 状态

```go
err := svc.UpdateModelRun(UpdateModelRunRequest{
    TaskID:     "task-001",
    ModelName:  "gpt-4o",
    Status:     "done",
    BranchName: &branch,    // 可选
    PrURL:      &prURL,     // 可选
    StartedAt:  &startedAt, // 可选，Unix 秒
    FinishedAt: &finishedAt,// 可选，Unix 秒
})
```

### 更新 ModelRun 会话信息（轻量更新）

```go
err := svc.UpdateModelRunSessionInfo(UpdateModelRunSessionRequest{
    ID:                 modelRunID,   // ModelRun UUID
    SessionID:          &sessionID,   // 可选，最新会话 ID
    ConversationRounds: 3,
    ConversationDate:   &date,        // 可选，Unix 秒
})
// 仅更新 session_id / conversation_rounds / conversation_date 三列
// 不涉及 session_list 内容
```

### 新增 ModelRun

```go
err := svc.AddModelRun(AddModelRunRequest{
    TaskID:    taskID,
    ModelName: "new-model",
    LocalPath: &path,  // 可选
})
// 若该 taskID + modelName 组合已存在则报错
// 新增的 ModelRun status 固定为 pending
```

### 删除 ModelRun

```go
err := svc.DeleteModelRun(taskID, modelName)
// 仅删除数据库记录，不操作本地文件系统
```

---

## 如何删除任务

```go
err := svc.DeleteTask(id)
```

DeleteTask 执行两步操作：

**第一步：尝试删除受管目录**

以下条件全部满足时，才会执行 `os.RemoveAll` 删除本地目录：

1. Task 的 `LocalPath` 非空
2. Task 有 `ProjectConfigID`，且数据库中能找到对应项目配置
3. `LocalPath` 的 baseName 符合受管任务目录命名规范（可解析出 claimSequence）
4. 重新推算出的期望路径与 `LocalPath` 完全一致（防止路径被手动修改过）
5. `LocalPath` 在 `project.CloneBasePath` 下，且不等于 `CloneBasePath` 本身

任意条件不满足则跳过文件系统删除，静默继续。

**第二步：删除数据库记录**

执行 `DELETE FROM tasks WHERE id = ?`。model_runs 的清理依赖数据库外键级联配置，Store 层本身不显式删除关联的 model_runs 记录。

---

## ListTaskChildDirectories 的用途

```go
children, err := svc.ListTaskChildDirectories(taskID)
```

此方法用于在复审（Code Review）场景中，列出任务根目录下的所有子目录，并关联每个子目录对应的 ModelRun 审核状态。

**返回值 `TaskChildDirectory` 字段说明：**

| 字段 | 说明 |
|---|---|
| `name` | 子目录名称 |
| `path` | 子目录绝对路径（规范化后） |
| `modelRunId` | 若该目录匹配某个 ModelRun 的 LocalPath，则填充 ModelRun UUID |
| `modelName` | 对应模型名称 |
| `reviewStatus` | 审核状态，未关联 ModelRun 或状态为空时显示 `none` |
| `reviewRound` | 审核轮次 |
| `reviewNotes` | 审核备注 |
| `isSource` | 是否为源目录（model 名为 ORIGIN 或与 project.SourceModelFolder 匹配） |

**根目录解析逻辑：**

- 优先使用 `task.LocalPath`（若目录存在）
- 否则取所有 ModelRun LocalPath 的公共父目录
- 若只有一个 ModelRun 路径，则取其 `filepath.Dir`
- 以上均不满足时报错

**排序规则：**

1. 源目录（`isSource = true`）排在最前
2. 已关联 ModelRun 的目录次之
3. 同组内按目录名字母升序排列

**过滤规则：**

- 跳过非目录条目
- 跳过以 `.` 开头的隐藏目录
- 跳过名称为空白的条目
