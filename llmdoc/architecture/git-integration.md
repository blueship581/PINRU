# Git 集成架构

> 最后更新：2026-04-20（新增项目级 question_bank 工作流）

## 概述

PINRU 的 Git 集成分三个层次：
- `app/git/service.go` — 领题（Claim）阶段：从 GitLab 拉取项目、规划目录、触发克隆
- `app/submit/service.go` — 提交（Submit）阶段：推送源码到 GitHub、为每个模型副本创建 PR
- `internal/gitops/gitops.go` — 底层封装：所有 Git 命令的统一出口

---

## 一、领题完整流程

```
FetchGitLabProjects
    → 并发查询 GitLab API（最大并发 6）
    → 返回 []GitLabProjectLookupResult{ProjectRef, Project, Error}

PlanManagedClaimPaths
    → 扫描 basePath 已占用序号（collectManagedFolderGlobalSequenceSet）
    → 查询 store 中同项目已占序号（collectManagedTaskSequenceSet）
    → 合并去重，resolveManagedClaimSequences 找 count 个最小可用正整数
    → 每个序号生成：
        TaskPath   = BuildManagedTaskFolderPathWithSequence(basePath, projectName, taskType, seq)
        SourcePath = BuildManagedSourceFolderPathWithSequence(taskPath, projectID, taskType, seq)
    → 返回 []ManagedClaimPathPlan{Sequence, TaskPath, SourcePath}

git_clone Job（调用 CloneConfiguredProjectWithContext）
    → 读取 store 中配置的 gitlab_url / gitlab_token / gitlab_username
    → gitops.CloneWithProgress：git clone --depth 1 --progress <url> <SourcePath>._pinru_tmp
        → 克隆进度通过 onProgress 回调流式推送给前端
        → 成功后 os.Rename(stagingPath, SourcePath)（原子切换）
        → 任何失败均由 defer os.RemoveAll(stagingPath) 自动清理临时目录

CreateTask
    → 将 TaskPath / SourcePath 写入 store（task.LocalPath / modelRun.LocalPath）
```

---

## 二、目录规划策略（PlanManagedClaimPaths）

目标：同一 GitLab 项目在同一根目录下，不同任务类型和批次之间序号全局不冲突，且可复用已删除任务留下的空位。

**序号解析来源（优先级从高到低）：**
1. 磁盘扫描：`basePath` 下所有以 `<projectFolderPrefix>-` 开头的目录名，提取末尾数字，无数字后缀视为序号 1
2. store 查询：同 projectConfigID + projectID + taskType 的已存在任务，从 `task.LocalPath` 文件夹名解析序号

**目录名格式：**
- 任务目录：`<basePath>/<NormalizeProjectName>-<taskType>-<seq>`（seq=1 时后缀可省略）
- 源码目录：`<taskPath>/<label-NNNNN>-<taskType>-<seq>`（NNNNN 为 GitLab projectID，零填充 5 位）

补充：
- `PlanManagedClaimPaths` 同时服务 GitLab 领题和 question_bank 建题；序号规则完全一致。首套固定为 `claimSequence=1`，后续继续递增。实现见 `app/git/service.go`（`PlanManagedClaimPaths`）。
- 本地题库项虽然使用 synthetic `question_id` 写入 `tasks.gitlab_project_id`，但它只承担“单题唯一键”职责；任务目录与源码目录仍以 `claimSequence` 决定第几套。

---

## 三、项目级 question_bank

每个项目的唯一题库根目录固定为 `<cloneBasePath>/question_bank`。实现见 `app/git/question_bank.go`、`app/git/local_import.go`、`internal/util/path.go`。

固定子目录：
- `question_bank/archives/`：仅保存本地压缩包原件。
- `question_bank/sources/<question-id>/`：保存题目的唯一源码副本。

本地扫描：
- 入口是 `ScanLocalQuestionBank(projectID)`。
- 只扫描 `cloneBasePath` 顶层。
- 忽略隐藏目录、模型目录、受管任务目录、`question_bank` 自身、已被任务或题库占用的路径。
- 本地目录直接迁入 `question_bank/sources/<question-id>/`。
- 本地压缩包移动到 `question_bank/archives/`，再解压到 `question_bank/sources/<question-id>/`。
- 入库后补本地 `.git` 基线；扫描只更新题库项，不创建 `Task`。

GitLab 题库：
- 项目配置中的 `questionBankProjectIDs` 保存 GitLab 题目 ID 列表。
- `SyncGitLabQuestionBank(projectID, questionIDs?)` 首次把源码拉到 `question_bank/sources/<question-id>/`。
- 后续再次建题只复制本地题库源码，不重复远端拉取。
- `RefreshQuestionBankItem(projectID, questionID)` 仅允许刷新 `source_kind=gitlab` 的题库项。

从题库建题：
- 前端从项目概况的“项目题库”区块多选题目。
- 先调用 `PlanManagedClaimPaths` 规划 `claimSequence` / 目录。
- 再提交 `question_bank_materialize` job，把题库源码复制到本次任务的源码目录与模型目录。
- 最后调用 `CreateTask` 落库；协议仍沿用 `task.LocalPath` / `modelRun.LocalPath`。

---

## 四、Submit 完整流程

```
PublishSourceRepo（推源码到 GitHub main 分支）
    1. 验证参数、加载 task / sourceModelRun
    2. resolveGitHubCredentials：优先 store 中的 GitHubAccount，其次请求参数
    3. github.GetAuthenticatedUser → 获取 login / email
    4. github.EnsureRepository：若仓库不存在则创建，description 填 projectName
    5. gitops.WorkspacePath(targetRepo) → 临时目录 = <TempDir>/pinru-github-pr/<sanitized-repo>
    6. gitops.RecreateWorkspace：清空或新建临时目录，git init，配置 user，添加 remote origin
    7. gitops.CopyProjectContents：复制源码（排除 .git / node_modules / dist / .DS_Store / *.log）
    8. gitops.CommitAll：git add -A → 检测 staged 变更 → git commit -m "init: 原始项目初始化"
    9. gitops.EnsureBranch：确保 main 分支存在
   10. gitops.PushBranch：git push origin main:main --force（携带认证 Header）
   11. github.SetDefaultBranch：设置仓库默认分支为 main
    → 返回 {BranchName: "main", RepoURL}

SubmitModelRun（为单个模型副本创建 PR）
    1. 验证参数、加载 task / modelRun
    2. 检查 WorkspacePath 是否存在（未推源码则报错，须先执行 PublishSourceRepo）
    3. resolveGitHubCredentials
    4. branchName = modelName（原始字符串，即分支名与模型名相同）
    5. store.UpdateModelRun status=running，记录 startedAt
    6. gitops.CreateOrResetBranch：切回 main → 强制删除同名分支 → checkout -b <branchName> → 清空工作区内容
    7. gitops.CopyProjectContents：复制模型副本文件
    8. gitops.CommitAll：git commit -m "feat: <branchName> 模型实现"
    9. gitops.PushBranch：git push origin <branchName>:<branchName> --force
   10. github.EnsurePullRequest：查找已存在 PR（幂等）或创建新 PR，title/body = branchName
   11. store 写回 status=done，prURL，finishedAt
    → 返回 {BranchName, PrURL}
```

`SubmitAll` 是上述两步的组合封装，先执行源码推送，成功后批量串行执行每个 modelName 的 PR 创建，全部成功则 task.Status = "Submitted"，任一失败则 task.Status = "Error"。

---

## 五、GitOps 封装的 Git 命令

| 函数 | 实际命令 | 关键参数 |
|---|---|---|
| `CloneWithProgress` | `git clone --depth 1 --progress <url> <stagingPath>` → `os.Rename` | stderr 流式读取转 onProgress 回调；原子临时目录防残留 |
| `CopyProjectDirectory(ctx, src, dst)` | 流式文件复制 + `EnsureSnapshotRepository` | 先写到 `dst._pinru_tmp`，成功后 Rename；ctx 取消时 git 子进程被 kill |
| `RecreateWorkspace` | `git init` / `git config user.name/email` / `git remote add origin <url>` | 先删除旧工作区（路径安全校验） |
| `CommitAll` | `git add -A` / `git diff --cached --quiet`（检测） / `git commit -m <msg>` | 无变更时返回 committed=false |
| `CreateOrResetBranch` | `git checkout <base>` / `git branch -D <branch>` / `git checkout -b <branch>` | 清空工作区内容（保留 .git） |
| `EnsureBranch` / `ensureBranch` | `git rev-parse --verify <branch>` → `git checkout <branch>` 或 `git checkout -b <branch>` | 幂等 |
| `PushBranch` | `git push origin <branch>:<branch> --force` | 认证通过环境变量注入 |
| `EnsureSnapshotRepository(ctx, ref, path)` | `git init -b <branch>` / `git config user.name/email` / `git add -A` / `git commit --allow-empty -m "chore: 初始化模型副本基线"` | 接受 ctx；用 `exec.CommandContext` + `WaitDelay=5s` 执行，ctx 取消时 kill 子进程 |

---

## 六、Git 认证机制

所有网络 Git 操作（clone / push）均通过 `buildGitAuthEnv` 注入环境变量，**不修改全局 git config，不依赖 credential store**。

注入方式：

```
GIT_TERMINAL_PROMPT=0
GIT_CONFIG_COUNT=1
GIT_CONFIG_KEY_0=http.<scheme>://<host>/.extraHeader
GIT_CONFIG_VALUE_0=Authorization: Basic base64(<username>:<token>)
```

- GitLab：`gitlab_url` + `gitlab_token` + `gitlab_username`（默认 `oauth2`），来自 store config
- GitHub：`GitHubAccount.Token` / `GitHubAccount.Username`，来自 store 或请求参数，优先 store

---

## 七、工作区隔离（pinru-github-pr 临时目录）

Submit 阶段使用独立临时工作区，与用户本地源码目录完全隔离：

```
WorkspaceRoot() = os.TempDir()/pinru-github-pr/
WorkspacePath(targetRepo) = WorkspaceRoot()/<sanitized-targetRepo>
    sanitized：owner/repo 中非字母数字字符替换为 '-'
```

- `RecreateWorkspace` 每次提交前清空并重建，确保无历史残留
- `clearWorkspaceContents` 和 `removeManagedWorkspace` 均有路径安全校验：必须在 `WorkspaceRoot()` 下，且不等于根目录本身，否则拒绝操作

---

## 八、NormalizeManagedSourceFolders 快速描述

对某个 project 下的全部 task，检查并修复本地目录命名是否符合当前规则：

1. 从 task / sourceModelRun 推断当前 claimSequence
2. 计算期望的 taskPath（`desiredBasePath`）和期望的 sourcePath（`desiredPath`）
3. 若磁盘上旧路径存在且新路径不存在 → `os.Rename`（status=renamed）
4. 若新路径已存在但数据库记录旧路径 → 只回写 DB（status=updated）
5. 同步 task.LocalPath、所有 modelRun.LocalPath 到新路径
6. 对没有 .git 目录的模型副本目录补充调用 `EnsureSnapshotRepository`（本地快照）
7. 顺带读取 taskBasePath 下的 `prompt.txt`，若与 store 不一致则同步 task.PromptText

返回 `NormalizeManagedSourceFoldersResult`，含 renamed/updated/skipped/error 计数及逐任务明细。

---

## 九、原子临时目录（Atomic Staging）

`CloneWithProgress` 和 `CopyProjectDirectory` 均采用**先写临时目录、成功后 Rename** 的原子模式，消除了 clone/copy 失败后留下半成品目录的问题。

### 命名规则

```
stagingPath = <finalPath> + "._pinru_tmp"
```

### CloneWithProgress 流程

```
os.RemoveAll(stagingPath)          ← 清理上次崩溃遗留
defer os.RemoveAll(stagingPath)    ← 任何退出路径均清理

git clone ... <stagingPath>        ← git 只操作 staging 目录
    [失败] → defer 清理，finalPath 永远不存在
    [成功] → os.Rename(stagingPath, finalPath)
              defer 对不存在的 staging 为 no-op
```

### CopyProjectDirectory 流程

```
os.RemoveAll(stagingDst)           ← 清理上次崩溃遗留
defer os.RemoveAll(stagingDst)

copyDirRecursive(ctx, src, stagingDst)
initializeSnapshotRepository(ctx, src, stagingDst)
    [失败/ctx 取消] → defer 清理，finalDst 永远不存在
    [成功] → os.Rename(stagingDst, finalDst)
```

### 场景覆盖

| 场景 | finalPath 状态 | stagingPath 状态 |
|---|---|---|
| 成功 | 完整内容 | 不存在（Rename 后） |
| clone/copy 中途失败 | 不存在 | defer 清理 |
| ctx 取消（job timeout/用户取消） | 不存在 | defer 清理（git 进程由 `WaitDelay=5s` 终止） |
| 进程崩溃后重启 | 不存在 | 下次调用开头 `os.RemoveAll` 清理 |

---

## 十、Context 传播与超时控制

### clone 阶段

`CloneWithProgress` 使用 `exec.CommandContext(ctx, "git", "clone", ...)` + `WaitDelay=5s`。ctx 取消时 git 进程在 5s 内被 kill，stderr 管道由独立 goroutine 关闭以防阻塞。

额外的空闲超时（`gitCloneIdleTimeout = 30s`）在 `job/service.go` 中通过 `newGitCloneProgressContext` 包装：30s 内无 stderr 输出则取消 clone ctx，防止 git 进程静默挂起。

### copy 阶段

`CopyProjectDirectory(ctx, src, dst)` 将 ctx 一路传递到所有内部操作：

| 操作 | ctx 传播方式 |
|---|---|
| `copyDirRecursive` | 每个文件遍历前检查 `ctx.Err()`；使用流式 `io.Copy` 避免大文件全量读入内存 |
| `initializeSnapshotRepository` | 所有 git 命令均用 `runGitCtx(ctx, ...)` 执行 |
| `git add -A` / `git commit` | `exec.CommandContext(ctx, ...)` + `WaitDelay=5s`，ctx 取消时立即 kill |

**修复前的问题**：copy 阶段的 `git add -A` 使用裸 `exec.Command`（无 ctx），大仓库时可能运行数分钟无法中断，导致 job 超时后仍占用信号量槽位，阻塞批量拉取。

**修复后**：job 超时或取消时，`git add -A` 进程在 5s 内被 kill，信号量槽位随即释放。
