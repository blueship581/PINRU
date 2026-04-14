# Session 卡片内联控制

> TaskDetailDrawer Session 卡片的任务类型和扣任务数内联操作

## 设计理念

将高频操作（任务类型切换、扣任务数开关）直接内嵌到卡片中，减少用户在卡片和详情页之间切换的次数。

**注意**：SessionID 编辑功能保留在详情页，卡片上不显示。

## 实现模式

### 卡片内联控制区

任务类型下拉 + 扣任务数开关，带 ? 提示图标。

```tsx
{/* 任务类型 + 扣任务数开关 */}
<div className="mt-2.5 flex items-center gap-2">
  {/* 任务类型下拉 */}
  <div className="group relative min-w-0 flex-1">
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        const select = e.currentTarget.nextElementSibling as HTMLSelectElement;
        select?.focus();
        select?.click();
      }}
      className="absolute left-0 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-zinc-600 opacity-0 transition group-hover:opacity-100"
      title="点击查看任务类型说明"
    >
      <span className="flex h-full items-center justify-center text-[10px] font-medium">?</span>
    </button>
    <select
      value={session.taskType}
      disabled={taskTypeChanging}
      onChange={(e) => {
        e.stopPropagation();
        onSessionChange(session.localId, { taskType: e.target.value });
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-full appearance-none rounded-lg border border-zinc-700/70 bg-zinc-900/80 py-1.5 pl-2 pr-6 text-[10px] font-medium text-zinc-300 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 disabled:opacity-60"
    >
      {sessionTaskTypeOptions.map((taskType) => {
        const optPresentation = getTaskTypePresentation(taskType);
        return (
          <option key={optPresentation.value} value={optPresentation.value}>
            {optPresentation.label}
          </option>
        );
      })}
    </select>
    <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
  </div>

  {/* 扣任务数开关 */}
  <div className="group relative shrink-0">
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
      }}
      className="absolute -left-5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-zinc-600 opacity-0 transition group-hover:opacity-100"
      title="点击查看扣任务数说明"
    >
      <span className="flex h-full items-center justify-center text-[10px] font-medium">?</span>
    </button>
    <button
      type="button"
      disabled={index === 0}
      onClick={(e) => {
        e.stopPropagation();
        if (index > 0) {
          onSessionChange(session.localId, { consumeQuota: !session.consumeQuota });
        }
      }}
      className={clsx(
        'flex h-6 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-medium transition',
        index === 0
          ? 'cursor-default border-indigo-500/30 bg-indigo-500/10 text-indigo-400 opacity-70'
          : session.consumeQuota
            ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
            : 'border-zinc-700/70 bg-zinc-900/80 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400',
      )}
    >
      <div className={clsx('h-2 w-2 rounded-full', session.consumeQuota || index === 0 ? 'bg-current' : 'bg-zinc-600')} />
      {index === 0 ? '固定' : session.consumeQuota ? '计数' : '不计'}
    </button>
  </div>
</div>
```

## 关键实践

### 长文本换行
SessionID 可能很长，必须添加 `break-all` 或 `break-words` 处理换行：
```tsx
// 卡片内：break-all（强制断词）
<span className="... break-all">
// 详情页：break-words（优先在词边界断开）
<div className="... break-words">
```

### 首轮固定规则
第一轮（index === 0）的任务类型和扣任务数都不可修改：
```tsx
<select disabled={taskTypeChanging || index === 0}
  className={clsx(
    '...',
    index === 0
      ? 'cursor-default border-indigo-500/30 bg-indigo-500/10 text-indigo-400 opacity-70'
      : '...',
  )}
/>
```

### 事件冒泡控制
内联元素（如 select、button）必须使用 `e.stopPropagation()` 防止触发外层卡片的点击事件（如选择卡片）。

### 编辑状态管理
- 用 `string | null` 而非 boolean，支持多个卡片独立编辑状态
- 复制反馈用 `setTimeout` 2秒后自动清除，无需手动重置

### 样式一致性
- 编辑态：`border-indigo-500/40` + `focus:ring-1 focus:ring-indigo-500/40`
- 复制图标：`hover:bg-zinc-800 hover:text-zinc-300`
- 禁用态：`disabled:opacity-60`
- 首轮固定态：`cursor-default border-indigo-500/30 bg-indigo-500/10 text-indigo-400 opacity-70`

### TypeScript 验证
使用 `npx tsc --noEmit` 检查类型，确保改动无误后再提交。

## 相关文件

- `frontend/src/shared/components/TaskDetailDrawer.tsx` - Session 卡片主组件
- `frontend/src/shared/lib/sessionUtils.ts` - Session 相关工具函数
