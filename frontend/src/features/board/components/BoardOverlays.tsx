import { useEffect, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, FolderOpen, X } from 'lucide-react';
import type { Task, TaskStatus } from '../../../store';
import {
  getTaskTypePresentation,
  normalizeTaskTypeName,
} from '../../../api/config';
import type {
  ExtractTaskSessionCandidate,
  ModelRunFromDB,
} from '../../../api/task';
import {
  matchKindLabel,
  resolveCandidateModelName,
} from '../../../shared/lib/sessionCandidateUtils';
import { STATUS } from './BoardPresentation';

type ContextMenuPanel = 'status' | 'taskType';

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
                        {candidate.userId && (
                          <span className="px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-500/10 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                            用户 {candidate.userId}
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
  localFolderError,
  onOpenLocalFolder,
  onStatusChange,
  onTaskTypeChange,
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
  localFolderError: string;
  onOpenLocalFolder: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onTaskTypeChange: (taskType: string) => void;
}) {
  const [panel, setPanel] = useState<ContextMenuPanel | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const currentTaskType = normalizeTaskTypeName(task.taskType) || task.taskType;
  const currentStatusMeta = STATUS[task.status];
  const currentTaskTypePresentation = getTaskTypePresentation(currentTaskType);
  const submenuOpensLeft = position.x + 256 + 8 + 256 > window.innerWidth - 12;
  const menuSurfaceClass =
    'relative w-[256px] overflow-hidden rounded-2xl border border-stone-300/75 bg-[linear-gradient(180deg,rgba(252,250,247,0.985)_0%,rgba(244,241,236,0.985)_100%)] shadow-[0_24px_48px_-26px_rgba(120,113,108,0.55),0_16px_30px_-18px_rgba(15,23,42,0.28)] ring-1 ring-white/70 backdrop-blur-xl dark:border-stone-600/70 dark:bg-[linear-gradient(180deg,rgba(39,37,34,0.97)_0%,rgba(24,24,23,0.985)_100%)] dark:shadow-[0_24px_48px_-26px_rgba(0,0,0,0.72),0_16px_30px_-18px_rgba(0,0,0,0.42)] dark:ring-stone-500/20';
  const dividerClass = 'border-stone-200/80 dark:border-stone-700/80';
  const hoverItemClass = 'hover:bg-stone-200/35 dark:hover:bg-stone-800/55';
  const activeItemClass = 'bg-stone-200/55 dark:bg-stone-800/72';
  const mutedLabelClass = 'text-[11px] leading-none text-stone-500 dark:text-stone-400 mb-0.5';

  const clearOpenTimer = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openPanelImmediately = (nextPanel: ContextMenuPanel) => {
    clearOpenTimer();
    clearCloseTimer();
    setPanel(nextPanel);
  };

  const schedulePanelOpen = (nextPanel: ContextMenuPanel) => {
    clearCloseTimer();
    clearOpenTimer();
    if (panel === nextPanel) {
      return;
    }
    openTimerRef.current = window.setTimeout(() => {
      setPanel(nextPanel);
      openTimerRef.current = null;
    }, panel === null ? 160 : 90);
  };

  const schedulePanelClose = () => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setPanel(null);
      closeTimerRef.current = null;
    }, 140);
  };

  const closePanelImmediately = () => {
    clearOpenTimer();
    clearCloseTimer();
    setPanel(null);
  };

  useEffect(() => () => {
    clearOpenTimer();
    clearCloseTimer();
  }, []);

  const submenuPositionClass = submenuOpensLeft ? 'right-[calc(100%+8px)]' : 'left-[calc(100%+8px)]';

  const submenuTitle = panel === 'status' ? '切换任务状态' : '切换任务类型';

  return (
    <div
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-40"
      onMouseEnter={clearCloseTimer}
      onMouseLeave={schedulePanelClose}
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

        <div className="py-1">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={panel === 'status'}
            onMouseEnter={() => schedulePanelOpen('status')}
            onFocus={() => openPanelImmediately('status')}
            onClick={() => openPanelImmediately('status')}
            className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-default ${
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
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-300 dark:text-stone-600" />
          </button>

          <div className={`mx-3.5 border-t ${dividerClass}`} />

          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={panel === 'taskType'}
            onMouseEnter={() => schedulePanelOpen('taskType')}
            onFocus={() => openPanelImmediately('taskType')}
            onClick={() => openPanelImmediately('taskType')}
            className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-default ${
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
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-300 dark:text-stone-600" />
          </button>

          <div className={`mx-3.5 my-1 border-t ${dividerClass}`} />

          <button
            type="button"
            disabled={localFolderOpening}
            onMouseEnter={closePanelImmediately}
            onFocus={closePanelImmediately}
            onClick={onOpenLocalFolder}
            className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors cursor-default ${
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

          {localFolderError && (
            <p className="px-3.5 pb-2 pt-1 text-[11px] leading-5 text-red-500">
              {localFolderError}
            </p>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {panel !== null && (
          <motion.div
            key={panel}
            initial={{ opacity: 0, x: submenuOpensLeft ? 10 : -10, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: submenuOpensLeft ? 10 : -10, scale: 0.98 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-0 ${submenuPositionClass} ${menuSurfaceClass}`}
          >
            <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-sky-200/65 via-stone-200/70 to-amber-200/65 dark:from-sky-300/25 dark:via-stone-500/20 dark:to-amber-300/25" />
            <div className={`border-b bg-stone-100/70 px-3.5 py-2.5 dark:bg-stone-800/30 ${dividerClass}`}>
              <p className="text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                {submenuTitle}
              </p>
            </div>

            {panel === 'status' ? (
              <div className="max-h-[272px] overflow-y-auto py-1">
                {statusOptions.map((status) => {
                  const active = task.status === status;
                  const meta = STATUS[status];

                  return (
                    <button
                      key={status}
                      type="button"
                      disabled={statusChanging}
                      onClick={() => onStatusChange(status)}
                      className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors cursor-default ${
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
            ) : (
              <div className="max-h-[272px] overflow-y-auto py-1">
                {availableTaskTypes.map((taskType) => {
                  const presentation = getTaskTypePresentation(taskType);
                  const active = presentation.value === currentTaskType;

                  return (
                    <button
                      key={presentation.value}
                      type="button"
                      disabled={taskTypeChanging}
                      onClick={() => onTaskTypeChange(presentation.value)}
                      className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors cursor-default ${
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
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
