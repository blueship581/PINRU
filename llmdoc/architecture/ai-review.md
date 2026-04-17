# AI 审核架构

## 概述

AI 审核（ai_review）是 PINRU 的后台任务机制，用于对已克隆的模型代码目录执行自动代码复审。采用线性轮次模型：每轮审核产出一条不可变记录，历史清晰可追溯。`model_runs.review_status` / `review_round` / `review_notes` 是所有轮次的汇总结果。

---

## 审核触发方式

前端通过 `frontend/src/api/job.ts` 的 `submitAiReviewJob` 提交后台任务，后端入口是 `app/job/service.go` 的 `JobService.SubmitJob`。提交时会先规范化 payload，并确保本次任务绑定到一个明确的复审轮次（round）。

---

## AiReviewPayload 结构

| 字段 | 说明 |
|---|---|
| `reviewRoundId` | 可选。后端在 `ensureAiReviewRound` 中自动创建并回填 |
| `modelRunId` | 可选。首轮审核时用于定位 ModelRun |
| `modelName` | 模型名称，用于进度文案 |
| `localPath` | 待审核目录，必填 |
| `nextPromptOverride` | 可选。用户指定下一轮使用的提示词，覆盖上轮 `next_prompt` |
| `roundSnapshot` | 仅后端内部回填；取消任务时用于恢复轮次状态 |

处理规则：

1. `prepareAiReviewPayload` 调用 `ensureAiReviewRound`，创建新的 round 行（INSERT），确定 `round_number`、`prompt_text`。
2. 若 `nextPromptOverride` 非空，用它作为本轮 `prompt_text`；否则使用上一轮的 `next_prompt`。
3. `roundSnapshot` 写回 `background_jobs.input_payload`，供取消任务时恢复。

---

## AiReviewResult 结构

| 字段 | 说明 |
|---|---|
| `reviewRoundId` | 本次执行的轮次 ID |
| `modelRunId` | 所属 ModelRun |
| `modelName` | 模型名称 |
| `reviewStatus` | 本轮结果：`pass` 或 `warning` |
| `reviewRound` | 轮次编号 |
| `reviewNotes` | 本轮结论 |
| `nextPrompt` | 模型给出的下一轮建议提示词 |
| `isCompleted` / `isSatisfied` | 结构化判定结果 |
| `projectType` / `changeScope` / `keyLocations` | 结构化附加信息 |

结果写入 `background_jobs.output_payload`，随后由 `FinalizeAiReviewRound` 写入轮次记录，再由 `syncModelRunAiReviewSummaryFromRounds` 同步到 `model_runs` 汇总字段。

---

## 线性轮次模型

轮次存储在 `ai_review_rounds` 表，核心字段见 `internal/store/ai_review_round.go`：

| 字段 | 说明 |
|---|---|
| `id` | 轮次 ID |
| `task_id` | 所属任务 |
| `model_run_id` | 所属 ModelRun，可空 |
| `local_path` | 待审核目录 |
| `model_name` | 模型名称 |
| `round_number` | 轮次编号，同 model_run + local_path 递增 |
| `original_prompt` | 原始任务提示词（快照） |
| `prompt_text` | 本轮实际发给 codex 的提示词 |
| `status` | `none` / `running` / `pass` / `warning` |
| `is_completed` / `is_satisfied` | 结构化判定 |
| `review_notes` | 本轮结论 |
| `next_prompt` | 模型给出的下轮建议提示词 |
| `job_id` | 关联的后台任务 ID |

核心设计原则：

1. 每轮是一条独立记录，INSERT 创建。
2. `FinalizeAiReviewRound` 是唯一允许的 UPDATE 路径——写入结论字段（`status`/`review_notes`/`next_prompt` 等），写完不再改。
3. 历史轮次不可编辑，前端展示为只读列表。
4. 用户不满意时，在输入框填写新提示词，触发下一轮——系统自动创建新 round 行。

---

## 状态流转

轮次状态：`none` → `running` → `pass` / `warning`

1. `none`：轮次已创建但未执行，或取消后恢复。
2. `running`：该轮次存在进行中的 `ai_review` job。
3. `pass`：本轮结果满足 `IsCompleted && IsSatisfied`。
4. `warning`：本轮结果未通过，或执行出错。

`model_runs.review_status` 汇总逻辑（`SummarizeAiReviewRounds`）：

1. 最新轮次为 `running` → 汇总为 `running`
2. 从最新往前找第一个 `pass`/`warning` → 使用该轮的 status/round/notes
3. 所有轮次均为 `none` → 汇总为 `none`

---

## 去重机制

每次提交 ai_review job 前，`SubmitJob` 检查同一 task 下是否已存在未完成（pending/running）的同目标 job。

去重 key 构建逻辑（`buildAiReviewTargetKey`）：

1. 若 `reviewRoundId` 非空 → key = `round:<reviewRoundId>`
2. 若 `modelRunId` 非空 → key = `run:<modelRunId>`
3. 若 `localPath` 非空 → key = `path:<normalizedLocalPath>`

---

## 取消与删除

取消运行中任务：

1. `CancelJob` 取消后台上下文，把 job 标记为 `cancelled`。
2. `restoreAiReviewRoundAfterCancellation` 将轮次 `status` 恢复为 `none`。
3. 重新汇总所属 `model_run` 的 `review_status` / `review_round` / `review_notes`。

删除已完成任务：

1. `DeleteAiReviewJob` 只删除 `background_jobs` 记录，不回滚轮次。
2. 当前 ModelRun 汇总保持不变。

---

## 前端展示

AI 复审 tab（`TaskDetailDrawer.tsx` 的 `renderAiReviewWorkspace`）：

- 按 `modelRunId` 分组，每组内按 `round_number` 排列
- 每轮显示：状态标签、使用提示词（可展开）、结论、结构化详情
- 历史轮次只读，不可编辑
- 最新轮次下方提供"下一轮提示词"输入框（预填 `next_prompt`）和"启动下一轮复审"按钮

---

## 旧表兼容

`ai_review_nodes` 表保留但不再主动写入。`syncModelRunAiReviewSummary`（`app/task/service.go`）在无 rounds 数据时回退到节点汇总，兼容迁移前的历史数据。
