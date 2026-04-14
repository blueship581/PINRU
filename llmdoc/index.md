# PINRU LLMDoc 主索引

PinRu 是一个 AI 模型代码评审工作站：从 GitLab 领取评审任务，借助 LLM 生成执行提示词，驱动多个 AI 模型（Claude Code、Codex 等）对目标代码仓库执行评审，将产出推送到 GitHub 并自动创建 Pull Request。技术栈为 Go 后端 + React/Wails v3 桌面前端 + SQLite 存储。

---

## Overview — 项目全景

| 文档 | 说明 |
|------|------|
| [project-overview.md](overview/project-overview.md) | 项目用途、整体架构、核心数据流、目录结构一览 |

---

## Architecture — 系统设计

| 文档 | 说明 |
|------|------|
| [task-model-run.md](architecture/task-model-run.md) | Task/ModelRun 状态机、字段语义、生命周期流转（含 review_status: none/running/pass/warning） |
| [job-system.md](architecture/job-system.md) | 后台 Job 队列的类型、状态流转与执行机制（含 Store 写入错误处理规范） |
| [git-integration.md](architecture/git-integration.md) | GitLab 拉取、本地 clone、GitHub 推送三层 Git 集成架构 |
| [prompt-generation.md](architecture/prompt-generation.md) | 提示词生成完整处理流程、PromptSource 组装机制与 pg-code Preload 特性 |
| [ai-review.md](architecture/ai-review.md) | AI 自动代码复审（ai_review）的后台任务机制与 pass/warning 判定 |
| [llm-providers.md](architecture/llm-providers.md) | LLM Provider 统一抽象接口，屏蔽多模型服务商差异 |

---

## Guide — 操作指南

| 文档 | 说明 |
|------|------|
| [how-to-manage-tasks.md](guide/how-to-manage-tasks.md) | 创建、更新、查询 Task 与 ModelRun 的方法入口与参数说明 |
| [how-to-use-jobs.md](guide/how-to-use-jobs.md) | 如何在代码中提交、监控、取消后台 Job |
| [how-to-submit-pr.md](guide/how-to-submit-pr.md) | 从源码上传到 GitHub PR 创建的完整操作参数与注意事项 |
| [how-to-generate-prompt.md](guide/how-to-generate-prompt.md) | GeneratePromptRequest 字段详解与提示词生成调用方式 |
| [frontend-board-workflow.md](guide/frontend-board-workflow.md) | 前端看板 React 组件结构、Zustand 状态管理、Wails RPC 调用方式 |

---

## Reference — 规范与配置

| 文档 | 说明 |
|------|------|
| [git-conventions.md](reference/git-conventions.md) | 分支策略、Commit 格式规范、PR 流程 |
| [coding-conventions.md](reference/coding-conventions.md) | 项目特有编码约束速查（Go 后端 + 前端） |
| [session-card-inline-controls.md](reference/session-card-inline-controls.md) | Session 卡片内联控制：任务类型切换、扣任务数开关、首轮固定规则 |
| [config-accounts.md](reference/config-accounts.md) | ConfigService 接口：KV 配置、项目、LLM Provider、GitHub 账户管理 |

---

## 常见问题快速导航

| 我想了解… | 看这里 |
|-----------|--------|
| Task 有哪些状态？Downloading/PromptReady/ExecutionCompleted 怎么流转？ | [task-model-run.md](architecture/task-model-run.md) |
| ModelRun review_status 值是什么？pass/warning/none 含义？ | [task-model-run.md](architecture/task-model-run.md) · [ai-review.md](architecture/ai-review.md) |
| Job 后台队列是怎么工作的？如何提交/取消 Job？ | [job-system.md](architecture/job-system.md) · [how-to-use-jobs.md](guide/how-to-use-jobs.md) |
| AI 审核结果如何判定 pass 还是 warning？ | [ai-review.md](architecture/ai-review.md) |
| 如何生成提示词？PromptSource 怎么配置？ | [prompt-generation.md](architecture/prompt-generation.md) · [how-to-generate-prompt.md](guide/how-to-generate-prompt.md) |
| pg-code Preload 是什么？候选提示词文件如何发现？ | [prompt-generation.md#10](architecture/prompt-generation.md) |
| 如何提交模型 PR 到 GitHub？ | [how-to-submit-pr.md](guide/how-to-submit-pr.md) |
| 如何新增 LLM Provider（如 Gemini）？ | [llm-providers.md](architecture/llm-providers.md) |
| 提示词规范、Commit 格式是什么？ | [coding-conventions.md](reference/coding-conventions.md) · [git-conventions.md](reference/git-conventions.md) |
| 前端状态如何管理？Wails RPC 怎么调用后端？ | [frontend-board-workflow.md](guide/frontend-board-workflow.md) |
| GitLab/GitHub Token 和账户怎么配置？ | [config-accounts.md](reference/config-accounts.md) |
