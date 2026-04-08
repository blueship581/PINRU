# PinRu

AI 模型代码评审工作站。从 GitLab 领取评审任务，使用大语言模型生成执行提示词，将模型产出提交至 GitHub 并创建 Pull Request。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | [Wails v3](https://v3.wails.io) (Go + WebView) |
| 后端 | Go 1.25 |
| 数据库 | SQLite (modernc.org/sqlite, 纯 Go) |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand |
| Git 操作 | `os/exec` 调用 git CLI |
| LLM | OpenAI Compatible / Anthropic API |

## 快速开始

### 前置依赖

- Go 1.23+
- Node.js 18+
- [Wails v3 CLI](https://v3.wails.io/getting-started/installation/)
- [Task](https://taskfile.dev/) (可选)
- git

### 开发模式

```bash
# 安装前端依赖
cd frontend && npm install && cd ..

# 启动开发模式 (前后端热重载)
wails3 dev
# 或使用 Taskfile
task dev
```

### 构建生产版本

```bash
# 前端构建 + Go 编译
cd frontend && npm run build && cd ..
go build -o build/bin/pinru .

# 或使用 Taskfile
task build
```

生成的二进制文件位于 `build/bin/pinru`，启动后在 `~/.pinru/pinru.db` 创建 SQLite 数据库。

### 跨平台构建

PinRu 基于 Wails v3，支持 macOS、Windows、Linux 三个平台。

#### macOS

```bash
# 前置: Xcode Command Line Tools
xcode-select --install

# 构建当前架构 (arm64 或 amd64)
task build
# 或手动
cd frontend && npm run build && cd ..
go build -o build/bin/pinru .

# 交叉编译 Intel Mac
GOARCH=amd64 go build -o build/bin/pinru-amd64 .

# 运行
./build/bin/pinru
```

macOS 特性: 关闭最后一个窗口时自动退出应用。

#### Windows

```powershell
# 前置: Go 1.23+, Node.js 18+, Git, WebView2 Runtime (Win10 1803+ 已内置)

# 安装前端依赖
cd frontend && npm install && cd ..

# 构建
cd frontend && npm run build && cd ..
go build -o build\bin\pinru.exe .

# 运行
.\build\bin\pinru.exe
```

在 macOS/Linux 上交叉编译 Windows:

```bash
GOOS=windows GOARCH=amd64 go build -o build/bin/pinru.exe .
```

> Windows 需要安装 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。Windows 10 (1803+) 和 Windows 11 通常已预装。

#### Linux

```bash
# 前置 (Debian/Ubuntu)
sudo apt install -y golang nodejs npm git
sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev

# 前置 (Fedora/RHEL)
sudo dnf install -y golang nodejs npm git
sudo dnf install -y gtk3-devel webkit2gtk4.1-devel

# 前置 (Arch)
sudo pacman -S go nodejs npm git gtk3 webkit2gtk-4.1

# 构建
cd frontend && npm install && npm run build && cd ..
go build -o build/bin/pinru .

# 运行
./build/bin/pinru
```

#### 平台对照表

| 平台 | WebView 引擎 | 系统依赖 | 最低版本 |
|------|-------------|---------|---------|
| macOS | WKWebView | Xcode CLT | macOS 11 (Big Sur) |
| Windows | WebView2 (Edge/Chromium) | WebView2 Runtime | Windows 10 1803 |
| Linux | WebKitGTK | `libgtk-3`, `libwebkit2gtk-4.1` | — |

#### 数据存储位置

| 平台 | 数据库路径 |
|------|-----------|
| macOS | `~/.pinru/pinru.db` |
| Linux | `~/.pinru/pinru.db` |
| Windows | `%USERPROFILE%\.pinru\pinru.db` |

## 项目结构

```
pinru/
├── main.go                    # Wails 入口 + 服务注册
├── config_service.go          # 配置服务 (Wails bound)
├── task_service.go            # 任务服务 (Wails bound)
├── git_service.go             # Git 服务 (Wails bound)
├── prompt_service.go          # 提示词服务 (Wails bound)
├── submit_service.go          # 提交服务 (Wails bound)
├── internal/
│   ├── store/                 # SQLite 数据层
│   ├── gitlab/                # GitLab API v4 客户端
│   ├── github/                # GitHub API 客户端
│   ├── gitops/                # Git CLI 封装
│   ├── llm/                   # LLM Provider (OpenAI / Anthropic)
│   ├── analysis/              # 代码仓库分析
│   ├── prompt/                # 提示词构建
│   └── util/                  # 工具函数
├── migrations/
│   └── 001_init.sql           # 数据库 schema
├── frontend/                  # React 前端
│   ├── src/
│   │   ├── services/          # Wails 服务调用层
│   │   ├── pages/             # 页面 (Board, Claim, Prompt, Submit, Settings)
│   │   ├── components/        # 组件 (Layout)
│   │   └── store.ts           # Zustand 状态管理
│   ├── package.json
│   └── vite.config.ts
├── Taskfile.yml               # 构建任务
├── go.mod
└── go.sum
```

## 工作流程

```
领题 (Claim) → 生成提示词 (Prompt) → 提交 PR (Submit)
```

1. **领题**: 从 GitLab 获取项目，下载代码归档到本地
2. **提示词**: 分析代码仓库，使用 LLM 生成模型执行提示词
3. **提交**: 将源码和模型产出推送到 GitHub，自动创建 Pull Request

## API 列表

所有 API 通过 Wails v3 绑定暴露给前端，前端调用方式：

```typescript
import { Call } from '@wailsio/runtime';
Call.ByName('main.ServiceName.MethodName', ...args);
```

### ConfigService — 配置管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `GetConfig` | `key` | `string` | 获取配置值 |
| `SetConfig` | `key, value` | — | 设置配置值 |
| `TestGitLabConnection` | `url, token` | `bool` | 测试 GitLab 连接 |
| `TestGitHubConnection` | `username, token` | `bool` | 测试 GitHub 连接 |
| `ListProjects` | — | `[]Project` | 列出所有项目配置 |
| `CreateProject` | `Project` | — | 创建项目 |
| `UpdateProject` | `Project` | — | 更新项目 |
| `DeleteProject` | `id` | — | 删除项目 |
| `ListLLMProviders` | — | `[]LLMProvider` | 列出 LLM 提供商 |
| `CreateLLMProvider` | `LLMProvider` | — | 创建 LLM 提供商 |
| `UpdateLLMProvider` | `LLMProvider` | — | 更新 LLM 提供商 |
| `DeleteLLMProvider` | `id` | — | 删除 LLM 提供商 |
| `ListGitHubAccounts` | — | `[]GitHubAccount` | 列出 GitHub 账号 |
| `CreateGitHubAccount` | `GitHubAccount` | — | 创建 GitHub 账号 |
| `UpdateGitHubAccount` | `GitHubAccount` | — | 更新 GitHub 账号 |
| `DeleteGitHubAccount` | `id` | — | 删除 GitHub 账号 |

### TaskService — 任务管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `ListTasks` | `projectConfigID?` | `[]Task` | 列出任务 (可按项目过滤) |
| `GetTask` | `id` | `Task` | 获取单个任务 |
| `CreateTask` | `CreateTaskRequest` | `Task` | 创建任务 + 模型运行记录 |
| `UpdateTaskStatus` | `id, status` | — | 更新任务状态 |
| `ListModelRuns` | `taskID` | `[]ModelRun` | 列出任务的模型运行 |
| `UpdateModelRun` | `UpdateModelRunRequest` | — | 更新模型运行状态 |
| `DeleteTask` | `id` | — | 删除任务 (含本地文件清理) |

### GitService — Git 操作

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `FetchGitLabProject` | `projectRef, url, token` | `Project` | 获取 GitLab 项目信息 |
| `FetchGitLabProjects` | `projectRefs[], url, token` | `[]Result` | 批量获取 (并发, 最大 6) |
| `CloneProject` | `cloneURL, path, username, token` | — | 克隆项目 (发送 `clone-progress` 事件) |
| `DownloadGitLabProject` | `projectID, url, token, dest, sha?` | — | 下载 GitLab 归档 |
| `CopyProjectDirectory` | `sourcePath, destPath` | — | 复制项目目录 |
| `CheckPathsExist` | `paths[]` | `[]string` | 检查路径是否存在 |

### PromptService — 提示词

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `TestLLMProvider` | `Config` | `bool` | 测试 LLM 连接 |
| `GenerateTaskPrompt` | `GeneratePromptRequest` | `PromptGenerationResult` | 分析代码 + LLM 生成提示词 |
| `SaveTaskPrompt` | `taskID, promptText` | — | 手动保存提示词 |

### SubmitService — 提交

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `PublishSourceRepo` | `PublishSourceRepoRequest` | `PublishSourceRepoResult` | 上传源码到 GitHub 默认分支 |
| `SubmitModelRun` | `SubmitModelRunRequest` | `SubmitModelRunResult` | 创建模型分支 + PR |

## 数据模型

### 任务状态流转

```
Claimed → Downloading → Downloaded → PromptReady → Submitted → Error
```

### 模型运行状态

```
pending → running → done / error
```

### 数据库表

| 表 | 说明 |
|---|---|
| `configs` | 全局 KV 配置 |
| `projects` | 项目配置 (GitLab URL, 模型列表等) |
| `llm_providers` | LLM API 提供商 (OpenAI / Anthropic) |
| `github_accounts` | GitHub 认证信息 |
| `tasks` | 评审任务记录 |
| `model_runs` | 模型执行记录 (属于 task) |
