# PINRU 编码规范

> 面向 LLM 的约束速查。仅记录项目特有规则，通用最佳实践不重复。

---

## 目录结构

```
app/          # Wails 绑定层（按服务划分子包，如 app/task、app/git）
internal/     # 业务内部实现（store、util 等，不对外暴露）
frontend/src/
  api/        # 所有 Wails/HTTP 调用封装，每个服务一个文件
  features/   # 功能模块（board、claim、prompt、settings、submit）
  shared/     # 跨功能组件（components/、lib/）
  store.ts    # 全局 Zustand store
```

- `app/` 下每个包只暴露一个 `*Service` struct，通过 `New(...)` 构造。
- `internal/` 内部包不得被 `app/` 以外的层直接引用。
- 前端新功能放 `features/<name>/`，通用工具放 `shared/lib/`，通用 UI 放 `shared/components/`。

---

## Go 编码规范

**模块**：`github.com/blueship581/pinru`，Go 1.25。

**命名**
- Service struct 统一命名为 `<Domain>Service`，如 `TaskService`、`GitService`。
- 构造函数统一为 `New(...) *<Domain>Service`（不用 `NewXxxService`）。
- Request/Response struct 以 `Request` / `Result` 结尾，字段用 camelCase JSON tag。
- 包名与目录名一致，单词；如 `package task`。

**方法签名**（Wails 绑定方法）
- 返回值固定为 `(T, error)` 或 `error`，不要裸 panic。
- 方法名用 PascalCase，对应前端调用时的 `MethodName`。
- 每个导出方法顶部写一行注释 `// MethodName does ...`。

**错误处理**
- 直接 `return nil, err` 向上传递，禁止吞掉 error。
- 需要附加上下文时用 `fmt.Errorf("context: %w", err)`。

**JSON Tag**
- Go struct 字段与前端 interface 字段保持一一对应（Go PascalCase → JSON camelCase）。
- 可空字段用指针类型 `*string`，JSON tag 加 `omitempty` 视情况添加。

---

## TypeScript / React 规范

**编译目标**：ES2022，`moduleResolution: bundler`，路径别名 `@/*` 指向 `frontend/`。

**类型**
- 与 Go struct 对应的前端类型放在各自的 `api/*.ts` 文件中，不在 store 中重复定义。
- 从 `api/` 文件 re-export 时用 `export type { Foo }`。
- 联合类型字面量优先，如 `'idle' | 'running' | 'done' | 'error'`，不用 enum。
- 可空字段用 `T | null`（对应 Go 指针），可选字段用 `field?: T`。

**组件**
- 函数组件，无 class component。
- Props 类型用 `interface`，命名为 `<Component>Props`。
- 组件文件与组件名一致，PascalCase，`.tsx` 后缀。
- 纯逻辑（无 JSX）放 `.ts` 文件。

**状态管理**
- 全局状态用 `store.ts` 中的 Zustand store。
- 局部/功能状态用 `useState` / `useReducer`，或在 `features/<name>/` 内创建独立 store。
- 禁止在组件内直接调用 `callService`，须通过 `api/*.ts` 的封装函数。

---

## Wails 绑定规范

**调用方式**（前端）
```ts
// 不直接使用 Call.ByName，统一通过 callService 包装
import { callService } from '@/api/wails';
callService('TaskService', 'ListTasks', projectConfigId ?? null);
```

**服务注册**
- 每个新服务必须在 `frontend/src/api/wails.ts` 的 `servicePrefixes` 中添加条目：
  ```ts
  FooService: ['github.com/blueship581/pinru/app/foo', 'main'],
  ```
- 同时在 `frontend/src/api/contracts.ts` 的 `WailsServiceContract` 中声明类型签名。

**参数传递**
- Go 方法参数顺序与前端 `callService(...args)` 顺序严格一致。
- Go 返回 `nil` 时前端收到 `null`；返回 `error` 时 `callService` 抛出 `Error`。
- 单个请求对象优于多个散参数（超过 2 个参数时统一用 Request struct）。

**新增 API 流程**
1. `app/<domain>/service.go` 添加 Go 方法（PascalCase）。
2. `frontend/src/api/<domain>.ts` 添加对应 TS 函数和类型。
3. `frontend/src/api/contracts.ts` 更新 `WailsServiceContract`。

---

## 测试规范

- **前端**：vitest，测试文件与源文件同目录，命名 `<name>.test.ts(x)`。
- **后端**：Go testing 标准库，文件命名 `<name>_test.go`，包名与被测包相同。
- 测试只覆盖纯函数和关键业务逻辑，UI 快照测试不强制。
- Windows helper-process 测试若会取消外部命令或制造悬挂子进程，不要直接复用当前 `*.test.exe` 作为被调二进制；应先复制出独立 helper 可执行文件，再由 `.bat` 包装器调用，避免 `go test` 清理临时测试二进制时出现 `Access is denied`。当前实现见 `app/job/service_test.go`（`copyTestExecutable`、`createMockGitCloneFailureExecutable`、`createMockGitCloneHangingExecutable`）。
- GitHub Actions 构建链路默认按 Node 24 维护；升级 CI action 时保持与 `.github/workflows/build.yml` 一致：`actions/checkout@v5`、`actions/setup-go@v6`、`actions/setup-node@v5`、`actions/upload-artifact@v6`，并保留 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`。
