# 操作指南：如何提交模型 PR

本文描述从源码上传到 PR 创建的完整操作参数与注意事项。

---

## 一、PublishSourceRepo 参数

接口：`SubmitService.PublishSourceRepo(req PublishSourceRepoRequest)`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | string | 是 | 任务 ID，用于查询 task 和 sourceModelRun |
| `modelName` | string | 是 | 源码模型名称（通常为 `ORIGIN` 或项目配置的 `SourceModelFolder`） |
| `targetRepo` | string | 是 | GitHub 仓库，格式必须为 `owner/repo`，不能有多余斜杠 |
| `githubAccountId` | string | 否 | store 中已存储的 GitHubAccount ID；填写后 username/token 可省略 |
| `githubUsername` | string | 条件必填 | `githubAccountId` 为空时必填 |
| `githubToken` | string | 条件必填 | `githubAccountId` 为空时必填；需有 repo 写权限 |

**前置条件：**
- `modelRun.LocalPath` 必须已设置，即本地源码目录存在
- `targetRepo` 对应的 GitHub 仓库若不存在会自动创建（description 填任务项目名）

**执行效果：**
- 将源码文件复制到临时工作区 `<TempDir>/pinru-github-pr/<sanitized-repo>/`
- 排除 `.git`、`node_modules`、`dist`、`dist-ssr`、`.DS_Store`、`*.log`
- 以 commit message `init: 原始项目初始化` 提交并强制推送到 `main` 分支
- 设置仓库默认分支为 `main`
- 返回 `{branchName: "main", repoUrl: "https://github.com/owner/repo"}`

---

## 二、SubmitModelRun 参数

接口：`SubmitService.SubmitModelRun(req SubmitModelRunRequest)`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | string | 是 | 任务 ID |
| `modelName` | string | 是 | 模型副本名称；**同时作为 GitHub 分支名和 PR 标题** |
| `targetRepo` | string | 是 | 与 PublishSourceRepo 相同的 `owner/repo` |
| `githubAccountId` | string | 否 | 同上 |
| `githubUsername` | string | 条件必填 | 同上 |
| `githubToken` | string | 条件必填 | 同上 |

**前置条件：**
- 必须已成功执行 `PublishSourceRepo`，即临时工作区目录 `WorkspacePath(targetRepo)` 存在
- 若工作区不存在，返回错误：`源码尚未上传，请先执行源码上传步骤后再创建模型 PR`
- `modelRun.LocalPath` 必须已设置

**执行效果：**
- 在工作区内创建或重置同名分支（强制覆盖已有同名分支）
- 复制模型副本文件到工作区
- commit message：`feat: <modelName> 模型实现`
- 强制推送分支，调用 `EnsurePullRequest` 创建或复用已有 PR
- 返回 `{branchName: "<modelName>", prUrl: "https://github.com/..."}`

---

## 三、GitHub 分支命名规则

分支名直接取自 `modelName` 字段原始字符串（`strings.TrimSpace` 后），无额外转义。

- PR head branch：`<modelName>`
- PR base branch：`main`
- PR title：`<modelName>`（与分支同名）
- commit message：`feat: <modelName> 模型实现`

因此 `modelName` 应避免 Git 分支名非法字符（空格、`..`、`~^:?*[` 等），建议使用字母、数字、短横线组合。

---

## 四、重复提交处理（EnsurePullRequest 幂等性）

`github.EnsurePullRequest` 在创建 PR 前先查询仓库内是否存在 head=`<modelName>`、base=`main`、状态为 open 的 PR：
- 若已存在：直接返回已有 PR 的 URL，不重复创建
- 若不存在：调用 GitHub API 创建新 PR

`PushBranch` 使用 `--force` 推送，因此重新提交同一模型时，远程分支内容会被完整覆盖，PR 自动更新 diff，无需手动关闭再开。

---

## 五、常见错误

### 无改动（与 main 无差异）

**错误信息：**
- `PublishSourceRepo`：`源码目录没有可提交的文件`
- `SubmitModelRun`：`模型 <name> 与源码 main 无差异，无法创建 PR`

**原因：** `CommitAll` 在 `git diff --cached --quiet` 退出码为 0 时（无 staged 变更）返回 `committed=false`。

**处理：** 检查模型副本目录内容是否确实与源码存在差异；若确认有修改，检查文件是否被排除规则过滤（`node_modules`、`dist`、`*.log` 等）。

---

### 认证失败

**错误信息：** `GitHub 认证失败: <upstream error>` 或 `Git 推送失败: <exit status 128>`

**原因：**
- `githubToken` 无效或权限不足（需要 `repo` scope）
- `githubAccountId` 对应 store 记录不存在
- 推送时 `GIT_CONFIG_KEY_0` 认证 Header 构造失败（URL 解析异常）

**处理：**
- 验证 token 权限：需要 `repo`（包含写权限）
- 若使用 `githubAccountId`，确认 store 中该账号记录存在且 token/username 非空
- 确认 `targetRepo` 格式正确（`owner/repo`，不含 `https://github.com/` 前缀）

---

### HTTP 422（PR 创建失败）

**错误信息：** `GitHub PR 创建失败: 422 Unprocessable Entity`

**常见原因：**
1. head 分支与 base 分支（main）内容完全相同，GitHub 拒绝创建无 diff 的 PR
2. 目标仓库不存在对应 base 分支（`main` 尚未初始化）

**处理：**
- 原因 1：确认模型副本与源码存在实质性差异
- 原因 2：确认已先执行 `PublishSourceRepo` 推送了 `main` 分支

---

### 工作区路径冲突

**错误信息：** `拒绝清理受管范围外的工作目录` 或 `拒绝删除受管范围外的工作目录`

**原因：** `WorkspacePath` 计算结果逃逸出 `<TempDir>/pinru-github-pr/` 范围，系统拒绝操作以防止误删文件。这属于防御性检查，正常使用不应触发。

---

## 附：SubmitAll 快速参考

`SubmitAll` 一次性完成源码上传 + 全部模型 PR 创建，参数结构 `SubmitAllRequest`：

| 字段 | 说明 |
|---|---|
| `taskId` | 任务 ID |
| `sourceModelName` | 源码模型名，为空时默认 `ORIGIN` |
| `models` | 要创建 PR 的模型名列表（排除 ORIGIN 和 sourceModelName） |
| `targetRepo` | `owner/repo` |
| `githubAccountId` | 可选，优先于 username/token |
| `githubUsername` | 条件必填 |
| `githubToken` | 条件必填 |

源码推送失败时立即中止，不进行后续模型 PR 创建。各模型 PR 串行执行，单个失败不影响其余模型，但最终 task.Status 会被置为 `Error`。
