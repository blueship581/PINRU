# PinRu

> AI 模型代码评审工作站 — 从 GitLab 领取评审任务，借助 LLM 生成执行提示词，驱动多个 AI 模型对代码仓库执行评审，将产出推送到 GitHub 并自动创建 Pull Request。

[![Build](https://github.com/blueship581/PINRU/actions/workflows/build.yml/badge.svg)](https://github.com/blueship581/PINRU/actions/workflows/build.yml)
[![Go 1.25](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev/)
[![Wails v3](https://img.shields.io/badge/Wails-v3-FF3E00)](https://v3.wails.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [开发模式](#开发模式)
- [构建与部署](#构建与部署)
  - [macOS](#macos)
  - [Windows](#windows)
  - [Linux](#linux)
- [CI/CD](#cicd)
- [项目结构](#项目结构)
- [核心工作流](#核心工作流)
- [数据模型](#数据模型)
- [API 参考](#api-参考)

---

## 功能特性

- **任务看板** — 从 GitLab 领取评审项目，自动下载代码归档到本地
- **提示词生成** — 分析仓库结构，调用 LLM 生成面向各 AI 模型的执行提示词
- **多模型执行** — 在独立目录中调用 Claude Code、Codex 等 CLI 工具并发执行评审
- **AI 自动审核** — 评审完成后自动召回 LLM 对产出质量打分（pass / warning）
- **一键提交 PR** — 将源码与模型产出推送到 GitHub，自动创建带标签的 Pull Request
- **后台任务队列** — 所有耗时操作（克隆、执行、提交）均异步处理，前端实时轮询进度
- **多 LLM Provider** — 统一接口兼容 OpenAI Compatible API 与 Anthropic API

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面框架 | [Wails v3](https://v3.wails.io)（Go 后端 + WebView 前端） |
| 后端语言 | Go 1.25 |
| 数据库 | SQLite，纯 Go 驱动 `modernc.org/sqlite` |
| 前端框架 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand |
| Git 操作 | `os/exec` 调用系统 git CLI |
| AI 接入 | OpenAI Compatible API / Anthropic API |
| 平台 | macOS / Windows / Linux |

---

## 快速开始

### 前置依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| [Go](https://go.dev/dl/) | 1.23+ | 后端编译 |
| [Node.js](https://nodejs.org/) | 18+ | 前端构建 |
| [Wails v3 CLI](https://v3.wails.io/getting-started/installation/) | v3 alpha | 开发热重载 |
| [Task](https://taskfile.dev/) | 任意 | 可选，简化命令 |
| git | — | 仓库操作 |

```bash
# 1. 克隆仓库
git clone https://github.com/blueship581/PINRU.git
cd PINRU

# 2. 安装前端依赖
cd frontend && npm install && cd ..

# 3. 启动开发模式
wails3 dev
# 或
task dev
```

应用启动后在 `~/.pinru/pinru.db` 自动创建 SQLite 数据库。

---

## 开发模式

```bash
# 前后端热重载（推荐）
wails3 dev

# 重新生成 Wails 前端绑定（修改 Go 服务签名后执行）
wails3 generate bindings -d frontend/bindings
# 或
task generate

# 运行测试
go test ./...

# 单独运行前端（调试）
cd frontend && npm run dev
```

---

## 构建与部署

### macOS

**前置要求**

```bash
xcode-select --install   # Xcode Command Line Tools
```

**构建**

```bash
# 构建当前架构（arm64 / amd64）
task build
# 等效手动命令：
cd frontend && npm run build && cd ..
go build -o build/bin/pinru .

# 交叉编译（在 Apple Silicon 上构建 Intel 版本）
GOARCH=amd64 go build -o build/bin/pinru-amd64 .
```

**打包为 .app 并签名（本地分发）**

```bash
# 1. 配置 notarytool 凭据（首次执行）
xcrun notarytool store-credentials pinru-notary \
  --apple-id 'your-apple-id@example.com' \
  --team-id 'TEAMID' \
  --password 'app-specific-password'

# 2. 构建 + 打包 + 签名 + 公证
cd frontend && npm ci && npm run build && cd ..
go build -o build/bin/pinru .
export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
export APPLE_NOTARY_PROFILE='pinru-notary'
./scripts/package_macos_app.sh
```

打包产物位于 `dist/PINRU.app`。

> **未签名应急方案**（仅限本机测试，不可分发）
> ```bash
> xattr -dr com.apple.quarantine /path/to/PINRU.app
> ```

**macOS CI 所需 GitHub Secrets**

| Secret | 说明 |
|--------|------|
| `APPLE_CERTIFICATE_P12_BASE64` | Developer ID 证书（.p12）的 base64 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | 如 `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_NOTARY_APPLE_ID` | 用于公证的 Apple ID |
| `APPLE_NOTARY_APP_PASSWORD` | Apple ID 的 App-Specific Password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_KEYCHAIN_PASSWORD` | CI 临时 keychain 密码（可选） |

---

### Windows

**前置要求**

- Go 1.23+
- Node.js 18+
- Git
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（Windows 10 1803+ / Windows 11 已内置）

**构建**

```powershell
# 安装前端依赖
cd frontend && npm install && cd ..

# 构建
cd frontend && npm run build && cd ..
go build -o build\bin\pinru.exe .

# 运行
.\build\bin\pinru.exe
```

**从 macOS/Linux 交叉编译 Windows**

```bash
GOOS=windows GOARCH=amd64 go build -o build/bin/pinru.exe .
```

---

### Linux

**前置要求**

```bash
# Debian / Ubuntu
sudo apt install -y golang nodejs npm git
sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev

# Fedora / RHEL
sudo dnf install -y golang nodejs npm git
sudo dnf install -y gtk3-devel webkit2gtk4.1-devel

# Arch Linux
sudo pacman -S go nodejs npm git gtk3 webkit2gtk-4.1
```

**构建**

```bash
cd frontend && npm install && npm run build && cd ..
go build -o build/bin/pinru .
./build/bin/pinru
```

---

### 平台对照

| 平台 | WebView 引擎 | 最低系统版本 |
|------|-------------|------------|
| macOS | WKWebView | macOS 11 Big Sur |
| Windows | WebView2（Edge/Chromium） | Windows 10 1803 |
| Linux | WebKitGTK | — |

### 数据库路径

| 平台 | 路径 |
|------|------|
| macOS / Linux | `~/.pinru/pinru.db` |
| Windows | `%USERPROFILE%\.pinru\pinru.db` |

---

## CI/CD

仓库在 push 到 `main` 分支或创建 Release 时自动触发 GitHub Actions 构建。

- **macOS arm64** — 构建 + 打包 `.app`（签名与公证需配置 Secrets）
- **Windows amd64** — 构建 `.exe`
- 构建产物作为 Release Assets 上传

详见 [`.github/workflows/build.yml`](.github/workflows/build.yml)。

---

## 项目结构

```
PINRU/
├── main.go                      # Wails 入口 + 服务注册
├── app/                         # Go 服务层（8 个包）
│   ├── config/service.go        # 全局 KV 配置、项目/LLM/GitHub 账户 CRUD
│   ├── git/service.go           # GitLab 项目获取、仓库克隆、目录管理
│   ├── task/                    # 任务生命周期（状态流转、会话同步）
│   ├── prompt/                  # 提示词生成与持久化
│   ├── submit/service.go        # 源码发布、GitHub PR 创建
│   ├── chat/service.go          # 聊天会话管理
│   ├── cli/service.go           # Claude Code / Codex CLI 封装（os/exec）
│   ├── job/service.go           # 后台异步任务调度队列
│   └── testutil/                # 测试工具（内存 Store）
├── internal/                    # 纯内部库（不暴露给前端）
│   ├── store/                   # SQLite 数据层（migrations 自动迁移）
│   ├── gitlab/                  # GitLab API v4 客户端
│   ├── github/                  # GitHub API 客户端
│   ├── gitops/                  # git CLI 封装
│   ├── llm/                     # LLM Provider 统一抽象（OpenAI / Anthropic）
│   ├── analysis/                # 代码仓库结构分析
│   ├── prompt/                  # 提示词构建器
│   └── util/                    # 工具函数
├── migrations/
│   └── 001_init.sql             # 数据库 Schema
├── frontend/                    # React 前端
│   ├── src/
│   │   ├── features/            # 功能模块（board/claim/prompt/submit/settings）
│   │   ├── shared/              # 共享组件与 Hooks
│   │   ├── api/                 # Wails RPC 调用封装
│   │   └── store.ts             # Zustand 全局状态
│   ├── bindings/                # Wails 自动生成的 TS 类型绑定
│   └── vite.config.ts
├── build/
│   ├── darwin/                  # macOS Info.plist、entitlements
│   └── icons.icns
├── scripts/
│   ├── package_macos_app.sh     # macOS 打包 + 签名 + 公证脚本
│   └── ci-build.mjs             # CI 构建脚本
├── llmdoc/                      # 项目 LLM 文档（面向 AI 辅助开发）
├── Taskfile.yml                 # 构建任务快捷命令
├── go.mod
└── go.sum
```

---

## 核心工作流

```
领题 (Claim) → 生成提示词 (Prompt) → 执行 (Execute) → 提交 PR (Submit)
```

| 阶段 | 说明 |
|------|------|
| **领题** | 调用 GitLab API 获取可评审项目，下载代码归档到本地，为每个目标模型创建独立副本目录 |
| **生成提示词** | 分析仓库结构，调用 LLM 生成面向各 AI 模型的执行提示词，保存到数据库 |
| **执行** | 在各模型副本目录中调用 CLI（`claude` / `codex`），读取提示词执行评审；AI 自动审核产出质量（pass / warning） |
| **提交 PR** | 将源码与模型产出推送到 GitHub，通过 API 自动创建 Pull Request，记录 PR URL |

---

## 数据模型

### 任务状态流

```
Claimed → Downloading → Downloaded → PromptReady → ExecutionCompleted → Submitted
                                                                       ↘ Error
```

### ModelRun 状态

```
pending → running → done / error
```

AI 审核状态（`review_status`）：`none` → `running` → `pass` / `warning`

### 数据库表

| 表 | 说明 |
|----|------|
| `tasks` | 评审任务主表，记录状态与本地路径 |
| `model_runs` | 单模型执行记录，含 PR URL 与审核状态 |
| `background_jobs` | 后台异步任务队列 |
| `projects` | GitLab 项目配置（URL、模型列表等） |
| `llm_providers` | LLM 提供商（API Key、Base URL、模型名） |
| `github_accounts` | GitHub 认证信息 |
| `configs` | 全局 KV 配置 |

---

## API 参考

所有服务通过 Wails v3 绑定暴露给前端：

```typescript
import { Call } from '@wailsio/runtime';
Call.ByName('main.ServiceName.MethodName', ...args);
```

### ConfigService

| 方法 | 说明 |
|------|------|
| `GetConfig(key)` | 读取 KV 配置 |
| `SetConfig(key, value)` | 写入 KV 配置 |
| `TestGitLabConnection(url, token)` | 测试 GitLab 连接 |
| `TestGitHubConnection(username, token)` | 测试 GitHub 连接 |
| `ListProjects` `CreateProject` `UpdateProject` `DeleteProject` | 项目配置 CRUD |
| `ListLLMProviders` `CreateLLMProvider` `UpdateLLMProvider` `DeleteLLMProvider` | LLM Provider CRUD |
| `ListGitHubAccounts` `CreateGitHubAccount` `UpdateGitHubAccount` `DeleteGitHubAccount` | GitHub 账号 CRUD |

### TaskService

| 方法 | 说明 |
|------|------|
| `ListTasks(projectConfigID?)` | 列出任务（可按项目过滤） |
| `GetTask(id)` | 获取单个任务 |
| `CreateTask(req)` | 创建任务 + ModelRun 记录 |
| `UpdateTaskStatus(id, status)` | 更新任务状态 |
| `ListModelRuns(taskID)` | 列出任务的模型执行记录 |
| `UpdateModelRun(req)` | 更新模型运行状态 |
| `DeleteTask(id)` | 删除任务（含本地文件清理） |

### GitService

| 方法 | 说明 |
|------|------|
| `FetchGitLabProject(projectRef, url, token)` | 获取单个 GitLab 项目信息 |
| `FetchGitLabProjects(refs[], url, token)` | 批量获取（并发，最大 6） |
| `CloneProject(cloneURL, path, username, token)` | 克隆项目（发送 `clone-progress` 事件） |
| `DownloadGitLabProject(projectID, url, token, dest, sha?)` | 下载 GitLab 代码归档 |
| `CopyProjectDirectory(src, dest)` | 复制项目目录 |
| `CheckPathsExist(paths[])` | 检查路径是否存在 |

### PromptService

| 方法 | 说明 |
|------|------|
| `TestLLMProvider(config)` | 测试 LLM 连接 |
| `GenerateTaskPrompt(req)` | 分析代码 + LLM 生成提示词 |
| `SaveTaskPrompt(taskID, text)` | 手动保存提示词 |

### SubmitService

| 方法 | 说明 |
|------|------|
| `PublishSourceRepo(req)` | 上传源码到 GitHub 默认分支 |
| `SubmitModelRun(req)` | 创建模型分支 + GitHub PR |

### JobService

| 方法 | 说明 |
|------|------|
| `ListJobs(taskID?)` | 列出后台任务（可按 task 过滤） |
| `CancelJob(id)` | 取消待执行的后台任务 |

---

## 贡献指南

详见 [llmdoc/reference/coding-conventions.md](llmdoc/reference/coding-conventions.md) 与 [llmdoc/reference/git-conventions.md](llmdoc/reference/git-conventions.md)。

```bash
# 运行测试
go test ./...

# 检查 lint
golangci-lint run

# 前端类型检查
cd frontend && npm run type-check
```

---

## License

[MIT](LICENSE)
