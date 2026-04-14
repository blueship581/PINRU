# AI 审核架构

## 概述

AI 审核（ai_review）是 PINRU 的后台任务机制，用于对已克隆的模型代码目录执行自动代码复审。当前实现不是“单次审核只产出一条结论”，而是“每次审核对应一个复核节点”，多个节点共同组成一棵复核树；`model_runs.review_status` / `review_round` / `review_notes` 只是这棵树的汇总结果。

---

## 审核触发方式

前端通过 `frontend/src/api/job.ts` 的 `submitAiReviewJob` 提交后台任务，后端入口是 `app/job/service.go` 的 `JobService.SubmitJob`。提交时会先规范化 payload，并确保本次任务绑定到一个明确的复核节点。

---

## AiReviewPayload 结构

字段语义如下：

| 字段 | 说明 |
|---|---|
| `reviewNodeId` | 可选。指定要复核的节点；子复核、节点重跑都依赖它 |
| `modelRunId` | 可选。首轮审核时用于定位 ModelRun 根节点 |
| `modelName` | 模型名称，用于进度文案与节点展示 |
| `localPath` | 待审核目录，必填 |
| `nodeSnapshot` | 仅后端内部回填到 job 入参；取消任务时用于恢复节点状态 |

处理规则：

1. 若前端直接传 `reviewNodeId`，后端读取该节点并以它为目标。
2. 若未传 `reviewNodeId`，后端会用 `taskId + modelRunId/localPath` 查找或创建首轮根节点。
3. `prepareAiReviewPayload` 会把解析后的节点快照写回 `background_jobs.input_payload`，供取消任务时恢复。

---

## AiReviewResult 结构

字段语义如下：

| 字段 | 说明 |
|---|---|
| `reviewNodeId` | 本次执行的节点 ID |
| `modelRunId` | 所属 ModelRun；未关联模型目录时可为空字符串 |
| `modelName` | 模型名称 |
| `reviewStatus` | 本节点本次执行后的结果：`pass` 或 `warning` |
| `reviewRound` | 当前节点的执行次数，不是整棵树的总层级 |
| `reviewNotes` | 当前节点结论 |
| `nextPrompt` | 模型给出的下一轮建议提示词 |
| `isCompleted` / `isSatisfied` | 结构化判定结果 |
| `projectType` / `changeScope` / `keyLocations` | 结构化附加信息 |
| `issues` | 首轮或父节点未通过时拆出的独立问题列表；每项会转成新的子节点 |

结果会写入 `background_jobs.output_payload`，随后由 `syncAiReviewNodeChildren` 和 `syncModelRunAiReviewSummary` 同步到节点树与 `model_runs` 汇总字段。

---

## 复核树模型

节点存储在 `ai_review_nodes` 表，核心字段见 `internal/store/ai_review_node.go`：

| 字段 | 说明 |
|---|---|
| `id` | 节点 ID |
| `task_id` | 所属任务 |
| `model_run_id` | 所属 ModelRun，可空 |
| `parent_id` | 父节点；根节点为空 |
| `root_id` | 所属根节点 ID |
| `title` | 节点标题，例如“首轮审核”“问题 1” |
| `issue_type` | 问题类型 |
| `original_prompt` | 原始任务提示词 |
| `prompt_text` | 当前节点下次复核使用的提示词，可编辑 |
| `review_notes` | 当前节点不满意结论，可编辑 |
| `parent_review_notes` | 运行子节点时带上的父节点结论 |
| `next_prompt` | 最近一次审核返回的建议提示词 |
| `status` | `none` / `running` / `pass` / `warning` |
| `run_count` | 当前节点累计执行次数 |
| `is_active` | 是否处于当前有效树中 |

树的生成与更新规则：

1. 首轮审核为每个 ModelRun 或目录生成一个根节点。
2. 若某节点未通过且返回多个 `issues`，系统会为每个 issue 新建一个子节点。
3. 父节点重新复核时，会先递归停用旧子树，再按最新 issues 重建新的直接子节点。
4. 任一节点都可以编辑 `title`、`issue_type`、`prompt_text`、`review_notes` 后重新执行。
5. 子节点执行时会同时携带 `original_prompt`、当前节点 `prompt_text`、父节点 `review_notes`。

---

## 状态流转

节点状态流转：

`none` → `running` → `pass` / `warning`

说明：

1. `none` 表示节点尚未执行，或取消任务后恢复到快照状态。
2. `running` 表示该节点存在进行中的 `ai_review` job。
3. `pass` 表示该节点最近一次结果满足 `IsCompleted && IsSatisfied`。
4. `warning` 表示该节点最近一次结果未通过，或执行出错。

`model_runs.review_status` 不是单节点状态，而是所有激活节点的汇总：

1. 存在任意激活节点 `running` → 汇总为 `running`
2. 所有激活叶子节点均为 `pass` → 汇总为 `pass`
3. 只要存在激活叶子节点不是 `pass` → 汇总为 `warning`
4. 没有激活节点或全部为 `none` → 汇总为 `none`

---

## 去重机制

每次提交 ai_review job 前，`SubmitJob` 会检查同一 task 下是否已存在未完成（pending/running）的同目标 job，若存在则拒绝新建（返回错误）。

去重 key 的构建逻辑（`buildAiReviewTargetKey`）：

1. 若 `reviewNodeId` 非空 → key = `node:<reviewNodeId>`
2. 若 `modelRunId` 非空 → key = `run:<modelRunId>`
3. 若 `localPath` 非空 → key = `path:<normalizedLocalPath>`

任一 key 命中同 task 下 pending/running 的现存 job，本次提交都会直接复用该 job。

---

## 取消与删除

取消运行中任务：

1. `CancelJob` 会取消后台上下文，并把 job 标记为 `cancelled`。
2. 若该 job 对应节点仍是最新任务，系统用 `nodeSnapshot` 恢复节点的 `status`、`run_count`、`review_notes`、`parent_review_notes`、`next_prompt` 等字段。
3. 恢复后重新汇总所属 `model_run` 的 `review_status` / `review_round` / `review_notes`。

删除已完成任务：

1. `DeleteAiReviewJob` 只删除 `background_jobs` 记录，不回滚节点树。
2. 当前节点状态与 ModelRun 汇总保持不变；复核树始终以 `ai_review_nodes` 为准，而不是历史 job 列表。

---

## aiReviewMaxRounds 值和重试逻辑

当前 `aiReviewMaxRounds = 1`，含义是“每次提交只执行一次 CodexReview，不做同节点内部自动重试”。循环仍保留重试骨架：

- `attempt` 从 1 到 `aiReviewMaxRounds` 循环。
- 某次执行报错且已到最后一次时，节点落为 `warning`。
- 某次执行成功时，节点会立即持久化结果，并据此重建子节点。

是否继续修复，依赖用户对节点的再次编辑与重新执行，而不是内部自动多轮推进。
