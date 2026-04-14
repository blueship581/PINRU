# Task 与 ModelRun 架构文档

## Task 状态机

Task 的 `status` 字段在整个生命周期内流转，合法值由 migration 016 的 CHECK 约束定义：
`'Claimed','Downloading','Downloaded','PromptReady','ExecutionCompleted','Submitted','Error'`

主要流转路径：

```
Claimed
  │  领取题卡后的初始状态
  ▼
Downloading
  │  开始克隆代码仓库
  ▼
Downloaded
  │  克隆完成
  ├─→ PromptReady          提示词生成完成（CompleteTaskPromptGeneration /
  │                         SyncTaskPromptFromArtifact 写入）
  └─→ ExecutionCompleted   模型执行评测完成（2026-04-13 migration 016 新增）
        ▼
      Submitted             已提交所有模型 PR
Error                       任意步骤失败时均可跳转至此
```

关键约束：
- `Submitted` 和 `ExecutionCompleted` 是"保护态"——`CompleteTaskPromptGeneration` 与 `SyncTaskPromptFromArtifact` 使用 `CASE WHEN` 保证这两个状态不被提示词生成流程覆盖。
- 合法值由数据库 CHECK 约束强制，Store 层不做额外枚举校验。
- `ExecutionCompleted` 表示模型已跑完全部评测，是任务的一个重要终态。

---

## ModelRun 生命周期

每个 ModelRun 代表一个模型对该任务的一次执行。`status` 字段流转：

```
pending
  │  CreateTaskWithModelRuns / CreateModelRun 初始写入
  ▼
running
  │  UpdateModelRun 推进，同时可写入 started_at、branch_name
  ▼
done          error
  │              │
  └──────┬───────┘
         ▼
      （终态）
      可附带 finished_at、pr_url、submit_error
```

审核字段独立于执行状态，在任意时刻均可通过 `UpdateModelRunReview` 更新。注意这里存的是“复核树汇总值”，不是单次审核原始结果：

| 字段 | 说明 |
|---|---|
| `review_status` | 审核结论：`none`（未触发或取消后恢复）/ `running`（执行中）/ `pass`（IsCompleted && IsSatisfied 均为 true）/ `warning`（达到最大轮次仍未满足，或执行出错） |
| `review_round` | 审核轮次，整数，从 0 开始 |
| `review_notes` | 审核备注文本，可为 null |

Session 相关字段（`session_id`、`conversation_rounds`、`conversation_date`、`session_list`）在 `UpdateModelRunSession` 与 `UpdateModelRunSessionList` 中独立更新，与执行状态互不干扰。

`review_round` 的汇总规则不是“根节点层级”也不是“最后一次 job 的 round”，而是当前激活节点 `run_count` 的总和；`review_notes` 则取最多 3 条未通过叶子节点的结论拼接摘要。

---

## 数据库字段全表

### tasks 表

| 列名 | Go 字段 | 类型 | 说明 |
|---|---|---|---|
| `id` | `ID` | TEXT PK | 任务唯一标识，由 buildTaskID 函数生成 |
| `gitlab_project_id` | `GitLabProjectID` | INTEGER | GitLab 项目 ID |
| `project_name` | `ProjectName` | TEXT | 项目名称 |
| `status` | `Status` | TEXT | 任务状态（见状态机） |
| `task_type` | `TaskType` | TEXT | 任务类型，默认值 `未归类` |
| `session_list` | `SessionList` | TEXT (JSON) | 会话列表，[]TaskSession 序列化 |
| `local_path` | `LocalPath` | TEXT NULL | 任务本地根目录路径 |
| `prompt_text` | `PromptText` | TEXT NULL | 生成的提示词文本 |
| `prompt_generation_status` | `PromptGenerationStatus` | TEXT | 提示词生成状态：`""` / `running` / `done` / `error` |
| `prompt_generation_error` | `PromptGenerationError` | TEXT NULL | 提示词生成失败错误信息 |
| `prompt_generation_started_at` | `PromptGenerationStartedAt` | INTEGER NULL | 提示词生成开始时间（Unix 秒） |
| `prompt_generation_finished_at` | `PromptGenerationFinishedAt` | INTEGER NULL | 提示词生成结束时间（Unix 秒） |
| `notes` | `Notes` | TEXT NULL | 人工备注 |
| `project_config_id` | `ProjectConfigID` | TEXT NULL | 关联的项目配置 ID |
| `created_at` | `CreatedAt` | INTEGER | 创建时间（Unix 秒） |
| `updated_at` | `UpdatedAt` | INTEGER | 最后修改时间（Unix 秒） |

### model_runs 表

| 列名 | Go 字段 | 类型 | 说明 |
|---|---|---|---|
| `id` | `ID` | TEXT PK | ModelRun UUID |
| `task_id` | `TaskID` | TEXT FK | 关联的 Task ID |
| `model_name` | `ModelName` | TEXT | 模型名称，同一任务内唯一 |
| `branch_name` | `BranchName` | TEXT NULL | 模型提交所在 Git 分支 |
| `local_path` | `LocalPath` | TEXT NULL | 模型副本本地目录路径 |
| `pr_url` | `PrURL` | TEXT NULL | 对应 PR 链接 |
| `origin_url` | `OriginURL` | TEXT NULL | 原始仓库 URL |
| `gsb_score` | `GsbScore` | TEXT NULL | GSB 评分结果 |
| `status` | `Status` | TEXT | 执行状态：`pending` / `running` / `done` / `error` |
| `started_at` | `StartedAt` | INTEGER NULL | 执行开始时间（Unix 秒） |
| `finished_at` | `FinishedAt` | INTEGER NULL | 执行结束时间（Unix 秒） |
| `session_id` | `SessionID` | TEXT NULL | 最近一个有效会话 ID |
| `conversation_rounds` | `ConversationRounds` | INTEGER | 总会话轮次数 |
| `conversation_date` | `ConversationDate` | INTEGER NULL | 最近会话时间（Unix 秒） |
| `submit_error` | `SubmitError` | TEXT NULL | 提交失败错误信息 |
| `session_list` | `SessionList` | TEXT (JSON) | 该 ModelRun 的会话列表，[]TaskSession 序列化 |
| `review_status` | `ReviewStatus` | TEXT | 审核状态，默认展示为 `none` |
| `review_round` | `ReviewRound` | INTEGER | 审核轮次 |
| `review_notes` | `ReviewNotes` | TEXT NULL | 审核备注 |

### ai_review_nodes 表

| 列名 | Go 字段 | 类型 | 说明 |
|---|---|---|---|
| `id` | `ID` | TEXT PK | 复核节点 ID |
| `task_id` | `TaskID` | TEXT | 关联 Task |
| `model_run_id` | `ModelRunID` | TEXT NULL | 关联 ModelRun，可空 |
| `parent_id` | `ParentID` | TEXT NULL | 父节点 ID，根节点为空 |
| `root_id` | `RootID` | TEXT | 所属根节点 ID |
| `model_name` | `ModelName` | TEXT | 展示用模型名 |
| `local_path` | `LocalPath` | TEXT | 复核目录 |
| `title` | `Title` | TEXT | 节点标题 |
| `issue_type` | `IssueType` | TEXT | 问题类型 |
| `level` | `Level` | INTEGER | 树深度，根节点为 1 |
| `sequence` | `Sequence` | INTEGER | 同层兄弟顺序 |
| `status` | `Status` | TEXT | `none` / `running` / `pass` / `warning` |
| `run_count` | `RunCount` | INTEGER | 当前节点累计执行次数 |
| `original_prompt` | `OriginalPrompt` | TEXT | 原始任务提示词 |
| `prompt_text` | `PromptText` | TEXT | 当前节点提示词 |
| `review_notes` | `ReviewNotes` | TEXT | 当前节点结论 |
| `parent_review_notes` | `ParentReviewNotes` | TEXT | 父节点结论快照 |
| `next_prompt` | `NextPrompt` | TEXT | 最近建议提示词 |
| `is_completed` | `IsCompleted` | INTEGER NULL | 结构化是否完成 |
| `is_satisfied` | `IsSatisfied` | INTEGER NULL | 结构化是否满意 |
| `project_type` | `ProjectType` | TEXT | 项目类型 |
| `change_scope` | `ChangeScope` | TEXT | 修改范围 |
| `key_locations` | `KeyLocations` | TEXT | 关键代码位置 |
| `last_job_id` | `LastJobID` | TEXT NULL | 最近一次触发该节点的后台任务 ID |
| `is_active` | `IsActive` | INTEGER | 是否属于当前有效树 |

---

## TaskService 方法签名列表

```go
// 构造函数
func New(store *store.Store, gitSvc *appgit.GitService) *TaskService

// 任务 CRUD
func (s *TaskService) ListTasks(projectConfigID *string) ([]store.Task, error)
func (s *TaskService) GetTask(id string) (*store.Task, error)
func (s *TaskService) CreateTask(req CreateTaskRequest) (*store.Task, error)
func (s *TaskService) DeleteTask(id string) error

// 任务状态与类型
func (s *TaskService) UpdateTaskStatus(id, status string) error
func (s *TaskService) UpdateTaskType(id, taskType string) error
func (s *TaskService) BatchUpdateTasks(req BatchUpdateTasksRequest) (*BatchUpdateResult, error)

// 会话列表
func (s *TaskService) UpdateTaskSessionList(req UpdateTaskSessionListRequest) error

// ModelRun 管理
func (s *TaskService) ListModelRuns(taskID string) ([]store.ModelRun, error)
func (s *TaskService) UpdateModelRun(req UpdateModelRunRequest) error
func (s *TaskService) UpdateModelRunSessionInfo(req UpdateModelRunSessionRequest) error
func (s *TaskService) AddModelRun(req AddModelRunRequest) error
func (s *TaskService) DeleteModelRun(taskID, modelName string) error
func (s *TaskService) ListAiReviewNodes(taskID string) ([]store.AiReviewNode, error)
func (s *TaskService) UpdateAiReviewNode(req UpdateAiReviewNodeRequest) error

// 本地目录操作
func (s *TaskService) OpenTaskLocalFolder(id string) error
func (s *TaskService) ListTaskChildDirectories(taskID string) ([]TaskChildDirectory, error)
```

---

## CreateTask 详细流程

```
CreateTask(req CreateTaskRequest)
│
├── 1. normalizeCreateTaskRequestPaths(req)
│       对 LocalPath 和 SourceLocalPath 做 tilde 展开 + 路径规范化
│
├── 2. buildTaskID(req)
│       格式：p{projectConfigToken}__{typeToken}__{label-XXXXX[-N]}
│       - projectConfigToken：ProjectConfigID 去掉前缀 "project-"，非字母数字替换为 "-"
│       - typeToken：已知类型映射短码（bug/feat/gen/cmp/ref/eng/test），
│                    未知类型用 FNV32a 哈希生成 h{6位十六进制}，默认类型（未归类）返回空
│       - label-XXXXX：基于 GitLabProjectID 的基础 ID
│       - N：ClaimSequence（领题序号），> 0 时追加 "-N"
│
├── 3. findExistingTask(req)
│       若任务已存在则返回错误（"当前项目下题卡已存在"）
│       兼容旧格式 ID（不含 typeToken）的查找
│
├── 4. enforceTaskTypeUpperLimit(req)
│       读取 projects.task_type_quotas（JSON map[taskType]int）
│       统计 tasks 表中同 projectConfigID + gitLabProjectID + taskType 的数量
│       超出上限则报错
│
├── 5. 构造 store.Task 和 []store.ModelRun
│       - Task.Status 固定为 "Claimed"（由 Store 层写入）
│       - 每个 Model 生成一个 ModelRun，LocalPath 规则：
│           * 若 model 名称（大小写不敏感）== sourceModelName，
│             且 SourceLocalPath 非空，则 LocalPath = SourceLocalPath
│           * 否则 LocalPath = req.LocalPath + "/" + model
│           * 若 req.LocalPath 为空则 LocalPath 为 nil
│       - 去重检测：同一请求内 model 名称不能重复
│
├── 6. store.CreateTaskWithModelRuns(task, modelRuns)
│       在一个事务中同时写入 tasks 和 model_runs
│       ModelRun 初始 status 固定为 "pending"
│
└── 7. 返回 store.GetTask(taskID)
```

---

## DeleteTask 联级操作

```
DeleteTask(id string)
│
├── 1. store.GetTask(id)  — 获取任务信息
│
├── 2. removeManagedTaskDirectory(task)
│       仅对"受管目录"执行文件系统删除，判断条件：
│       - task.LocalPath 非空
│       - task.ProjectConfigID 非空，且能查到对应 project
│       - LocalPath 的 baseName 能解析出 claimSequence（符合受管目录命名规范）
│       - 重建的 expectedPath 与 actualPath 完全一致（SamePath）
│       - actualPath 在 project.CloneBasePath 范围内且不等于 CloneBasePath 本身
│       满足以上全部条件才执行 os.RemoveAll；任意条件不满足则跳过，不报错
│
└── 3. store.DeleteTask(id)
        DELETE FROM tasks WHERE id = ?
        注意：model_runs 表的清理依赖数据库外键级联或后续应用层调用，
              Store 层的 DeleteTask 本身不显式删除 model_runs
```
