import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  LayoutDashboard,
  MessageSquare,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings2,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import type { Task, TaskStatus } from '../../store';
import type { ModelRunFromDB, PromptGenerationStatus, TaskFromDB } from '../../api/task';
import {
  getTaskTypePresentation,
  getTaskTypeQuotaRawValue,
  normalizeTaskTypeName,
  type TaskTypeQuotas,
} from '../../api/config';
import {
  getSessionDecisionValue,
  isSessionCounted,
  maskSessionId,
  summarizeCountedRounds,
  type EditableTaskSession,
} from '../lib/sessionUtils';
import { CopyIconButton } from './CopyIconButton';

export type TaskDetailDrawerTab = 'sessions' | 'prompt' | 'model-runs';
export type TaskDetailDrawerModelOption = {
  modelName: string;
  localPath: string | null;
};

type StatusMetaMap = Record<TaskStatus, {
  label: string;
  dotCls: string;
  badgeCls: string;
}>;

type PromptGenerationMeta = {
  label: string;
  badgeCls: string;
  panelCls: string;
};

type SessionPatch = Partial<Pick<EditableTaskSession, 'sessionId' | 'taskType' | 'consumeQuota' | 'isCompleted' | 'isSatisfied' | 'evaluation' | 'userConversation'>>;

interface TaskDetailDrawerProps {
  selected: Task;
  selectedTaskDetail: TaskFromDB | null;
  selectedModelRuns: ModelRunFromDB[];
  drawerLoading: boolean;
  drawerError: string;
  statusChanging: boolean;
  taskTypeChanging: boolean;
  sessionListDraft: EditableTaskSession[];
  sessionListSaving: boolean;
  sessionSaveState: 'idle' | 'saved';
  hasUnsavedSessionChanges: boolean;
  sessionExtracting: boolean;
  openSessionEditors: Set<string>;
  copiedSessionId: string | null;
  promptDraft: string;
  promptSaving: boolean;
  promptSaveState: 'idle' | 'saved';
  promptCopied: boolean;
  activeDrawerTab: TaskDetailDrawerTab;
  sessionModelOptions: TaskDetailDrawerModelOption[];
  selectedSessionModelName: string;
  sessionTaskTypeOptions: string[];
  projectQuotas: TaskTypeQuotas;
  sourceModelName: string;
  selectedPromptGenerationStatus: PromptGenerationStatus;
  selectedPromptGenerationMeta: PromptGenerationMeta;
  selectedPromptGenerationError: string | null;
  escCloseHintVisible: boolean;
  statusMeta: StatusMetaMap;
  statusOptions: TaskStatus[];
  onClose: () => void;
  onStatusChange: (taskId: string, nextStatus: TaskStatus) => void;
  onTabChange: (tab: TaskDetailDrawerTab) => void;
  onAddSession: () => void;
  onAutoExtractSessions: () => void | Promise<void>;
  onSessionChange: (localId: string, patch: SessionPatch) => void;
  onToggleSessionEditor: (localId: string) => void;
  onSessionEditorBlur: (localId: string) => void | Promise<void>;
  onCopySessionId: (localId: string, sessionId: string) => void | Promise<void>;
  onRemoveSession: (localId: string) => void;
  onResetSessions: () => void;
  onSaveSessionList: () => void | Promise<void>;
  onPromptDraftChange: (value: string) => void;
  onPromptCopy: () => void | Promise<void>;
  onPromptReset: () => void;
  onPromptSave: () => void | Promise<void>;
  onSessionModelChange: (modelName: string) => void;
  onOpenPrompt: () => void;
  onOpenSubmit: () => void;
}

const TAB_ITEMS: Array<{ id: TaskDetailDrawerTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'sessions', label: 'Session 视图', icon: LayoutDashboard },
  { id: 'prompt', label: '提示词', icon: Terminal },
  { id: 'model-runs', label: '执行概况', icon: FileText },
];

export default function TaskDetailDrawer({
  selected,
  selectedTaskDetail,
  selectedModelRuns,
  drawerLoading,
  drawerError,
  statusChanging,
  taskTypeChanging,
  sessionListDraft,
  sessionListSaving,
  sessionSaveState,
  hasUnsavedSessionChanges,
  sessionExtracting,
  openSessionEditors,
  copiedSessionId,
  promptDraft,
  promptSaving,
  promptSaveState,
  promptCopied,
  activeDrawerTab,
  sessionModelOptions,
  selectedSessionModelName,
  sessionTaskTypeOptions,
  projectQuotas,
  sourceModelName,
  selectedPromptGenerationStatus,
  selectedPromptGenerationMeta,
  selectedPromptGenerationError,
  escCloseHintVisible,
  statusMeta,
  statusOptions,
  onClose,
  onStatusChange,
  onTabChange,
  onAddSession,
  onAutoExtractSessions,
  onSessionChange,
  onToggleSessionEditor,
  onSessionEditorBlur,
  onCopySessionId,
  onRemoveSession,
  onResetSessions,
  onSaveSessionList,
  onPromptDraftChange,
  onPromptCopy,
  onPromptReset,
  onPromptSave,
  onSessionModelChange,
  onOpenPrompt,
  onOpenSubmit,
}: TaskDetailDrawerProps) {
  const persistedSessionList = useMemo(() => {
    const persistedModelSessions = selectedModelRuns.flatMap(
      (run) => run.sessionList ?? [],
    );
    if (persistedModelSessions.length > 0) {
      return persistedModelSessions;
    }
    return selectedTaskDetail?.sessionList ?? selected.sessionList;
  }, [selected.sessionList, selectedModelRuns, selectedTaskDetail?.sessionList]);
  const [activeSessionLocalId, setActiveSessionLocalId] = useState<string | null>(null);

  const countPersistedQuotaUsage = () => {
    const counts: Record<string, number> = {};

    persistedSessionList.forEach((session, index) => {
      if (!isSessionCounted(session, index)) {
        return;
      }

      const normalizedTaskType = normalizeTaskTypeName(session.taskType);
      if (!normalizedTaskType) {
        return;
      }
      counts[normalizedTaskType] = (counts[normalizedTaskType] ?? 0) + 1;
    });

    return counts;
  };

  const countDraftQuotaUsage = (excludeLocalId?: string) => {
    const counts: Record<string, number> = {};

    sessionListDraft.forEach((session, index) => {
      if (session.localId === excludeLocalId) {
        return;
      }
      if (!isSessionCounted(session, index)) {
        return;
      }

      const normalizedTaskType = normalizeTaskTypeName(session.taskType);
      if (!normalizedTaskType) {
        return;
      }
      counts[normalizedTaskType] = (counts[normalizedTaskType] ?? 0) + 1;
    });

    return counts;
  };

  const persistedQuotaUsage = countPersistedQuotaUsage();

  const getEditableQuotaValue = (taskType: string, excludeLocalId?: string) => {
    const normalizedTaskType = normalizeTaskTypeName(taskType);
    if (!normalizedTaskType) {
      return null;
    }

    const rawQuota = getTaskTypeQuotaRawValue(projectQuotas, normalizedTaskType);
    if (rawQuota === null) {
      return null;
    }

    const otherDraftQuotaUsage = countDraftQuotaUsage(excludeLocalId);
    return rawQuota + (persistedQuotaUsage[normalizedTaskType] ?? 0) - (otherDraftQuotaUsage[normalizedTaskType] ?? 0);
  };

  const formatEditableQuota = (value: number | null, mode: 'option' | 'inline') => {
    if (value === null) {
      return mode === 'option' ? '' : '当前类型不限额';
    }
    if (value < 0) {
      return mode === 'option' ? ` · 已超 ${Math.abs(value)}` : `当前已超额 ${Math.abs(value)}`;
    }
    return mode === 'option' ? ` · 可分配 ${value}` : `当前可分配 ${value}`;
  };

  useEffect(() => {
    if (sessionListDraft.length === 0) {
      setActiveSessionLocalId(null);
      return;
    }

    const activeStillExists = activeSessionLocalId && sessionListDraft.some((session) => session.localId === activeSessionLocalId);
    if (activeStillExists) {
      return;
    }

    const reverseSessions = [...sessionListDraft].reverse();
    const preferred =
      reverseSessions.find((session) => openSessionEditors.has(session.localId) || !session.sessionId.trim())?.localId ??
      sessionListDraft[0]?.localId ??
      null;

    setActiveSessionLocalId(preferred);
  }, [activeSessionLocalId, openSessionEditors, sessionListDraft]);

  const activeSessionIndex = useMemo(() => {
    if (sessionListDraft.length === 0) {
      return -1;
    }
    const matchedIndex = sessionListDraft.findIndex((session) => session.localId === activeSessionLocalId);
    return matchedIndex >= 0 ? matchedIndex : 0;
  }, [activeSessionLocalId, sessionListDraft]);

  const activeSession = activeSessionIndex >= 0 ? sessionListDraft[activeSessionIndex] : null;
  const activeSessionPresentation = activeSession ? getTaskTypePresentation(activeSession.taskType) : null;
  const activeEditableQuota = activeSession ? getEditableQuotaValue(activeSession.taskType, activeSession.localId) : null;
  const executionRuns = useMemo(
    () => selectedModelRuns.filter((run) => !isNonExecutionModel(run.modelName, sourceModelName)),
    [selectedModelRuns, sourceModelName],
  );
  const createdAtText = new Date(selected.createdAt * 1000).toLocaleString('zh-CN');

  const handleTabSwitch = (tab: TaskDetailDrawerTab) => {
    if (tab === activeDrawerTab) {
      return;
    }
    if (activeDrawerTab === 'sessions' && activeSessionLocalId) {
      void onSessionEditorBlur(activeSessionLocalId);
    }
    onTabChange(tab);
  };

  const handleSelectSession = (localId: string) => {
    if (localId === activeSessionLocalId) {
      return;
    }
    if (activeSessionLocalId) {
      void onSessionEditorBlur(activeSessionLocalId);
    }
    onToggleSessionEditor(localId);
    setActiveSessionLocalId(localId);
  };

  useEffect(() => {
    const sessionId = activeSession?.sessionId?.trim() ?? '';
    if (activeDrawerTab !== 'sessions' || !activeSession || !sessionId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || !event.shiftKey || event.key.toLowerCase() !== 'c') {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      void onCopySessionId(activeSession.localId, sessionId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeDrawerTab,
    activeSession,
    onCopySessionId,
  ]);

  const renderSessionsWorkspace = () => {
    if (!activeSession || !activeSessionPresentation) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-zinc-500">
          当前没有可编辑的 session
        </div>
      );
    }

    const isCounted = isSessionCounted(activeSession, activeSessionIndex);
    const isQuotaToggleOn = activeSessionIndex === 0 ? true : activeSession.consumeQuota;
    const requiresSessionId = !activeSession.sessionId.trim();
    const isPendingCount = activeSessionIndex > 0 && isQuotaToggleOn && requiresSessionId;
    const isCompleted = getSessionDecisionValue(activeSession.isCompleted);
    const isSatisfied = getSessionDecisionValue(activeSession.isSatisfied);
    const quotaHint =
      activeSessionIndex === 0
        ? '首个 session 固定扣减'
        : requiresSessionId
          ? (isQuotaToggleOn ? '填写 sessionId 后才会生效' : '填写 sessionId 后可开启计数')
          : formatEditableQuota(activeEditableQuota, 'inline');

    return (
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-zinc-800/70 bg-[#0c0c0f] lg:w-[320px] lg:border-b-0 lg:border-r">
          <div className="border-b border-zinc-800/70 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Session 列表</p>
                <p className="mt-1 text-xs text-zinc-400">{summarizeCountedRounds(sessionListDraft)}</p>
              </div>
              <button
                type="button"
                onClick={onAddSession}
                disabled={sessionExtracting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/70 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" />
                新增
              </button>
            </div>
            {sessionModelOptions.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">当前模型</p>
                {sessionModelOptions.length > 1 ? (
                  <div className="relative">
                    <select
                      value={selectedSessionModelName}
                      onChange={(event) => onSessionModelChange(event.target.value)}
                      className="w-full appearance-none rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5 pr-9 text-sm font-medium text-zinc-200 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
                    >
                      {sessionModelOptions.map((option) => (
                        <option key={option.modelName} value={option.modelName}>
                          {option.modelName}
                        </option>
                      ))}
                    </select>
                    <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-500" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5 text-sm font-medium text-zinc-200">
                    {sessionModelOptions[0]?.modelName}
                  </div>
                )}
                {sessionModelOptions.find((option) => option.modelName === selectedSessionModelName)?.localPath && (
                  <p className="break-all text-[11px] leading-5 text-zinc-500">
                    {sessionModelOptions.find((option) => option.modelName === selectedSessionModelName)?.localPath}
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-[11px]">
              <WorkspaceBadge tone={sessionListSaving ? 'warning' : hasUnsavedSessionChanges ? 'warning' : sessionSaveState === 'saved' ? 'success' : 'neutral'}>
                {sessionListSaving ? '保存中…' : hasUnsavedSessionChanges ? '待保存' : sessionSaveState === 'saved' ? '已保存' : '已同步'}
              </WorkspaceBadge>
              <WorkspaceBadge tone="neutral">共 {sessionListDraft.length || 1} 轮</WorkspaceBadge>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {sessionListDraft.map((session, index) => {
              const presentation = getTaskTypePresentation(session.taskType);
              const counted = isSessionCounted(session, index);
              const pendingCount = index > 0 && session.consumeQuota && !session.sessionId.trim();
              const selectedCard = session.localId === activeSession.localId;
              const sessionCompleted = getSessionDecisionValue(session.isCompleted);
              const sessionSatisfied = getSessionDecisionValue(session.isSatisfied);
              const preview = session.userConversation?.trim() || session.evaluation?.trim() || '当前没有补充内容';

              return (
                <button
                  key={session.localId}
                  type="button"
                  onClick={() => handleSelectSession(session.localId)}
                  className={clsx(
                    'w-full rounded-2xl border p-3 text-left transition',
                    selectedCard
                      ? 'border-indigo-500/35 bg-indigo-500/10 shadow-[0_0_24px_rgba(99,102,241,0.12)]'
                      : 'border-transparent bg-zinc-900/35 hover:border-zinc-700/70 hover:bg-zinc-800/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={clsx('text-xs font-semibold', selectedCard ? 'text-indigo-200' : 'text-zinc-200')}>
                          第 {index + 1} 轮
                        </span>
                        {index === 0 && <WorkspaceBadge tone="neutral">主 session</WorkspaceBadge>}
                        <WorkspaceBadge tone={index === 0 || counted ? 'success' : pendingCount ? 'warning' : 'neutral'}>
                          {index === 0 ? '固定计数' : counted ? '计数' : pendingCount ? '待计数' : '不计数'}
                        </WorkspaceBadge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-zinc-500">{preview}</p>
                    </div>
                    <div className="flex items-center gap-1 text-zinc-500">
                      {sessionCompleted ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <CircleDashed className="h-3.5 w-3.5 text-amber-400" />
                      )}
                      {sessionSatisfied ? (
                        <ThumbsUp className="h-3.5 w-3.5 text-indigo-400" />
                      ) : (
                        <ThumbsDown className="h-3.5 w-3.5 text-red-400" />
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                      <span className={clsx('h-1.5 w-1.5 rounded-full', presentation.dot)} />
                      {presentation.label}
                    </span>
                    <WorkspaceBadge tone="neutral" className="font-mono">
                      {session.sessionId.trim() ? maskSessionId(session.sessionId) : '待填写 sessionId'}
                    </WorkspaceBadge>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-zinc-800/70 px-4 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onResetSessions}
                disabled={sessionListSaving}
                className="flex-1 rounded-xl border border-zinc-700/70 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
              >
                还原
              </button>
              <button
                type="button"
                onClick={() => void onSaveSessionList()}
                disabled={sessionListSaving || sessionListDraft.length === 0 || !hasUnsavedSessionChanges}
                className="flex-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {sessionListSaving ? '保存中…' : '保存列表'}
              </button>
            </div>
          </div>
        </aside>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <motion.div
              key={activeSession.localId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="mx-auto max-w-5xl space-y-6 px-4 py-5 pb-28 sm:px-6 lg:px-8"
            >
              <section className="flex flex-col gap-4 border-b border-zinc-800/60 pb-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-white">第 {activeSessionIndex + 1} 轮详情</h3>
                    {selectedSessionModelName && <WorkspaceBadge tone="blue">{selectedSessionModelName}</WorkspaceBadge>}
                    {activeSessionIndex === 0 && <WorkspaceBadge tone="neutral">主 session</WorkspaceBadge>}
                    <WorkspaceBadge tone={isCounted ? 'success' : isPendingCount ? 'warning' : 'neutral'}>
                      {activeSessionIndex === 0 ? '固定计数' : isCounted ? '计数中' : isPendingCount ? '待计数' : '不计数'}
                    </WorkspaceBadge>
                    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700/70 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                      <span className={clsx('h-1.5 w-1.5 rounded-full', activeSessionPresentation.dot)} />
                      {activeSessionPresentation.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {activeSession.userConversation?.trim() || '这一轮还没有补充用户对话信息，可以直接在下面编辑。'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeSessionIndex > 0 && (
                    <ActionIconButton
                      label="删除 session"
                      danger
                      onClick={() => onRemoveSession(activeSession.localId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </ActionIconButton>
                  )}
                </div>
              </section>

              <SectionBlock
                icon={Hash}
                title="会话标识"
                description="保留原始 sessionId，同时允许直接修正记录值。"
              >
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/40 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                          Session ID
                        </p>
                        <div className="mt-2 break-all font-mono text-xs leading-6 text-zinc-200">
                          {activeSession.sessionId.trim() || '未填写'}
                        </div>
                        {activeSession.sessionId.trim() && (
                          <p className="mt-2 text-[11px] text-zinc-500">
                            快捷复制：⌘/Ctrl + Shift + C
                          </p>
                        )}
                      </div>
                      {activeSession.sessionId.trim() && (
                        <ActionIconButton
                          label={
                            copiedSessionId === activeSession.localId
                              ? 'Session ID 已复制'
                              : '复制 Session ID'
                          }
                          onClick={() =>
                            void onCopySessionId(activeSession.localId, activeSession.sessionId)
                          }
                        >
                          {copiedSessionId === activeSession.localId ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </ActionIconButton>
                      )}
                    </div>
                  </div>
                  <label className="space-y-2">
                    <FieldLabel label="编辑 Session ID" />
                    <input
                      value={activeSession.sessionId}
                      onChange={(event) => onSessionChange(activeSession.localId, { sessionId: event.target.value })}
                      placeholder="记录实际 sessionId"
                      className="w-full rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5 font-mono text-xs text-zinc-200 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
                    />
                  </label>
                </div>
              </SectionBlock>

              <SectionBlock
                icon={MessageSquare}
                title="用户对话信息"
                description="自动提取后可继续人工修订，确保后续出题和追踪上下文准确。"
                badge={<WorkspaceBadge tone="purple">自动提取 · 可编辑</WorkspaceBadge>}
              >
                <textarea
                  value={activeSession.userConversation ?? ''}
                  onChange={(event) => onSessionChange(activeSession.localId, { userConversation: event.target.value })}
                  placeholder="提取到的用户对话会显示在这里"
                  rows={6}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
                />
              </SectionBlock>

              <SectionBlock
                icon={Settings2}
                title="任务配置"
                description="保持这一轮的任务类型、扣减规则和完成状态都可独立控制。"
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px_240px]">
                  <label className="space-y-2">
                    <FieldLabel label="任务类型" />
                    <div className="relative">
                      <select
                        value={activeSession.taskType}
                        disabled={taskTypeChanging}
                        onChange={(event) => onSessionChange(activeSession.localId, { taskType: event.target.value })}
                        className="w-full appearance-none rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5 pr-9 text-sm font-medium text-zinc-200 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40 disabled:opacity-60"
                      >
                        {sessionTaskTypeOptions.map((taskType) => {
                          const optionPresentation = getTaskTypePresentation(taskType);
                          const optionQuota = getEditableQuotaValue(optionPresentation.value, activeSession.localId);
                          return (
                            <option key={optionPresentation.value} value={optionPresentation.value}>
                              {optionPresentation.label}
                              {formatEditableQuota(optionQuota, 'option')}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-500" />
                    </div>
                  </label>

                  <SessionSwitchCard
                    label="扣任务数"
                    description={quotaHint}
                    checked={isQuotaToggleOn}
                    disabled={activeSessionIndex === 0}
                    onChange={(checked) => onSessionChange(activeSession.localId, { consumeQuota: checked })}
                    onLabel={activeSessionIndex === 0 ? '固定开启' : '开启'}
                    offLabel="关闭"
                    tone="indigo"
                  />

                  <SessionSwitchCard
                    label="是否完成"
                    description="关闭后标记为未完成"
                    checked={isCompleted}
                    onChange={(checked) => onSessionChange(activeSession.localId, { isCompleted: checked })}
                    onLabel="完成"
                    offLabel="未完成"
                    tone="emerald"
                  />
                </div>
              </SectionBlock>

              <SectionBlock
                icon={AlertCircle}
                title="结果评价"
                description="记录本轮是否满意，以及为什么满意或不满意。"
                badge={<WorkspaceBadge tone={isSatisfied ? 'success' : 'danger'}>{isSatisfied ? '满意' : '不满意'}</WorkspaceBadge>}
              >
                <div className="space-y-3">
                  <BinaryChoiceGroup
                    title="是否满意"
                    value={isSatisfied}
                    positiveLabel="满意"
                    negativeLabel="不满意"
                    onPositive={() => onSessionChange(activeSession.localId, { isSatisfied: true })}
                    onNegative={() => onSessionChange(activeSession.localId, { isSatisfied: false })}
                  />
                  <textarea
                    value={activeSession.evaluation ?? ''}
                    onChange={(event) => onSessionChange(activeSession.localId, { evaluation: event.target.value })}
                    placeholder="补充本轮 session 的结果、问题或主观评价"
                    rows={4}
                    className={clsx(
                      'w-full rounded-2xl border bg-zinc-950/60 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:ring-1',
                      isSatisfied
                        ? 'border-emerald-500/25 focus:border-emerald-500/50 focus:ring-emerald-500/35'
                        : 'border-amber-500/25 focus:border-amber-500/50 focus:ring-amber-500/35',
                    )}
                  />
                </div>
              </SectionBlock>
            </motion.div>
          </div>
        </div>
      </div>
    );
  };

  const renderPromptWorkspace = () => (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6 pb-6">
        <div className="grid gap-3 md:grid-cols-3">
          <InfoTile label="项目 ID">{selected.projectId}</InfoTile>
          <InfoTile label="创建时间">{createdAtText}</InfoTile>
          <InfoTile label="后台状态">
            <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', promptStatusTone(selectedPromptGenerationStatus))}>
              {selectedPromptGenerationMeta.label}
            </span>
          </InfoTile>
        </div>

        <SectionBlock
          icon={Terminal}
          title="提示词编辑"
          description="这里保留最终可提交的提示词内容，支持手动修订和回写。"
          badge={selectedTaskDetail?.promptText ? <WorkspaceBadge tone="success">已写入任务</WorkspaceBadge> : <WorkspaceBadge tone="neutral">尚未写入</WorkspaceBadge>}
        >
          <div className="space-y-3">
            {selectedPromptGenerationStatus === 'running' && (
              <StatusBanner tone="warning">提示词正在后台生成，完成后会自动写入当前任务。</StatusBanner>
            )}
            {selectedPromptGenerationStatus === 'error' && selectedPromptGenerationError && (
              <StatusBanner tone="danger">最近一次后台生成失败：{selectedPromptGenerationError}</StatusBanner>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/70 bg-zinc-900/40 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span>当前提示词</span>
                <WorkspaceBadge tone={promptCopied ? 'success' : 'neutral'}>
                  {promptCopied ? '已复制' : '可复制'}
                </WorkspaceBadge>
                <WorkspaceBadge tone={promptSaveState === 'saved' ? 'success' : 'neutral'}>
                  {promptSaveState === 'saved' ? '已保存' : '未保存'}
                </WorkspaceBadge>
              </div>
              <button
                type="button"
                onClick={() => void onPromptCopy()}
                disabled={!promptDraft.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/70 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
              >
                {promptCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                复制提示词
              </button>
            </div>

            <textarea
              value={promptDraft}
              onChange={(event) => onPromptDraftChange(event.target.value)}
              rows={18}
              placeholder="在这里直接新增或修改提示词"
              className="min-h-[420px] w-full rounded-[24px] border border-zinc-800 bg-zinc-950/70 px-4 py-4 font-mono text-xs leading-7 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
            />

            <div className="sticky bottom-0 flex justify-end gap-2 rounded-2xl border border-zinc-800/70 bg-[#0b0b0e]/92 px-4 py-3 backdrop-blur-xl">
              <button
                type="button"
                onClick={onPromptReset}
                disabled={promptSaving}
                className="rounded-xl border border-zinc-700/70 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
              >
                还原
              </button>
              <button
                type="button"
                onClick={() => void onPromptSave()}
                disabled={promptSaving || !promptDraft.trim()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {promptSaving ? '保存中…' : '保存提示词'}
              </button>
            </div>
          </div>
        </SectionBlock>
      </div>
    </div>
  );

  const renderModelRunsWorkspace = () => (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6 pb-6">
        <div className="grid gap-3 md:grid-cols-4">
          <InfoTile label="模型副本">{String(executionRuns.length)}</InfoTile>
          <InfoTile label="待处理">{String(executionRuns.filter((run) => run.status === 'pending').length)}</InfoTile>
          <InfoTile label="执行中">{String(executionRuns.filter((run) => run.status === 'running').length)}</InfoTile>
          <InfoTile label="已完成">{String(executionRuns.filter((run) => run.status === 'done').length)}</InfoTile>
        </div>

        <SectionBlock
          icon={FileText}
          title="工作目录"
          description="题卡本地目录和模型执行副本会集中展示在这里。"
        >
          <div className="rounded-2xl border border-zinc-800/70 bg-zinc-950/60 px-4 py-3 font-mono text-xs leading-6 text-zinc-300">
            {selectedTaskDetail?.localPath || '当前题卡未记录本地目录'}
          </div>
        </SectionBlock>

        <SectionBlock
          icon={LayoutDashboard}
          title="模型执行"
          description="跟踪每个模型副本的目录、分支和 PR 状态。"
        >
          {selectedModelRuns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-4 py-10 text-center text-sm text-zinc-500">
              当前任务还没有模型记录
            </div>
          ) : (
            <div className="space-y-3">
              {selectedModelRuns.map((run) => {
                const presentation = modelRunPresentation(run.status);
                const codeLink = resolveModelRunCodeLink(run, sourceModelName);
                return (
                  <div key={run.id} className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <presentation.icon className={clsx('h-4 w-4', presentation.iconCls)} />
                          <span className="font-mono text-sm text-zinc-100">{run.modelName}</span>
                          {isSourceModel(run.modelName, sourceModelName) && <WorkspaceBadge tone="neutral">源码</WorkspaceBadge>}
                          {isOriginModel(run.modelName) && <WorkspaceBadge tone="neutral">ORIGIN</WorkspaceBadge>}
                          <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', presentation.badgeCls)}>
                            {presentation.label}
                          </span>
                        </div>
                        <div className="mt-3 space-y-1.5 text-xs text-zinc-400">
                          <p className="break-all">{run.localPath || '未记录副本目录'}</p>
                          <p className="font-mono break-all">{run.branchName || '尚未创建分支'}</p>
                          <InlineCodeLink
                            label={codeLink.label}
                            url={codeLink.url}
                            copyLabel={`复制 ${run.modelName} ${codeLink.label}`}
                          />
                        </div>
                      </div>
                      {codeLink.url ? (
                        <a
                          href={codeLink.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 transition hover:text-white"
                        >
                          {codeLink.label === '源代码地址' ? '打开源码' : '打开代码'}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-xs text-zinc-500">未生成代码地址</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionBlock>
      </div>
    </div>
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-20 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.16),transparent_28%),rgba(0,0,0,0.78)] backdrop-blur-xl"
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.985 }}
        transition={{ type: 'spring', damping: 22, stiffness: 220 }}
        onClick={onClose}
        className="fixed inset-0 z-30 flex items-center justify-center p-2 sm:p-4 lg:p-6"
      >
        <div
          onClick={(event) => event.stopPropagation()}
          className="flex h-full max-h-[960px] w-full max-w-[1420px] flex-col overflow-hidden rounded-[28px] border border-zinc-800/80 bg-[#0a0a0c]/95 shadow-[0_30px_120px_rgba(0,0,0,0.55)] ring-1 ring-white/5"
        >
          <header className="border-b border-zinc-800/70 bg-[#0b0b0e] px-4 py-4 sm:px-5 lg:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className={clsx('h-2 w-2 rounded-full', statusMeta[selected.status].dotCls)} />
                  <select
                    value={selected.status}
                    disabled={statusChanging}
                    onChange={(event) => onStatusChange(selected.id, event.target.value as TaskStatus)}
                    className={clsx(
                      'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] outline-none',
                      taskStatusTone(selected.status),
                    )}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {statusMeta[status].label}
                      </option>
                    ))}
                  </select>
                  <WorkspaceBadge tone="neutral">{sessionListDraft.length || 1} 个 session</WorkspaceBadge>
                  <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', promptStatusTone(selectedPromptGenerationStatus))}>
                    提示词 {selectedPromptGenerationMeta.label}
                  </span>
                </div>
                <h2 className="mt-3 truncate text-xl font-semibold tracking-tight text-white">{selected.projectName}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Hash className="h-3.5 w-3.5" />
                    #{selected.projectId}
                  </span>
                  <span className="font-mono text-zinc-600">{selected.id}</span>
                  <span>{createdAtText}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
                  {TAB_ITEMS.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeDrawerTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => handleTabSwitch(tab.id)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition',
                          active ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {activeDrawerTab === 'sessions' && (
                  <button
                    type="button"
                    onClick={() => void onAutoExtractSessions()}
                    disabled={sessionExtracting || drawerLoading || taskTypeChanging}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 transition hover:bg-sky-500/15 disabled:opacity-60"
                  >
                    <RefreshCw className={clsx('h-3.5 w-3.5', sessionExtracting && 'animate-spin')} />
                    {sessionExtracting ? '提取中…' : sessionModelOptions.length > 1 ? '提取当前模型' : '自动提取'}
                  </button>
                )}

                <ActionIconButton label="关闭" onClick={onClose}>
                  <X className="h-4 w-4" />
                </ActionIconButton>
              </div>
            </div>
          </header>

          {escCloseHintVisible && (
            <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:px-5 lg:px-6">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-300" />
                <span>再按一次 </span>
                <kbd className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
                  Esc
                </kbd>
                <span> 关闭这个编辑框</span>
              </div>
            </div>
          )}

          {drawerError && (
            <div className="border-b border-red-500/15 bg-red-500/10 px-4 py-3 text-sm text-red-200 sm:px-5 lg:px-6">
              {drawerError}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden bg-[#09090b]">
            {drawerLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">正在加载任务详情…</div>
            ) : (
              <>
                {activeDrawerTab === 'sessions' && renderSessionsWorkspace()}
                {activeDrawerTab === 'prompt' && renderPromptWorkspace()}
                {activeDrawerTab === 'model-runs' && renderModelRunsWorkspace()}
              </>
            )}
          </div>

          <footer className="border-t border-zinc-800/70 bg-[#0b0b0e] px-4 py-4 sm:px-5 lg:px-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onOpenPrompt}
                className="rounded-xl border border-zinc-700/70 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800"
              >
                生成提示词
              </button>
              <button
                type="button"
                onClick={onOpenSubmit}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                提交 PR
              </button>
            </div>
          </footer>
        </div>
      </motion.div>
    </>
  );
}

function ActionIconButton({
  children,
  danger,
  label,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border transition',
        danger
          ? 'border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/15'
          : 'border-zinc-700/70 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function InlineCodeLink({
  label,
  url,
  copyLabel,
}: {
  label: string;
  url: string | null;
  copyLabel: string;
}) {
  if (!url) {
    return (
      <p className="flex items-center gap-2">
        <span className="shrink-0 text-zinc-500">{label}</span>
        <span className="font-mono text-zinc-600">未生成</span>
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        className="min-w-0 flex-1 break-all font-mono text-zinc-300 transition hover:text-white"
      >
        {url}
      </a>
      <div className="flex items-center gap-1">
        <CopyIconButton
          value={url}
          label={copyLabel}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-black/20 text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
          iconClassName="h-3.5 w-3.5"
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={`打开 ${label}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-black/20 text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function WorkspaceBadge({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'purple' | 'blue';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-zinc-700/70 bg-zinc-900 text-zinc-300',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    danger: 'border-red-500/20 bg-red-500/10 text-red-200',
    purple: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-200',
    blue: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
  };

  return (
    <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}

function SectionBlock({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-[24px] border border-zinc-800/70 bg-zinc-900/35 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <Icon className="h-4 w-4 text-indigo-400" />
            {title}
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function InfoTile({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/70 bg-zinc-900/40 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <div className={clsx('mt-2 break-all text-sm text-zinc-200', mono && 'font-mono text-xs leading-6')}>{children}</div>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <span className="block text-[11px] font-medium text-zinc-500">{label}</span>;
}

function StatusBanner({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'warning' | 'danger';
}) {
  return (
    <div className={clsx(
      'rounded-2xl border px-4 py-3 text-xs',
      tone === 'warning'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
        : 'border-red-500/20 bg-red-500/10 text-red-200',
    )}>
      {children}
    </div>
  );
}

function SessionSwitchCard({
  label,
  description,
  checked,
  disabled,
  onChange,
  onLabel,
  offLabel,
  tone,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onLabel: string;
  offLabel: string;
  tone: 'indigo' | 'emerald';
}) {
  const activeTone =
    tone === 'emerald'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
      : 'border-indigo-500/20 bg-indigo-500/10 text-indigo-100';
  const trackTone = tone === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-500';

  return (
    <div className={clsx(
      'flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 transition',
      checked ? activeTone : 'border-zinc-800 bg-black/20 text-zinc-300',
      disabled && 'opacity-60',
    )}>
      <div className="min-w-0">
        <p className="text-xs font-semibold">{label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <WorkspaceBadge tone={checked ? tone === 'emerald' ? 'success' : 'purple' : 'neutral'}>
            {checked ? onLabel : offLabel}
          </WorkspaceBadge>
          <p className="text-[10px] leading-5 text-zinc-500">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition',
          checked ? trackTone : 'bg-zinc-700',
        )}
      >
        <span
          className={clsx(
            'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

function BinaryChoiceGroup({
  title,
  value,
  positiveLabel,
  negativeLabel,
  onPositive,
  onNegative,
}: {
  title: string;
  value: boolean;
  positiveLabel: string;
  negativeLabel: string;
  onPositive: () => void;
  onNegative: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-zinc-800/70 bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold text-zinc-200">{title}</p>
        <p className="mt-1 text-[11px] text-zinc-500">用更明确的判断替代模糊备注。</p>
      </div>
      <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
        <button
          type="button"
          onClick={onPositive}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition',
            value ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-500 hover:text-zinc-200',
          )}
        >
          {positiveLabel}
        </button>
        <button
          type="button"
          onClick={onNegative}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition',
            !value ? 'bg-red-500/20 text-red-200' : 'text-zinc-500 hover:text-zinc-200',
          )}
        >
          {negativeLabel}
        </button>
      </div>
    </div>
  );
}

function taskStatusTone(status: TaskStatus) {
  switch (status) {
    case 'Claimed':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-200';
    case 'Downloading':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-200';
    case 'Downloaded':
      return 'border-zinc-700/70 bg-zinc-900 text-zinc-200';
    case 'PromptReady':
      return 'border-indigo-500/20 bg-indigo-500/10 text-indigo-200';
    case 'Submitted':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
    case 'Error':
      return 'border-red-500/20 bg-red-500/10 text-red-200';
    default:
      return 'border-zinc-700/70 bg-zinc-900 text-zinc-200';
  }
}

function promptStatusTone(status: PromptGenerationStatus) {
  switch (status) {
    case 'running':
      return 'border border-amber-500/20 bg-amber-500/10 text-amber-200';
    case 'done':
      return 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200';
    case 'error':
      return 'border border-red-500/20 bg-red-500/10 text-red-200';
    default:
      return 'border border-zinc-700/70 bg-zinc-900 text-zinc-300';
  }
}

function isOriginModel(modelName: string) {
  return modelName.trim().toUpperCase() === 'ORIGIN';
}

function isSourceModel(modelName: string, sourceModelName: string) {
  return modelName.trim().toUpperCase() === sourceModelName.trim().toUpperCase();
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function isNonExecutionModel(modelName: string, sourceModelName: string) {
  return isOriginModel(modelName) || isSourceModel(modelName, sourceModelName);
}

function resolveModelRunCodeLink(run: ModelRunFromDB, sourceModelName: string) {
  if (isSourceModel(run.modelName, sourceModelName)) {
    return {
      label: '源代码地址',
      url: run.originUrl ?? run.prUrl ?? null,
    };
  }

  return {
    label: '代码地址',
    url: run.prUrl,
  };
}

function modelRunPresentation(status: string) {
  if (status === 'done') {
    return {
      label: '完成',
      icon: CheckCircle2,
      iconCls: 'text-emerald-400',
      badgeCls: 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    };
  }
  if (status === 'running') {
    return {
      label: '执行中',
      icon: PlayCircle,
      iconCls: 'text-amber-400',
      badgeCls: 'border border-amber-500/20 bg-amber-500/10 text-amber-200',
    };
  }
  if (status === 'error') {
    return {
      label: '异常',
      icon: X,
      iconCls: 'text-red-400',
      badgeCls: 'border border-red-500/20 bg-red-500/10 text-red-200',
    };
  }
  return {
    label: '待处理',
    icon: CircleDashed,
    iconCls: 'text-zinc-500',
    badgeCls: 'border border-zinc-700/70 bg-zinc-900 text-zinc-300',
  };
}
