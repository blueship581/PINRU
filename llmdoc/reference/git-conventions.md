# Git 规范

## 分支策略

- 主分支：`main`，保持可发布状态
- 功能分支：`feat/<name>`，开发完成后合并回 `main`（如历史中的 `feat/ai-review`）
- 合并方式：Merge commit（保留分支历史），必要时允许 Revert

## 提交格式

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>
```

- `scope` 可选，小写，标识影响模块（如 `codex`、`test`）
- `subject` 以英文为主；内部辅助操作（如基线初始化）允许中文
- 不加句号结尾

## 提交类型

| 类型       | 用途                               |
|------------|------------------------------------|
| `feat`     | 新功能                             |
| `fix`      | 缺陷修复                           |
| `refactor` | 重构，不改变外部行为               |
| `test`     | 测试相关                           |
| `ci`       | CI/CD 配置变更                     |
| `chore`    | 内部维护、基线初始化等杂项操作     |
| `revert`   | 回滚某次提交                       |

## 示例

```
feat: add AI review feature with CodeX CLI pg-code skill integration
fix(test): replace timeout.exe with ping in Windows git mock
refactor(codex): relax evidence guards from hard to soft
chore: 初始化模型副本基线
```

## 注意事项

- Windows CI 兼容性问题用 `fix(test):` 标注，不归入 `feat`
- Revert 操作直接用 `Revert "<原始提交标题>"` 格式（Git 自动生成）
- 合并 PR 前确保分支与 `main` 无冲突
