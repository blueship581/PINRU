import { useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, ChevronRight, FolderOpen, PlayCircle, Wand2, X } from 'lucide-react';
import type { Task, TaskStatus } from '../../../store';
import {
  getTaskTypePresentation,
  normalizeTaskTypeName,
} from '../../../api/config';
import type {
  ExtractTaskSessionCandidate,
  ModelRunFromDB,
  TaskChildDirectory,
} from '../../../api/task';
import {
  matchKindLabel,
  resolveCandidateModelName,
} from '../../../shared/lib/sessionCandidateUtils';
import {
  CONSTRAINT_TYPES,
  SCOPE_TYPES,
  LS_KEY_CONSTRAINTS,
  LS_KEY_SCOPE,
} from '../../../shared/lib/promptConstants';
import { STATUS } from './BoardPresentation';

type ContextMenuPanel = 'status' | 'taskType' | 'promptGen' | 'quickExecute';

export function SessionExtractCandidateModal({
  candidates,
  selectedModelName,
  modelRuns,
  onClose,
  onSelect,
}: {
  candidates: ExtractTaskSessionCandidate[];
  selectedModelName: string;
  modelRuns: ModelRunFromDB[];
  onClose: () => void;
  onSelect: (candidate: ExtractTaskSessionCandidate) => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
      >
        <div className="w-full max-w-3xl rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-stone-100 dark:border-stone-800 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">
                检测到多个 Trae 对话
              </h2>
              <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                {selectedModelName
                  ? `模型 ${selectedModelName} 匹配到多个会话，请选择要回填到试题预览里的那一个。`
                  : '当前题卡匹配到多个会话，请选择要回填到试题预览里的那一个。'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-6 space-y-4 bg-stone-50/80 dark:bg-stone-950/20">
            {candidates.map((candidate) => {
              const candidateModelName = resolveCandidateModelName(candidate, modelRuns);

              return (
                <div
                  key={candidate.id}
                  className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {candidateModelName && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                            模型 {candidateModelName}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          {candidate.sessionCount} 个 session
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[10px] font-semibold text-stone-500 dark:text-stone-400">
                          匹配方式：{matchKindLabel(candidate.matchKind)}
                        </span>
                        {(candidate.username || candidate.userId) && (
                          <span className="px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-500/10 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                            用户 {candidate.username || candidate.userId}
                          </span>
                        )}
                      </div>
                      <p className="mt-3 text-sm font-semibold text-stone-900 dark:text-stone-50 break-all">
                        {candidate.summary || '未提取到对话摘要'}
                      </p>
                      <div className="mt-3 space-y-1.5 text-xs text-stone-500 dark:text-stone-400">
                        <p className="break-all">Trae 路径：{candidate.workspacePath}</p>
                        <p className="break-all">匹配目录：{candidate.matchedPath}</p>
                        <p>
                          用户输入 {candidate.userMessageCount} 条
                          {candidate.lastActivityAt
                            ? ` · 最近活动 ${new Date(candidate.lastActivityAt * 1000).toLocaleString('zh-CN')}`
                            : ''}
                        </p>
                      </div>
                      <div className="mt-3 space-y-2">
                        {candidate.sessions.map((session, index) => (
                          <div
                            key={session.sessionId}
                            className="rounded-xl bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 px-3 py-2"
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                                第 {index + 1} 轮
                              </span>
                              {session.isCurrent && (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  当前会话
                                </span>
                              )}
                              <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400 break-all">
                                {session.sessionId}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 line-clamp-2">
                              {session.firstUserMessage || '没有提取到该轮用户输入'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelect(candidate)}
                      className="px-4 py-2 rounded-2xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-sm font-semibold text-white dark:text-[#0D1117] transition-colors cursor-default flex-shrink-0"
                    >
                      使用这个对话
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </>
  );
}

export function TaskCardContextMenu({
  menuRef,
  task,
  position,
  statusOptions,
  availableTaskTypes,
  statusChanging,
  taskTypeChanging,
  localFolderOpening,
  childDirectories,
  childDirectoriesLoading,
  quickActionLoadingPath,
  actionError,
  onOpenLocalFolder,
  onStatusChange,
  onTaskTypeChange,
  onGeneratePrompt,
  onQuickAiReview,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  task: Task;
  position: {
    x: number;
    y: number;
  };
  statusOptions: TaskStatus[];
  availableTaskTypes: string[];
  statusChanging: boolean;
  taskTypeChanging: boolean;
  localFolderOpening: boolean;
  childDirectories: TaskChildDirectory[];
  childDirectoriesLoading: boolean;
  quickActionLoadingPath: string | null;
  actionError: string;
  onOpenLocalFolder: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onTaskTypeChange: (taskType: string) => void;
  onGeneratePrompt: (constraints: string[], scope: string) => void;
  onQuickAiReview?: (directory: TaskChildDirectory) => void;
}) {
  const [panel, setPanel] = useState<ContextMenuPanel | null>(null);
  const [menuConstraints, setMenuConstraints] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_CONSTRAINTS);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  });
  const [menuScope, setMenuScope] = useState<string>(() => {
    try { return localStorage.getItem(LS_KEY_SCOPE) ?? ''; } catch { return ''; }
  });

  const toggleMenuConstraint = (value: string) => {
    setMenuConstraints((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      try { localStorage.setItem(LS_KEY_CONSTRAINTS, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleMenuScopeChange = (value: string) => {
    setMenuScope(value);
    try { localStorage.setItem(LS_KEY_SCOPE, value); } catch {}
  };
  const currentTaskType = normalizeTaskTypeName(task.taskType) || task.taskType;
  const currentStatusMeta = STATUS[task.status];
  const currentTaskTypePresentation = getTaskTypePresentation(currentTaskType);
  const menuSurfaceClass =
    'relative w-[280px] overflow-hidden rounded-2xl border border-stone-300/75 bg-[linear-gradient(180deg,rgba(252,250,247,0.985)_0%,rgba(244,241,236,0.985)_100%)] shadow-[0_24px_48px_-26px_rgba(120,113,108,0.55),0_16px_30px_-18px_rgba(15,23,42,0.28)] ring-1 ring-white/70 backdrop-blur-xl dark:border-stone-600/70 dark:bg-[linear-gradient(180deg,rgba(39,37,34,0.97)_0%,rgba(24,24,23,0.985)_100%)] dark:shadow-[0_24px_48px_-26px_rgba(0,0,0,0.72),0_16px_30px_-18px_rgba(0,0,0,0.42)] dark:ring-stone-500/20';
  const dividerClass = 'border-stone-200/80 dark:border-stone-700/80';
  const hoverItemClass = 'hover:bg-stone-200/35 dark:hover:bg-stone-800/55';
  const activeItemClass = 'bg-stone-200/55 dark:bg-stone-800/72';
  const mutedLabelClass = 'text-[11px] leading-none text-stone-500 dark:text-stone-400 mb-0.5';
  const togglePanel = (nextPanel: ContextMenuPanel) => {
    setPanel((currentPanel) =>
      currentPanel === nextPanel ? null : nextPanel,
    );
  };

  return (
    <div
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-40"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -4 }}
        transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
        className={menuSurfaceClass}
      >
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-amber-300/70 via-stone-200/70 to-sky-200/60 dark:from-amber-300/25 dark:via-stone-500/20 dark:to-sky-300/25" />
        <div className={`bg-stone-100/70 px-3.5 pt-3 pb-2.5 border-b dark:bg-stone-800/30 ${dividerClass}`}>
          <div className="flex items-start gap-2 justify-between">
            <p className="truncate text-[13px] font-semibold leading-snug text-stone-800 dark:text-stone-100">
              {task.projectName}
            </p>
            <span className="mt-0.5 shrink-0 rounded-md border border-stone-200/80 bg-stone-50/85 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-stone-500 dark:border-stone-700/80 dark:bg-stone-900/60 dark:text-stone-400">
              #{task.projectId}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-stone-400 dark:text-stone-500 truncate">
            {task.id}
          </p>
        </div>

        {actionError && (
          <div className="mx-3.5 mt-3 rounded-xl border border-red-200/80 bg-red-50/90 px-3 py-2.5 text-red-700 shadow-sm dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold leading-4">操作未完成</p>
                <p className="mt-1 text-[11px] leading-5" aria-live="polite">
                  {actionError}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="py-1">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={panel === 'status'}
            onClick={() => togglePanel('status')}
            className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
              panel === 'status'
                ? activeItemClass
                : hoverItemClass
            }`}
          >
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${currentStatusMeta.badgeCls}`}
            >
              <span className={`h-2 w-2 rounded-full ${currentStatusMeta.dotCls}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={mutedLabelClass}>
                任务状态
              </p>
              <p className="text-[13px] font-semibold leading-tight text-stone-700 dark:text-stone-200 truncate">
                {currentStatusMeta.label}
              </p>
            </div>
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-stone-300 transition-transform dark:text-stone-600 ${
                panel === 'status' ? 'rotate-90' : ''
              }`}
            />
          </button>

          <AnimatePresence initial={false}>
            {panel === 'status' && (
              <motion.div
                key="status-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mx-3.5 mb-2 rounded-2xl border border-stone-200/80 bg-stone-100/60 p-1 dark:border-stone-700/80 dark:bg-stone-900/45">
                  <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                    切换任务状态
                  </p>
                  <div className="max-h-56 overflow-y-auto">
                    {statusOptions.map((status) => {
                      const active = task.status === status;
                      const meta = STATUS[status];

                      return (
                        <button
                          key={status}
                          type="button"
                          disabled={statusChanging}
                          onClick={() => onStatusChange(status)}
                          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            active
                              ? activeItemClass
                              : hoverItemClass
                          } ${statusChanging ? 'opacity-50' : ''}`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotCls}`} />
                          <span
                            className={`flex-1 truncate text-[13px] ${
                              active
                                ? 'font-semibold text-stone-800 dark:text-stone-100'
                                : 'font-medium text-stone-600 dark:text-stone-300'
                            }`}
                          >
                            {meta.label}
                          </span>
                          {active && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-stone-400 dark:text-stone-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`mx-3.5 border-t ${dividerClass}`} />

          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={panel === 'taskType'}
            onClick={() => togglePanel('taskType')}
            className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
              panel === 'taskType'
                ? activeItemClass
                : hoverItemClass
            }`}
          >
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${currentTaskTypePresentation.badge}`}
            >
              <span className={`h-2 w-2 rounded-full ${currentTaskTypePresentation.dot}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={mutedLabelClass}>
                任务类型
              </p>
              <p className="text-[13px] font-semibold leading-tight text-stone-700 dark:text-stone-200 truncate">
                {currentTaskTypePresentation.label}
              </p>
            </div>
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-stone-300 transition-transform dark:text-stone-600 ${
                panel === 'taskType' ? 'rotate-90' : ''
              }`}
            />
          </button>

          <AnimatePresence initial={false}>
            {panel === 'taskType' && (
              <motion.div
                key="task-type-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="mx-3.5 mb-2 rounded-2xl border border-stone-200/80 bg-stone-100/60 p-1 dark:border-stone-700/80 dark:bg-stone-900/45">
                  <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                    切换任务类型
                  </p>
                  <div className="max-h-56 overflow-y-auto">
                    {availableTaskTypes.map((taskType) => {
                      const presentation = getTaskTypePresentation(taskType);
                      const active = presentation.value === currentTaskType;

                      return (
                        <button
                          key={presentation.value}
                          type="button"
                          disabled={taskTypeChanging}
                          onClick={() => onTaskTypeChange(presentation.value)}
                          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            active
                              ? activeItemClass
                              : hoverItemClass
                          } ${taskTypeChanging ? 'opacity-50' : ''}`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${presentation.dot}`} />
                          <span
                            className={`flex-1 truncate text-[13px] ${
                              active
                                ? 'font-semibold text-stone-800 dark:text-stone-100'
                                : 'font-medium text-stone-600 dark:text-stone-300'
                            }`}
                          >
                            {presentation.label}
                          </span>
                          {active && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-stone-400 dark:text-stone-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {onQuickAiReview && (
            <>
              <div className={`mx-3.5 my-1 border-t ${dividerClass}`} />

              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={panel === 'quickExecute'}
                onClick={() => togglePanel('quickExecute')}
                className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
                  panel === 'quickExecute' ? activeItemClass : hoverItemClass
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-200/80 bg-sky-50/85 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
                  <PlayCircle className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={mutedLabelClass}>
                    快捷执行
                  </p>
                  <p className="text-[13px] font-semibold leading-tight text-stone-700 dark:text-stone-200 truncate">
                    {childDirectoriesLoading
                      ? '加载目录中…'
                      : childDirectories.length > 0
                        ? `AI 复审 · ${childDirectories.length} 个目录`
                        : '没有可选目录'}
                  </p>
                </div>
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-stone-300 transition-transform dark:text-stone-600 ${
                    panel === 'quickExecute' ? 'rotate-90' : ''
                  }`}
                />
              </button>

              <AnimatePresence initial={false}>
                {panel === 'quickExecute' && (
                  <motion.div
                    key="quick-execute-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="mx-3.5 mb-2 rounded-2xl border border-stone-200/80 bg-stone-100/60 p-1 dark:border-stone-700/80 dark:bg-stone-900/45">
                      <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                        选择子文件夹后直接发起 AI 复审
                      </p>
                      {childDirectoriesLoading ? (
                        <p className="px-2.5 py-3 text-[12px] text-stone-500 dark:text-stone-400">
                          子文件夹加载中…
                        </p>
                      ) : childDirectories.length === 0 ? (
                        <div className="px-2.5 py-3">
                          <p className="text-[12px] leading-6 text-stone-500 dark:text-stone-400">
                            当前题卡目录下没有可用子文件夹。先完成领题 Clone，或检查任务目录是否存在。
                          </p>
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-y-auto">
                          {childDirectories.map((directory) => {
                            const submitting = quickActionLoadingPath === directory.path;
                            const detailText = directory.isSource
                              ? '源码目录'
                              : directory.modelName?.trim()
                                ? `映射模型 ${directory.modelName}`
                                : '直接按目录复审';
                            return (
                              <button
                                key={directory.path}
                                type="button"
                                disabled={submitting || !directory.path}
                                onClick={() => onQuickAiReview(directory)}
                                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
                                  hoverItemClass
                                } ${submitting || !directory.path ? 'opacity-50' : ''}`}
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-200/80 bg-sky-50/85 text-[11px] font-semibold text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
                                  AI
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">
                                    {directory.name}
                                  </p>
                                  <p className="truncate text-[11px] text-stone-500 dark:text-stone-400">
                                    {detailText}
                                  </p>
                                </div>
                                <span className="shrink-0 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                                  {submitting ? '提交中…' : '执行'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          <div className={`mx-3.5 my-1 border-t ${dividerClass}`} />

          {/* ── 生成提示词 ── */}
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={panel === 'promptGen'}
            onClick={() => togglePanel('promptGen')}
            className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
              panel === 'promptGen' ? activeItemClass : hoverItemClass
            }`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-indigo-200/80 bg-indigo-50/85 text-indigo-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Wand2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-tight text-stone-700 dark:text-stone-200 truncate">
                生成提示词
              </p>
            </div>
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-stone-300 transition-transform dark:text-stone-600 ${
                panel === 'promptGen' ? '-rotate-90' : ''
              }`}
            />
          </button>

          {/* Fly-out panel rendered via portal to avoid clipping / height inflation */}
          {panel === 'promptGen' &&
            createPortal(
              (() => {
                const flyW = 256;
                const flyH = 364;
                const mainMenuW = 280;
                const gap = 8;
                const leftX = position.x - flyW - gap;
                const flyX = leftX >= 12 ? leftX : position.x + mainMenuW + gap;
                const flyY = Math.min(
                  Math.max(12, position.y),
                  window.innerHeight - flyH - 12,
                );
                return (
                  <AnimatePresence>
                    <motion.div
                      key="prompt-gen-flyout"
                      initial={{ opacity: 0, x: leftX >= 12 ? 8 : -8, scale: 0.97 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: leftX >= 12 ? 8 : -8, scale: 0.97 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      data-prompt-gen-flyout=""
                      style={{ left: flyX, top: flyY, width: flyW }}
                      className="fixed z-50 rounded-2xl border border-stone-300/75 bg-[linear-gradient(180deg,rgba(252,250,247,0.985)_0%,rgba(244,241,236,0.985)_100%)] shadow-[0_24px_48px_-26px_rgba(120,113,108,0.55),0_16px_30px_-18px_rgba(15,23,42,0.28)] ring-1 ring-white/70 backdrop-blur-xl dark:border-stone-600/70 dark:bg-[linear-gradient(180deg,rgba(39,37,34,0.97)_0%,rgba(24,24,23,0.985)_100%)] dark:shadow-[0_24px_48px_-26px_rgba(0,0,0,0.72),0_16px_30px_-18px_rgba(0,0,0,0.42)] dark:ring-stone-500/20"
                    >
                      <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-indigo-300/60 via-stone-200/50 to-sky-200/50 dark:from-indigo-400/20 dark:via-stone-500/15 dark:to-sky-300/20" />
                      <div className="px-3.5 pt-3 pb-2.5">
                        <p className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 mb-2">
                          生成配置
                        </p>

                        {/* Task type (read-only) */}
                        <div className="mb-2">
                          <p className="text-[10px] text-stone-400 dark:text-stone-500 mb-0.5">任务类型</p>
                          <p className="text-[12px] font-semibold text-stone-700 dark:text-stone-200">
                            {normalizeTaskTypeName(task.taskType) || task.taskType || '未设置'}
                          </p>
                        </div>

                        <div className="border-t border-stone-200/60 dark:border-stone-700/60 my-2" />

                        {/* Constraint types (multi-select) */}
                        <div className="mb-2">
                          <p className="text-[10px] text-stone-400 dark:text-stone-500 mb-1.5">约束类型（可多选）</p>
                          <div className="space-y-1.5">
                            {CONSTRAINT_TYPES.map((opt) => (
                              <label
                                key={opt.value}
                                className="flex items-center gap-2 cursor-default"
                              >
                                <input
                                  type="checkbox"
                                  checked={menuConstraints.includes(opt.value)}
                                  onChange={() => toggleMenuConstraint(opt.value)}
                                  className="w-3 h-3 accent-indigo-600 cursor-default shrink-0"
                                />
                                <span className="text-[12px] text-stone-600 dark:text-stone-300">
                                  {opt.label}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="border-t border-stone-200/60 dark:border-stone-700/60 my-2" />

                        {/* Scope (single-select) */}
                        <div className="mb-3">
                          <p className="text-[10px] text-stone-400 dark:text-stone-500 mb-1.5">修改范围（单选）</p>
                          <div className="space-y-1.5">
                            {SCOPE_TYPES.map((opt) => (
                              <label
                                key={opt.value}
                                className="flex items-center gap-2 cursor-default"
                              >
                                <input
                                  type="radio"
                                  name={`menu-scope-${task.id}`}
                                  value={opt.value}
                                  checked={menuScope === opt.value}
                                  onChange={() => handleMenuScopeChange(opt.value)}
                                  className="w-3 h-3 accent-indigo-600 cursor-default shrink-0"
                                />
                                <span className="text-[12px] text-stone-600 dark:text-stone-300">
                                  {opt.label}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Generate button */}
                        <button
                          type="button"
                          disabled={!menuScope}
                          onClick={() => onGeneratePrompt(menuConstraints, menuScope)}
                          className="w-full py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-[12px] font-semibold transition-colors cursor-default"
                        >
                          开始生成
                        </button>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                );
              })(),
              document.body,
            )}

          <div className={`mx-3.5 my-1 border-t ${dividerClass}`} />

          <button
            type="button"
            disabled={localFolderOpening}
            onClick={onOpenLocalFolder}
            className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-pointer ${
              localFolderOpening
                ? 'opacity-60'
                : hoverItemClass
            }`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-200/80 bg-amber-50/85 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <FolderOpen className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-tight text-stone-700 dark:text-stone-200 truncate">
                {localFolderOpening ? '正在打开本地文件夹…' : '在本地文件夹中打开'}
              </p>
            </div>
          </button>

        </div>
      </motion.div>
    </div>
  );
}
