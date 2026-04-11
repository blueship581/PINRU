import {
  ChevronDown,
  FileText,
  MessageSquarePlus,
  Plus,
  Settings2,
  Sparkles,
  Terminal,
  TriangleAlert,
  X,
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

type ConstraintOption = {
  value: string;
  label: string;
};

type ScopeOption = {
  value: string;
  label: string;
  desc: string;
};

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

export function PromptToolbar({
  models,
  selectedModel,
  workspaceOptions,
  selectedWorkspace,
  thinkingOptions,
  selectedThinking,
  mode,
  cliAvailable,
  selectedTaskId,
  promptGenerationMeta,
  showGenPanel,
  taskLocalPath,
  sending,
  promptGenerationStatus,
  onModelChange,
  onWorkspaceChange,
  onThinkingChange,
  onModeChange,
  onToggleGeneratePanel,
}: {
  models: Array<{ id: string; label: string }>;
  selectedModel: string;
  workspaceOptions: TaskWorkspaceOption[];
  selectedWorkspace: TaskWorkspaceOption | null;
  thinkingOptions: Array<{ value: ThinkingDepth; label: string }>;
  selectedThinking: ThinkingDepth;
  mode: ExecMode;
  cliAvailable: boolean | null;
  selectedTaskId: string;
  promptGenerationMeta: PromptGenerationMeta;
  showGenPanel: boolean;
  taskLocalPath: string | null;
  sending: boolean;
  promptGenerationStatus: PromptGenerationStatus;
  onModelChange: (value: string) => void;
  onWorkspaceChange: (value: string) => void;
  onThinkingChange: (value: ThinkingDepth) => void;
  onModeChange: (value: ExecMode) => void;
  onToggleGeneratePanel: () => void;
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

      <div className="ml-auto flex items-center gap-2">
        {cliAvailable === false && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <TriangleAlert className="w-3.5 h-3.5" />
            <span>claude CLI 未安装</span>
          </div>
        )}

        {selectedTaskId && (
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${promptGenerationMeta.badgeCls}`}>
            提示词 {promptGenerationMeta.label}
          </span>
        )}

        <button
          onClick={onToggleGeneratePanel}
          disabled={!taskLocalPath || sending || promptGenerationStatus === 'running'}
          title="出题"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-colors cursor-default disabled:opacity-40 ${
            showGenPanel
              ? 'bg-indigo-600 text-white'
              : 'text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-200'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          出题
        </button>
      </div>
    </div>
  );
}

export function PromptGenerationPanel({
  selectedWorkspace,
  promptTaskTypes,
  constraintTypes,
  scopeTypes,
  genTaskType,
  genConstraints,
  genScopes,
  sending,
  promptGenerationStatus,
  onClose,
  onTaskTypeChange,
  onConstraintToggle,
  onScopeToggle,
  onGenerate,
}: {
  selectedWorkspace: TaskWorkspaceOption | null;
  promptTaskTypes: PromptTaskTypeOption[];
  constraintTypes: readonly ConstraintOption[];
  scopeTypes: readonly ScopeOption[];
  genTaskType: string;
  genConstraints: string[];
  genScopes: string[];
  sending: boolean;
  promptGenerationStatus: PromptGenerationStatus;
  onClose: () => void;
  onTaskTypeChange: (value: string) => void;
  onConstraintToggle: (value: string) => void;
  onScopeToggle: (value: string) => void;
  onGenerate: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-b border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-5 py-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
            出题配置
          </span>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 cursor-default"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {selectedWorkspace && (
          <div className="rounded-xl border border-indigo-100 bg-white/70 px-3 py-2 dark:border-indigo-900/40 dark:bg-stone-900/40">
            <p className="text-[10px] font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
              当前模型目录
            </p>
            <p className="mt-1 text-xs font-medium text-stone-700 dark:text-stone-200">
              {formatWorkspaceOptionLabel(selectedWorkspace)}
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-stone-500 dark:text-stone-400">
              {selectedWorkspace.path}
            </p>
          </div>
        )}

        <div>
          <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 uppercase tracking-wider">
            任务类型
          </p>
          <div className="flex flex-wrap gap-1.5">
            {promptTaskTypes.map((taskType) => (
              <button
                key={taskType.value}
                onClick={() => onTaskTypeChange(taskType.value)}
                title={taskType.desc}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-default border ${
                  genTaskType === taskType.value
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-indigo-400 hover:text-indigo-600'
                }`}
              >
                {taskType.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-6">
          <div className="flex-1">
            <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 uppercase tracking-wider">
              约束种类（多选）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {constraintTypes.map((constraint) => {
                const active = genConstraints.includes(constraint.value);

                return (
                  <button
                    key={constraint.value}
                    onClick={() => onConstraintToggle(constraint.value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-default border ${
                      active
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-emerald-400 hover:text-emerald-600'
                    }`}
                  >
                    {constraint.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1">
            <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 uppercase tracking-wider">
              修改范围（多选）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {scopeTypes.map((scope) => {
                const active = genScopes.includes(scope.value);

                return (
                  <button
                    key={scope.value}
                    onClick={() => onScopeToggle(scope.value)}
                    title={scope.desc}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-default border ${
                      active
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-amber-400 hover:text-amber-600'
                    }`}
                  >
                    {scope.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onGenerate}
            disabled={!genTaskType || genScopes.length === 0 || sending || promptGenerationStatus === 'running'}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-default disabled:opacity-40"
          >
            <Sparkles className="w-3.5 h-3.5" />
            开始出题
          </button>
        </div>
      </div>
    </div>
  );
}
