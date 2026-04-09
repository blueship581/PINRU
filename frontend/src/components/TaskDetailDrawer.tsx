import React from 'react';
import { motion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  PlayCircle,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { Task, TaskStatus } from '../store';
import type { ModelRunFromDB, PromptGenerationStatus, TaskFromDB } from '../services/task';
import {
  getTaskTypePresentation,
  getTaskTypeQuotaRawValue,
  normalizeTaskTypeName,
  type TaskTypeQuotas,
} from '../services/config';
import {
  formatBooleanSelection,
  getSessionDecisionBadge,
  isSessionCounted,
  maskSessionId,
  parseBooleanSelection,
  summarizeCountedRounds,
  type EditableTaskSession,
} from '../lib/sessionUtils';

export type TaskDetailDrawerTab = 'sessions' | 'prompt' | 'model-runs';

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
  sessionExtracting: boolean;
  openSessionEditors: Set<string>;
  copiedSessionId: string | null;
  promptDraft: string;
  promptSaving: boolean;
  promptSaveState: 'idle' | 'saved';
  promptCopied: boolean;
  activeDrawerTab: TaskDetailDrawerTab;
  sessionTaskTypeOptions: string[];
  projectQuotas: TaskTypeQuotas;
  sourceModelName: string;
  selectedPromptGenerationStatus: PromptGenerationStatus;
  selectedPromptGenerationMeta: PromptGenerationMeta;
  selectedPromptGenerationError: string | null;
  statusMeta: StatusMetaMap;
  statusOptions: TaskStatus[];
  onClose: () => void;
  onStatusChange: (taskId: string, nextStatus: TaskStatus) => void;
  onTabChange: (tab: TaskDetailDrawerTab) => void;
  onAddSession: () => void;
  onAutoExtractSessions: () => void | Promise<void>;
  onSessionChange: (localId: string, patch: SessionPatch) => void;
  onToggleSessionEditor: (localId: string) => void;
  onCopySessionId: (localId: string, sessionId: string) => void | Promise<void>;
  onRemoveSession: (localId: string) => void;
  onResetSessions: () => void;
  onSaveSessionList: () => void | Promise<void>;
  onPromptDraftChange: (value: string) => void;
  onPromptCopy: () => void | Promise<void>;
  onPromptReset: () => void;
  onPromptSave: () => void | Promise<void>;
  onOpenPrompt: () => void;
  onOpenSubmit: () => void;
}

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
  sessionExtracting,
  openSessionEditors,
  copiedSessionId,
  promptDraft,
  promptSaving,
  promptSaveState,
  promptCopied,
  activeDrawerTab,
  sessionTaskTypeOptions,
  projectQuotas,
  sourceModelName,
  selectedPromptGenerationStatus,
  selectedPromptGenerationMeta,
  selectedPromptGenerationError,
  statusMeta,
  statusOptions,
  onClose,
  onStatusChange,
  onTabChange,
  onAddSession,
  onAutoExtractSessions,
  onSessionChange,
  onToggleSessionEditor,
  onCopySessionId,
  onRemoveSession,
  onResetSessions,
  onSaveSessionList,
  onPromptDraftChange,
  onPromptCopy,
  onPromptReset,
  onPromptSave,
  onOpenPrompt,
  onOpenSubmit,
}: TaskDetailDrawerProps) {
  const persistedSessionList = selectedTaskDetail?.sessionList ?? selected.sessionList;

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

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
      />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 220 }}
        className="fixed top-0 right-0 bottom-0 w-[640px] max-w-[calc(100vw-16px)] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
      >
        <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusMeta[selected.status].dotCls}`} />
              <select
                value={selected.status}
                disabled={statusChanging}
                onChange={(event) => onStatusChange(selected.id, event.target.value as TaskStatus)}
                className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border-0 outline-none cursor-default appearance-none ${statusMeta[selected.status].badgeCls} disabled:opacity-60`}
              >
                {statusOptions.map((status) => <option key={status} value={status}>{statusMeta[status].label}</option>)}
              </select>
              <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">
                {sessionListDraft.length || 1} 个 session
              </span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${selectedPromptGenerationMeta.badgeCls}`}>
                提示词 {selectedPromptGenerationMeta.label}
              </span>
            </div>
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight truncate">{selected.projectName}</h2>
            <p className="text-xs font-mono text-stone-400 mt-0.5">#{selected.projectId} · {selected.id}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 flex-shrink-0 cursor-default">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-stone-200 dark:border-stone-800 px-7">
          {[
            { id: 'sessions', label: 'Session 列表' },
            { id: 'prompt', label: '提示词' },
            { id: 'model-runs', label: '模型进度' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id as TaskDetailDrawerTab)}
              className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors cursor-default ${
                activeDrawerTab === tab.id
                  ? 'border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100'
                  : 'border-transparent text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-7">
          {drawerLoading ? (
            <div className="py-20 text-center text-sm text-stone-400 dark:text-stone-500">正在加载任务详情…</div>
          ) : (
            <>
              {drawerError && (
                <div className="rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 mb-6">
                  {drawerError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <TaskDetailInfoCard label="项目 ID" value={selected.projectId} mono />
                <TaskDetailInfoCard label="创建时间" value={new Date(selected.createdAt * 1000).toLocaleString('zh-CN')} />
              </div>

              {activeDrawerTab === 'sessions' && (
                <div className="rounded-2xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-8">
                  <div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">Session 列表</span>
                      <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
                        {summarizeCountedRounds(sessionListDraft)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-white dark:bg-stone-900 px-2.5 py-1 text-[10px] font-semibold text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-700">
                        共 {sessionListDraft.length || 1} 轮
                      </span>
                      {sessionSaveState === 'saved' && (
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">已保存</span>
                      )}
                      <button
                        onClick={onAddSession}
                        disabled={sessionExtracting}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-100 dark:bg-stone-700 text-[11px] font-semibold text-stone-600 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-600 transition-colors cursor-default"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        新增 session
                      </button>
                      <button
                        onClick={() => void onAutoExtractSessions()}
                        disabled={sessionExtracting || drawerLoading || taskTypeChanging}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border border-sky-200 dark:border-sky-500/20 bg-sky-50 dark:bg-sky-500/10 text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/20 transition-colors disabled:opacity-60 cursor-default"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${sessionExtracting ? 'animate-spin' : ''}`} />
                        {sessionExtracting ? '提取中…' : '自动提取'}
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-4 bg-white dark:bg-stone-900">
                    <div className="space-y-3">
                      {sessionListDraft.map((session, index) => {
                        const presentation = getTaskTypePresentation(session.taskType);
                        const editableQuota = getEditableQuotaValue(session.taskType, session.localId);
                        const isCounted = isSessionCounted(session, index);
                        const requiresSessionId = !session.sessionId.trim();
                        const isSessionEditorOpen = openSessionEditors.has(session.localId) || requiresSessionId;
                        const completionBadge = getSessionDecisionBadge(session.isCompleted, '已完成', '未完成');
                        const satisfactionBadge = getSessionDecisionBadge(session.isSatisfied, '满意', '不满意');
                        const hasDecisionGap = session.isCompleted === null || session.isSatisfied === null;
                        const canToggleSessionEditor = !requiresSessionId;

                        const handleToggleSummary = () => {
                          if (!canToggleSessionEditor) {
                            return;
                          }
                          onToggleSessionEditor(session.localId);
                        };

                        const handleSummaryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
                          if (!canToggleSessionEditor) {
                            return;
                          }
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onToggleSessionEditor(session.localId);
                          }
                        };

                        return (
                          <div
                            key={session.localId}
                            className={`rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-4 py-4 transition-colors ${
                              isSessionEditorOpen ? 'shadow-sm' : ''
                            }`}
                          >
                            <div
                              role="button"
                              tabIndex={canToggleSessionEditor ? 0 : -1}
                              onClick={handleToggleSummary}
                              onKeyDown={handleSummaryKeyDown}
                              className={`flex items-center justify-between gap-3 ${canToggleSessionEditor ? 'cursor-default' : ''}`}
                            >
                              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                                  第 {index + 1} 轮
                                </span>
                                {index === 0 && (
                                  <span className="px-2 py-0.5 rounded-full bg-stone-200 dark:bg-stone-700 text-[10px] font-semibold text-stone-600 dark:text-stone-300">
                                    主 session
                                  </span>
                                )}
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  isCounted
                                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                    : 'bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300'
                                }`}>
                                  {isCounted ? '计数' : '不计数'}
                                </span>
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${presentation.badge}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
                                  {presentation.label}
                                </span>
                                {completionBadge && (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${completionBadge.className}`}>
                                    {completionBadge.label}
                                  </span>
                                )}
                                {satisfactionBadge && (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${satisfactionBadge.className}`}>
                                    {satisfactionBadge.label}
                                  </span>
                                )}
                                <span className={`min-w-0 max-w-[180px] truncate rounded-full border px-2 py-0.5 text-[10px] font-mono ${
                                  requiresSessionId
                                    ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
                                    : 'border-stone-200 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400'
                                }`}>
                                  {requiresSessionId ? '待填写 sessionId' : maskSessionId(session.sessionId)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {session.sessionId.trim() && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void onCopySessionId(session.localId, session.sessionId);
                                    }}
                                    className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors cursor-default"
                                    title="复制 sessionId"
                                  >
                                    {copiedSessionId === session.localId ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                                {index > 0 && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onRemoveSession(session.localId);
                                    }}
                                    className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-default"
                                    title="删除 session"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleToggleSummary();
                                  }}
                                  disabled={!canToggleSessionEditor}
                                  className="inline-flex items-center gap-1 rounded-xl border border-stone-200 dark:border-stone-700 px-2.5 py-1 text-[11px] font-semibold text-stone-500 dark:text-stone-300 bg-white dark:bg-stone-900 disabled:opacity-60 cursor-default"
                                  title={canToggleSessionEditor ? (isSessionEditorOpen ? '收起编辑区' : '展开编辑区') : '请先填写 sessionId'}
                                >
                                  {isSessionEditorOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  {isSessionEditorOpen ? '收起' : '编辑'}
                                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isSessionEditorOpen ? 'rotate-180' : ''}`} />
                                </button>
                              </div>
                            </div>

                            {isSessionEditorOpen && (
                              <div className="mt-3">
                                <div className="mb-3 rounded-2xl border border-dashed border-stone-200 dark:border-stone-700 px-3 py-2.5 bg-white/70 dark:bg-stone-900/60">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400">sessionId</span>
                                    <span className="font-mono text-xs text-stone-500 dark:text-stone-400">
                                      {session.sessionId.trim() || '未填写'}
                                    </span>
                                  </div>
                                  {copiedSessionId === session.localId && (
                                    <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">sessionId 已复制</p>
                                  )}
                                </div>

                                <label className="block mb-3">
                                  <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">编辑 sessionId</span>
                                  <input
                                    value={session.sessionId}
                                    onChange={(event) => onSessionChange(session.localId, { sessionId: event.target.value })}
                                    placeholder="记录实际 sessionId"
                                    className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-2.5 text-sm font-mono text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                                  />
                                </label>

                                <label className="block mb-3">
                                  <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                                    用户对话信息
                                    <span className="ml-1 text-stone-400 dark:text-stone-500">自动提取，可编辑</span>
                                  </span>
                                  <textarea
                                    value={session.userConversation ?? ''}
                                    onChange={(event) => onSessionChange(session.localId, { userConversation: event.target.value })}
                                    placeholder="提取到的用户对话会显示在这里"
                                    rows={4}
                                    className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-3 text-sm text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30 resize-y"
                                  />
                                </label>

                                {hasDecisionGap && (
                                  <p className="mb-3 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                    请补充是否完成和是否满意，这两项为必选。
                                  </p>
                                )}

                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                                  <label className="block min-w-0">
                                    <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">任务类型</span>
                                    <select
                                      value={session.taskType}
                                      onChange={(event) => onSessionChange(session.localId, { taskType: event.target.value })}
                                      className={`w-full rounded-2xl border px-4 py-2.5 text-sm font-semibold outline-none appearance-none cursor-default ${presentation.badge}`}
                                    >
                                      {sessionTaskTypeOptions.map((taskType) => {
                                        const optionPresentation = getTaskTypePresentation(taskType);
                                        const optionQuota = getEditableQuotaValue(optionPresentation.value, session.localId);
                                        return (
                                          <option key={optionPresentation.value} value={optionPresentation.value}>
                                            {optionPresentation.label}
                                            {formatEditableQuota(optionQuota, 'option')}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </label>

                                  <label className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${
                                    isCounted
                                      ? 'border-stone-300 dark:border-stone-600 bg-stone-100 dark:bg-stone-800'
                                      : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900'
                                  }`}>
                                    <input
                                      type="checkbox"
                                      checked={isCounted}
                                      disabled={index === 0}
                                      onChange={(event) => onSessionChange(session.localId, { consumeQuota: event.target.checked })}
                                      className="w-4 h-4 rounded accent-slate-700 dark:accent-slate-300 cursor-default disabled:opacity-60"
                                    />
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">扣任务数</p>
                                      <p className="text-[10px] text-stone-400 dark:text-stone-500">
                                        {index === 0
                                          ? '首个 session 固定扣减'
                                          : formatEditableQuota(editableQuota, 'inline')}
                                      </p>
                                    </div>
                                  </label>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3">
                                  <label className="block">
                                    <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                                      是否完成
                                      <span className="ml-1 text-red-500">*</span>
                                    </span>
                                    <select
                                      value={formatBooleanSelection(session.isCompleted)}
                                      onChange={(event) => onSessionChange(session.localId, { isCompleted: parseBooleanSelection(event.target.value) })}
                                      className={`w-full rounded-2xl border px-4 py-2.5 text-sm font-medium outline-none appearance-none cursor-default bg-white dark:bg-stone-900 ${
                                        session.isCompleted === null
                                          ? 'border-amber-300 dark:border-amber-500/50 text-stone-500 dark:text-stone-300'
                                          : 'border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300'
                                      }`}
                                    >
                                      <option value="">请选择</option>
                                      <option value="true">是</option>
                                      <option value="false">否</option>
                                    </select>
                                  </label>

                                  <label className="block">
                                    <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                                      是否满意
                                      <span className="ml-1 text-red-500">*</span>
                                    </span>
                                    <select
                                      value={formatBooleanSelection(session.isSatisfied)}
                                      onChange={(event) => onSessionChange(session.localId, { isSatisfied: parseBooleanSelection(event.target.value) })}
                                      className={`w-full rounded-2xl border px-4 py-2.5 text-sm font-medium outline-none appearance-none cursor-default bg-white dark:bg-stone-900 ${
                                        session.isSatisfied === null
                                          ? 'border-amber-300 dark:border-amber-500/50 text-stone-500 dark:text-stone-300'
                                          : 'border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300'
                                      }`}
                                    >
                                      <option value="">请选择</option>
                                      <option value="true">是</option>
                                      <option value="false">否</option>
                                    </select>
                                  </label>
                                </div>

                                <label className="block mt-3">
                                  <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                                    评价
                                    <span className="ml-1 text-stone-400 dark:text-stone-500">可选</span>
                                  </span>
                                  <textarea
                                    value={session.evaluation ?? ''}
                                    onChange={(event) => onSessionChange(session.localId, { evaluation: event.target.value })}
                                    placeholder="补充本轮 session 的结果、问题或主观评价"
                                    rows={3}
                                    className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-3 text-sm text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30 resize-y"
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex justify-end gap-3">
                      <button
                        onClick={onResetSessions}
                        disabled={sessionListSaving}
                        className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-xs font-semibold text-stone-600 dark:text-stone-300 disabled:opacity-50 cursor-default"
                      >
                        还原
                      </button>
                      <button
                        onClick={() => void onSaveSessionList()}
                        disabled={sessionListSaving || sessionListDraft.length === 0}
                        className="px-3 py-2 rounded-xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-xs font-semibold text-white dark:text-[#0D1117] disabled:opacity-50 cursor-default"
                      >
                        {sessionListSaving ? '保存中…' : '保存 session 列表'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeDrawerTab === 'prompt' && (
                <div className="rounded-2xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-8">
                  <div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">提示词</span>
                      <button
                        onClick={() => void onPromptCopy()}
                        disabled={!promptDraft.trim()}
                        title="复制提示词"
                        className="p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 disabled:opacity-40 cursor-default transition-colors"
                      >
                        {promptCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {promptCopied && (
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">已复制</span>
                      )}
                      {promptSaveState === 'saved' && (
                        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">已保存</span>
                      )}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${selectedPromptGenerationMeta.badgeCls}`}>
                        后台 {selectedPromptGenerationMeta.label}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        selectedTaskDetail?.promptText
                          ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400'
                          : 'bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500'
                      }`}>
                        {selectedTaskDetail?.promptText ? '已保存' : '未保存'}
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3 bg-white dark:bg-stone-900">
                    {selectedPromptGenerationStatus === 'running' && (
                      <div className={`mb-3 rounded-2xl border px-3 py-2 text-xs ${selectedPromptGenerationMeta.panelCls}`}>
                        提示词正在后台生成，完成后会自动写入当前任务。
                      </div>
                    )}
                    {selectedPromptGenerationStatus === 'error' && selectedPromptGenerationError && (
                      <div className={`mb-3 rounded-2xl border px-3 py-2 text-xs ${selectedPromptGenerationMeta.panelCls}`}>
                        最近一次后台生成失败：{selectedPromptGenerationError}
                      </div>
                    )}
                    <textarea
                      value={promptDraft}
                      onChange={(event) => onPromptDraftChange(event.target.value)}
                      rows={12}
                      placeholder="在这里直接新增或修改提示词"
                      className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-4 py-3 text-xs leading-relaxed text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30 resize-y"
                    />
                    <div className="mt-3 flex justify-end gap-3">
                      <button
                        onClick={onPromptReset}
                        disabled={promptSaving}
                        className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-xs font-semibold text-stone-600 dark:text-stone-300 disabled:opacity-50 cursor-default"
                      >
                        还原
                      </button>
                      <button
                        onClick={() => void onPromptSave()}
                        disabled={promptSaving || !promptDraft.trim()}
                        className="px-3 py-2 rounded-xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-xs font-semibold text-white dark:text-[#0D1117] disabled:opacity-50 cursor-default"
                      >
                        {promptSaving ? '保存中…' : '保存提示词'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeDrawerTab === 'model-runs' && (
                <>
                  <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-4 mb-8 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">工作目录</span>
                      <span className="text-xs text-stone-400 dark:text-stone-500">
                        {selectedModelRuns.filter((run) => !isNonExecutionModel(run.modelName, sourceModelName)).length} 个模型副本
                      </span>
                    </div>
                    <p className="font-mono text-xs leading-6 text-stone-600 dark:text-stone-300 break-all">{selectedTaskDetail?.localPath || '当前题卡未记录本地目录'}</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">模型执行</h3>
                      <div className="flex items-center gap-2 text-[11px] font-semibold">
                        <span className="px-2 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                          待处理 {selectedModelRuns.filter((run) => !isNonExecutionModel(run.modelName, sourceModelName) && run.status === 'pending').length}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">
                          执行中 {selectedModelRuns.filter((run) => !isNonExecutionModel(run.modelName, sourceModelName) && run.status === 'running').length}
                        </span>
                        <span className="px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                          已完成 {selectedModelRuns.filter((run) => !isNonExecutionModel(run.modelName, sourceModelName) && run.status === 'done').length}
                        </span>
                      </div>
                    </div>
                    {selectedModelRuns.length === 0 ? (
                      <p className="text-sm text-stone-400 dark:text-stone-600 text-center py-6 border border-dashed border-stone-200 dark:border-stone-800 rounded-2xl">当前任务还没有模型记录</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedModelRuns.map((run) => {
                          const presentation = modelRunPresentation(run.status);
                          return (
                            <div key={run.id} className="px-4 py-3 bg-stone-50 dark:bg-stone-800/50 rounded-2xl border border-stone-200 dark:border-stone-700">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2.5">
                                    <presentation.icon className={`w-3.5 h-3.5 flex-shrink-0 ${presentation.iconCls}`} />
                                    <span className="font-mono text-sm text-stone-700 dark:text-stone-300">{run.modelName}</span>
                                    {isSourceModel(run.modelName, sourceModelName) && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">源码</span>}
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${presentation.badgeCls}`}>{presentation.label}</span>
                                  </div>
                                  <div className="mt-2 space-y-1.5 text-xs text-stone-500 dark:text-stone-400">
                                    <p className="break-all">{run.localPath || '未记录副本目录'}</p>
                                    <p className="font-mono break-all">{run.branchName || '尚未创建分支'}</p>
                                  </div>
                                </div>
                                {run.prUrl ? (
                                  <a href={run.prUrl} target="_blank" rel="noreferrer" className="text-xs text-stone-400 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 transition-colors cursor-default flex-shrink-0">PR <ExternalLink className="w-3 h-3" /></a>
                                ) : (
                                  <span className="text-xs text-stone-400 dark:text-stone-500 flex-shrink-0">未生成 PR</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="px-7 py-5 border-t border-stone-100 dark:border-stone-800 flex gap-3">
          <button onClick={onOpenPrompt} className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-2xl text-sm font-semibold text-stone-700 dark:text-stone-300 transition-colors cursor-default">生成提示词</button>
          <button onClick={onOpenSubmit} className="flex-1 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors shadow-sm cursor-default">提交 PR</button>
        </div>
      </motion.aside>
    </>
  );
}

function TaskDetailInfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">{label}</p>
      <p className={`mt-2 text-sm text-stone-700 dark:text-stone-300 break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function isOriginModel(modelName: string) {
  return modelName.trim().toUpperCase() === 'ORIGIN';
}

function isSourceModel(modelName: string, sourceModelName: string) {
  return modelName.trim().toUpperCase() === sourceModelName.trim().toUpperCase();
}

function isNonExecutionModel(modelName: string, sourceModelName: string) {
  return isOriginModel(modelName) || isSourceModel(modelName, sourceModelName);
}

function modelRunPresentation(status: string) {
  if (status === 'done') {
    return {
      label: '完成',
      icon: CheckCircle2,
      iconCls: 'text-emerald-500',
      badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    };
  }
  if (status === 'running') {
    return {
      label: '执行中',
      icon: PlayCircle,
      iconCls: 'text-amber-500',
      badgeCls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    };
  }
  if (status === 'error') {
    return {
      label: '异常',
      icon: X,
      iconCls: 'text-red-500',
      badgeCls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    };
  }
  return {
    label: '待处理',
    icon: CircleDashed,
    iconCls: 'text-stone-400',
    badgeCls: 'bg-stone-100 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400',
  };
}
