import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  MessageSquarePlus,
  Plus,
  Settings2,
  Sparkles,
  Terminal,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { ExecMode, ThinkingDepth } from '../../../api/cli';
import type { ChatSession } from '../../../api/chat';
import type { PromptGenerationStatus } from '../../../api/task';
import type { Task } from '../../../store';
import { formatWorkspaceOptionLabel } from '../utils/promptUtils';
import type { TaskWorkspaceOption } from '../types';
import { SessionItem } from './PromptPrimitives';

type PromptGenerationMeta = {
  label: string;
  badgeCls: string;
  panelCls: string;
};

type PromptTaskTypeOption = {
  value: string;
  label: string;
  desc: string;
};

import type { ConstraintOption, ScopeOption } from '../../../shared/lib/promptConstants';

// ── PromptSidebar ─────────────────────────────────────────────────────────────

export function PromptSidebar({
  selectedTask,
  selectedTaskId,
  tasks,
  showTaskPicker,
  sessions,
  activeSessionId,
  renamingId,
  renameValue,
  onToggleTaskPicker,
  onSelectTask,
  onNewSession,
  onSelectSession,
  onRenameStart,
  onRenameValueChange,
  onRenameCommit,
  onDeleteSession,
  onOpenSettings,
}: {
  selectedTask: Task | null;
  selectedTaskId: string;
  tasks: Task[];
  showTaskPicker: boolean;
  sessions: ChatSession[];
  activeSessionId: string | null;
  renamingId: string | null;
  renameValue: string;
  onToggleTaskPicker: () => void;
  onSelectTask: (taskId: string) => void;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameStart: (session: ChatSession) => void;
  onRenameValueChange: (value: string) => void;
  onRenameCommit: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="w-[200px] flex-shrink-0 flex flex-col border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
      <div className="flex-shrink-0 p-3 border-b border-stone-100 dark:border-stone-800">
        <button
          onClick={onToggleTaskPicker}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors cursor-default"
        >
          <Terminal className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
          <span className="flex-1 text-left text-xs font-medium text-stone-600 dark:text-stone-300 truncate">
            {selectedTask?.id ?? '选择任务'}
          </span>
          <ChevronDown className="w-3 h-3 text-stone-400 flex-shrink-0" />
        </button>

        {showTaskPicker && (
          <div className="mt-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-lg overflow-hidden">
            {tasks.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-stone-400">暂无可用任务</p>
            ) : (
              tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  className={`w-full text-left px-3 py-2 text-xs cursor-default transition-colors ${
                    task.id === selectedTaskId
                      ? 'bg-stone-100 dark:bg-stone-700 text-stone-800 dark:text-stone-200 font-medium'
                      : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="block truncate">{task.id}</span>
                    {task.promptGenerationStatus === 'running' && (
                      <span className="flex-shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                        生成中
                      </span>
                    )}
                    {task.promptGenerationStatus === 'error' && (
                      <span className="flex-shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        失败
                      </span>
                    )}
                  </div>
                  <span className="block text-[10px] text-stone-400 truncate">
                    {task.projectName}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-3 py-2">
        <button
          onClick={onNewSession}
          disabled={!selectedTaskId}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-300 transition-colors disabled:opacity-40 cursor-default"
        >
          <Plus className="w-3.5 h-3.5" />
          新建对话
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-0.5">
        {sessions.length === 0 && selectedTaskId && (
          <div className="px-3 py-4 text-center">
            <MessageSquarePlus className="w-6 h-6 text-stone-300 dark:text-stone-600 mx-auto mb-2" />
            <p className="text-xs text-stone-400 dark:text-stone-500">暂无对话</p>
          </div>
        )}
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            renaming={renamingId === session.id}
            renameValue={renameValue}
            onSelect={() => onSelectSession(session.id)}
            onRenameStart={() => onRenameStart(session)}
            onRenameChange={onRenameValueChange}
            onRenameCommit={() => onRenameCommit(session.id)}
            onDelete={() => onDeleteSession(session.id)}
          />
        ))}
      </div>

      <div className="flex-shrink-0 px-3 py-3 border-t border-stone-100 dark:border-stone-800">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors cursor-default"
        >
          <Settings2 className="w-3.5 h-3.5" />
          设置
        </button>
      </div>
    </aside>
  );
}

// ── PromptToolbar ─────────────────────────────────────────────────────────────

export function PromptToolbar({
  models,
  selectedModel,
  workspaceOptions,
  selectedWorkspace,
  thinkingOptions,
  selectedThinking,
  mode,
  cliAvailable,
  sending,
  onModelChange,
  onWorkspaceChange,
  onThinkingChange,
  onModeChange,
}: {
  models: Array<{ id: string; label: string }>;
  selectedModel: string;
  workspaceOptions: TaskWorkspaceOption[];
  selectedWorkspace: TaskWorkspaceOption | null;
  thinkingOptions: Array<{ value: ThinkingDepth; label: string }>;
  selectedThinking: ThinkingDepth;
  mode: ExecMode;
  cliAvailable: boolean | null;
  sending: boolean;
  onModelChange: (value: string) => void;
  onWorkspaceChange: (value: string) => void;
  onThinkingChange: (value: ThinkingDepth) => void;
  onModeChange: (value: ExecMode) => void;
}) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
      <div className="flex items-center gap-1">
        {models.map((model) => (
          <button
            key={model.id}
            onClick={() => onModelChange(model.id)}
            disabled={sending}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-inherit ${
              selectedModel === model.id
                ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
            }`}
          >
            {model.label}
          </button>
        ))}
      </div>

      {workspaceOptions.length > 0 && (
        <>
          <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              项目模型
            </span>
            {workspaceOptions.length > 1 ? (
              <select
                value={selectedWorkspace?.id ?? ''}
                onChange={(event) => onWorkspaceChange(event.target.value)}
                disabled={sending}
                title={selectedWorkspace?.path ?? ''}
                className="max-w-[240px] rounded-full border border-stone-200 bg-white px-3 py-1 text-[11px] font-medium text-stone-600 outline-none transition hover:border-stone-300 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
              >
                {workspaceOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {formatWorkspaceOptionLabel(option)}
                  </option>
                ))}
              </select>
            ) : (
              <span
                title={selectedWorkspace?.path ?? ''}
                className="inline-flex max-w-[240px] truncate rounded-full border border-stone-200 px-3 py-1 text-[11px] font-medium text-stone-600 dark:border-stone-700 dark:text-stone-300"
              >
                {selectedWorkspace
                  ? formatWorkspaceOptionLabel(selectedWorkspace)
                  : '未选择目录'}
              </span>
            )}
          </div>
        </>
      )}

      <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

      <div className="flex items-center gap-1">
        {thinkingOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onThinkingChange(option.value)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-default ${
              selectedThinking === option.value
                ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

      <div className="flex items-center rounded-full border border-stone-200 dark:border-stone-700 overflow-hidden text-[11px]">
        {(['agent', 'plan'] as ExecMode[]).map((nextMode) => (
          <button
            key={nextMode}
            onClick={() => onModeChange(nextMode)}
            className={`px-3 py-1 font-medium transition-colors cursor-default ${
              mode === nextMode
                ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300'
            }`}
          >
            {nextMode === 'agent' ? 'Agent' : 'Plan'}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

      <button
        type="button"
        title="默认权限模式：命令执行前需要显式授权"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-stone-400 dark:text-stone-500 bg-stone-50 dark:bg-stone-800 cursor-default"
      >
        <Zap className="w-3 h-3" />
        默认权限
      </button>

      {cliAvailable === false && (
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <TriangleAlert className="w-3.5 h-3.5" />
          <span>claude CLI 未安装</span>
        </div>
      )}
    </div>
  );
}

// ── MultiSelectDropdown ───────────────────────────────────────────────────────

function MultiSelectDropdown({
  label,
  options,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  disabled?: boolean;
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const displayText =
    selected.length === 0
      ? label
      : selected.length === options.length
        ? `${label}（全选）`
        : `${label}（${selected.length}）`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors cursor-default disabled:opacity-50 ${
          selected.length > 0
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
            : 'border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:border-stone-300 dark:hover:border-stone-600 bg-white dark:bg-stone-900'
        }`}
      >
        {displayText}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 min-w-[160px] rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl overflow-hidden">
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800 cursor-default"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(opt.value)}
                  className="w-3.5 h-3.5 accent-indigo-600 cursor-default"
                />
                <span className="text-xs text-stone-600 dark:text-stone-300">{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PromptGenerationBar ───────────────────────────────────────────────────────

export function PromptGenerationBar({
  promptTaskTypes,
  constraintTypes,
  scopeTypes,
  genTaskType,
  genConstraints,
  genScope,
  sending,
  promptGenerationStatus,
  promptGenerationMeta,
  confirming,
  onTaskTypeChange,
  onConstraintToggle,
  onScopeChange,
  onGenerateClick,
  onConfirm,
  onCancelConfirm,
}: {
  promptTaskTypes: PromptTaskTypeOption[];
  constraintTypes: readonly ConstraintOption[];
  scopeTypes: readonly ScopeOption[];
  genTaskType: string;
  genConstraints: string[];
  genScope: string;
  sending: boolean;
  promptGenerationStatus: PromptGenerationStatus;
  promptGenerationMeta: PromptGenerationMeta;
  confirming: boolean;
  onTaskTypeChange: (value: string) => void;
  onConstraintToggle: (value: string) => void;
  onScopeChange: (value: string) => void;
  onGenerateClick: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
}) {
  const isRunning = promptGenerationStatus === 'running';
  const canGenerate = !!genTaskType && !!genScope;
  const isDisabled = sending || isRunning;

  return (
    <div className="flex-shrink-0 flex items-center gap-2.5 px-5 py-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 flex-wrap">
      {/* Task type */}
      <select
        value={genTaskType}
        onChange={(e) => onTaskTypeChange(e.target.value)}
        disabled={isDisabled}
        className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-1.5 text-[11px] font-medium text-stone-600 dark:text-stone-300 outline-none transition hover:border-stone-300 disabled:opacity-50 cursor-default"
      >
        <option value="">任务类型</option>
        {promptTaskTypes.map((t) => (
          <option key={t.value} value={t.value} title={t.desc}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Constraints multi-select */}
      <MultiSelectDropdown
        label="约束种类"
        options={constraintTypes as Array<{ value: string; label: string }>}
        selected={genConstraints}
        disabled={isDisabled}
        onToggle={onConstraintToggle}
      />

      {/* Scope single-select */}
      <select
        value={genScope}
        onChange={(e) => onScopeChange(e.target.value)}
        disabled={isDisabled}
        className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium outline-none transition disabled:opacity-50 cursor-default ${
          genScope
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
            : 'border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 bg-white dark:bg-stone-900 hover:border-stone-300 dark:hover:border-stone-600'
        }`}
      >
        <option value="">修改范围</option>
        {scopeTypes.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2">
        {/* Status badge */}
        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${promptGenerationMeta.badgeCls}`}>
          {promptGenerationMeta.label}
        </span>

        {/* Confirm warning */}
        {confirming && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
            将覆盖现有提示词，确认？
          </span>
        )}

        {/* Cancel button */}
        {confirming && (
          <button
            type="button"
            onClick={onCancelConfirm}
            className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-default"
          >
            取消
          </button>
        )}

        {/* Generate / Confirm button */}
        <button
          type="button"
          onClick={confirming ? onConfirm : onGenerateClick}
          disabled={!canGenerate || isDisabled}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-default disabled:opacity-40 ${
            confirming
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
          }`}
        >
          <Sparkles className="w-3 h-3" />
          {confirming
            ? '确认重新出题'
            : promptGenerationStatus === 'done'
              ? '重新出题'
              : '开始出题'}
        </button>
      </div>
    </div>
  );
}
