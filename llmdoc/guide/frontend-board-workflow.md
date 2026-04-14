# 前端看板与工作流

## 概述

PINRU 前端基于 React + Wails v3 构建。功能按 features/ 目录分模块，全局状态由单一 Zustand store 管理，与后端的通信全部通过 `Call.ByName` 的 Wails RPC 机制完成。

---

## 5 个功能页面职责

| 功能模块 | 路径 | 职责 |
|---------|------|------|
| Board | `features/board/` | 任务看板，展示所有任务卡片；支持按状态/类型/轮次过滤；触发 AI 审核、删除任务、查看详情 |
| Claim | `features/claim/` | 领题界面，从 GitLab 拉取 MR/Issue，创建本地 Task 并发起 git clone |
| Prompt | `features/prompt/` | 提示词编辑器，生成/预览/修改发送给 LLM 的提示词，支持多 session 管理 |
| Submit | `features/submit/` | PR 提交界面，将执行结果提交到 GitHub，选择目标仓库和账号 |
| Settings | `features/settings/` | 设置页，管理 GitLab/GitHub 连接、LLM Provider、项目配置、Trae 路径等 |

---

## Zustand Store 核心 State 结构

Store 定义在 `frontend/src/store.ts`，使用 `create<AppState>` 创建单例。

```typescript
interface AppState {
  // 主题
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;

  // AI 审核功能开关（一旦解锁不可逆）
  aiReviewVisible: boolean;
  unlockAiReview: () => void;

  // 任务列表
  tasks: Task[];
  loadTasks: () => Promise<void>;
  addTask: (task: Task) => void;
  removeTask: (id: string) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  updateTaskType: (id: string, taskType: TaskType) => void;

  // 克隆模型列表（来自项目配置或全局 default_models）
  cloneModels: CloneModel[];
  loadCloneModels: () => Promise<void>;
  addCloneModel: (model: CloneModel) => void;
  removeCloneModel: (id: string) => void;
  updateCloneModel: (id: string, model: Partial<CloneModel>) => void;

  // 当前激活的项目
  activeProject: ProjectConfig | null;
  loadActiveProject: () => Promise<void>;
  setActiveProject: (project: ProjectConfig) => void;
  resetForNewProject: () => Promise<void>; // 切换项目时重置并重新加载

  // 后台 Job 列表
  backgroundJobs: BackgroundJob[];
  loadBackgroundJobs: () => Promise<void>;
  updateBackgroundJob: (job: Partial<BackgroundJob> & { id: string }) => void;
}
```

---

## Task 类型完整字段

```typescript
export interface Task {
  id: string;
  projectId: string;
  projectName: string;
  status: TaskStatus;            // 见状态枚举
  taskType: TaskType;            // 任务类型名称（由项目配置定义）
  sessionList: TaskSession[];    // 会话列表，每个 session 对应一次编码尝试
  promptGenerationStatus: PromptGenerationStatus;
  promptGenerationError: string | null;
  createdAt: number;             // Unix 时间戳（秒）
  executionRounds: number;       // 最大执行轮次数
  aiReviewRounds: number;        // 已完成的 AI 审核轮次数
  aiReviewStatus: ReviewStatus;  // 'none' | 'running' | 'pass' | 'warning'
  progress: number;              // 已完成的模型运行数
  totalModels: number;           // 参与执行的模型总数（排除 ORIGIN/source 模型）
  runningModels: number;         // 当前正在运行的模型数
}
```

TaskStatus 枚举：

```typescript
type TaskStatus =
  | 'Claimed'            // 已领题
  | 'Downloading'        // 正在 clone
  | 'Downloaded'         // clone 完成
  | 'PromptReady'        // 提示词已生成
  | 'ExecutionCompleted' // LLM 执行完成
  | 'Submitted'          // PR 已提交
  | 'Error';             // 出错
```

---

## Wails 调用模式

前端所有后端调用都通过 `callService` 函数（`frontend/src/api/wails.ts`）完成，底层使用 Wails v3 的 `Call.ByName`：

```typescript
Call.ByName(`${prefix}.${ServiceName}.${MethodName}`, ...args)
```

服务名到包路径的映射：

| ServiceName | Go 包路径 |
|-------------|----------|
| ConfigService | `github.com/blueship581/pinru/app/config` |
| JobService | `github.com/blueship581/pinru/app/job` |
| TaskService | `github.com/blueship581/pinru/app/task` |
| PromptService | `github.com/blueship581/pinru/app/prompt` |
| SubmitService | `github.com/blueship581/pinru/app/submit` |
| GitService | `github.com/blueship581/pinru/app/git` |
| CliService | `github.com/blueship581/pinru/app/cli` |
| ChatService | `github.com/blueship581/pinru/app/chat` |

若前缀无法解析（`unknown bound method name`），自动尝试备用前缀列表，成功后缓存结果。

---

## 4 种 Wails 事件

Board 页面通过 `Events.On` 监听后端推送的实时进度事件：

| 事件名 | 数据类型 | 触发时机 |
|--------|---------|---------|
| `job:progress` | `JobProgressEvent` | 后台 job 状态变化（创建/进度更新/完成/失败/取消） |
| `clone-progress` | `{ modelId, line }` | git clone 执行期间，每行 stderr/stdout 输出 |
| `cli:line` | `{ taskId, line }` | CLI 执行（LLM 调用）期间，每行输出 |
| `cli:done` | `{ taskId, success, error? }` | CLI 执行完成 |

`JobProgressEvent` 结构：

```typescript
interface JobProgressEvent {
  id: string;
  jobType: string;         // 'git_clone' | 'ai_review' | 'session_sync' | ...
  taskId: string | null;
  status: string;          // 'pending' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number;        // 0-100
  progressMessage: string | null;
  errorMessage: string | null;
}
```

---

## 工作流图：领题到提交 PR 的前端步骤

```
[Claim 页面]
  1. 用户输入 GitLab MR/Issue URL
  2. 调用 TaskService.CreateTask → 返回 Task（status=Claimed）
  3. 调用 JobService.SubmitJob（jobType=git_clone）
  4. 监听 clone-progress 事件更新进度条
  5. job:progress 事件 status=done → Task 状态变为 Downloaded

[Board 页面 + Prompt 功能]
  6. 用户在任务卡片选择提示词模板，进入 Prompt 页面
  7. 调用 PromptService.GeneratePrompt → 生成提示词
  8. Task 状态变为 PromptReady
  9. 用户可编辑提示词后提交执行（调用 CliService 相关方法）
 10. 监听 cli:line 流式输出，cli:done 完成
 11. Task 状态变为 ExecutionCompleted

[Board 页面 → AI 审核（可选）]
 12. 用户在执行概况里触发首轮 AI 复核，或在 AI 审核工作区里对某个节点单独复核
 13. 调用 JobService.SubmitAiReviewJob（jobType=ai_review）；节点复核时会带 `reviewNodeId`
 14. job:progress 事件推送审核进度；任务完成后重新拉取 `modelRuns` 和 `aiReviewNodes`
 15. 详情抽屉的 AI 审核页展示复核树：节点标题、原始任务提示词、当前节点提示词、父节点结论、不满意结论、最近建议提示词
 16. 若某节点返回多个独立问题，会自动拆出多个子节点；每个节点都可编辑后重新执行

[Submit 页面]
 17. 用户选择 GitHub 账号和目标仓库
 18. 调用 SubmitService.SubmitPR
 19. Task 状态变为 Submitted

---

## AI 审核工作区

Board 详情抽屉里的 AI 审核页由 `frontend/src/shared/components/TaskDetailDrawer.tsx` 渲染，数据来自 `useBoardTaskDetail`：

| 数据 | 来源 |
|---|---|
| `selectedModelRuns` | `TaskService.ListModelRuns` |
| `selectedAiReviewNodes` | `TaskService.ListAiReviewNodes` |
| 历史复审记录 | Zustand `backgroundJobs` 中的 `ai_review` jobs |

交互规则：

1. 首轮复核通过 `onAiReview(run)` 或任务卡片快捷入口触发。
2. 节点复核通过 `onAiReviewNode(node)` 触发，提交前若草稿有修改，会先调用 `onSaveAiReviewNode`。
3. 节点编辑只允许修改 `title`、`issueType`、`promptText`、`reviewNotes`。
4. 视图上的树序号是前端临时生成的展示序号，不回写数据库。
```

---

## CloneModel 去重与优先级

`loadCloneModels` 按以下优先级决定可用模型列表：

1. 若当前 `activeProject.models` 非空 → 使用项目级模型配置（换行符分隔）
2. 否则读取全局 KV `default_models`（换行符分隔）
3. 两者均为空时保留 store 初始值（`ORIGIN`、`cotv21-pro`、`cotv21.2-pro`）

名称为 `ORIGIN` 或与 `sourceModelFolder` 同名的模型被视为"非执行模型"，在统计 `totalModels` / `progress` 时自动排除。
