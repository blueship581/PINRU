# PinRu 项目概览

## 项目用途

PinRu 是一个 **AI 模型代码评审工作站**。它从 GitLab 领取代码评审任务，借助 LLM 生成执行提示词，驱动多个 AI 模型（如 Claude Code、Codex）对目标代码仓库执行评审，最终将评审产出推送到 GitHub 并自动创建 Pull Request。

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面框架 | Wails v3（Go 后端 + WebView 前端） |
| 后端语言 | Go 1.25 |
| 数据库 | SQLite，纯 Go 驱动 `modernc.org/sqlite`，路径 `~/.pinru/pinru.db` |
| 前端框架 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand |
| Git 操作 | `os/exec` 调用系统 git CLI |
| AI 接入 | OpenAI Compatible API / Anthropic API |
| 平台 | macOS / Windows / Linux |

---

## 核心工作流

```
领题 (Claim) → 生成提示词 (Prompt) → 执行 (Execute) → 提交 PR (Submit)
```

1. **领题**：调用 GitLab API 获取可评审项目列表，克隆代码到本地，为每个目标模型创建独立副本目录。
2. **生成提示词**：分析代码仓库结构，调用 LLM 生成面向各 AI 模型的执行提示词，保存到数据库。
3. **执行**：在各模型副本目录中启动 CLI（Claude Code / Codex），读取提示词完成评审，结果写回本地文件。
4. **提交 PR**：将源码与模型产出推送到 GitHub，通过 GitHub API 自动创建 Pull Request，记录 PR URL 与审核状态。

---

## 架构分层

```
frontend (React/TS)
    │  Wails bindings（自动生成）
    ▼
app/ (Go 服务层，8 个包)
    ├── config   — 全局配置、项目/LLM/GitHub 账户 CRUD
    ├── git      — GitLab 项目获取、仓库克隆、本地目录管理
    ├── task     — 任务生命周期管理（状态流转）
    ├── prompt   — 提示词生成与持久化
    ├── submit   — 源码发布、GitHub PR 创建
    ├── chat     — 聊天会话管理
    ├── cli      — Claude Code / Codex CLI 封装（os/exec）
    └── job      — 后台异步任务调度
    │
    ▼
SQLite (~/.pinru/pinru.db)
```

---

## 数据模型

| 表 | 说明 |
|----|------|
| `tasks` | 评审任务，记录状态、关联项目、本地路径 |
| `model_runs` | 每个模型的执行记录，属于 task，含 PR URL 和审核状态 |
| `background_jobs` | 异步任务队列，驱动耗时操作（克隆、执行、提交） |
| `projects` | GitLab 项目配置 |
| `llm_providers` | LLM 提供商（OpenAI / Anthropic / ACP） |
| `github_accounts` | GitHub 认证信息 |

### 任务状态流

```
Claimed → Downloading → Downloaded → PromptReady → ExecutionCompleted → Submitted
                                                                       → Error
```

---

## 重要术语

| 术语 | 含义 |
|------|------|
| Task | 一次完整的评审任务，对应一个 GitLab 项目的某次评审请求 |
| ModelRun | 单个 AI 模型对该任务的一次执行，一个 Task 可含多个 ModelRun |
| Prompt | 由 LLM 为特定模型生成的执行指令，决定模型的评审行为 |
| BackgroundJob | 异步任务单元，封装耗时操作，前端可轮询进度 |
| Provider | 对接的 LLM 服务商配置（API Key、Base URL、模型名） |
| CLI | 系统已安装的 AI 命令行工具（`claude` / `codex`），由 app/cli 封装调用 |
