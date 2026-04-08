import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, Clock, GitBranch, CheckCircle2, CircleDashed, PlayCircle, Copy, Check,
  X, ExternalLink, Plus, Trash2, Settings, AlignJustify, Grid2X2, LayoutGrid, RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, TaskStatus, TaskType, Task } from '../store';
import { motion, AnimatePresence } from 'motion/react';
import TaskTypeQuotaEditor from '../components/TaskTypeQuotaEditor';
import {
  buildProjectTaskTypes,
  getTaskTypePresentation,
  getTaskTypeQuotaValue,
  normalizeTaskTypeName,
  normalizeProjectModels,
  parseTaskTypeQuotas,
  serializeProjectModels,
  serializeProjectTaskTypes,
  serializeTaskTypeQuotas,
  updateProject,
  type ProjectConfig,
  type TaskTypeQuotas,
} from '../services/config';
import { saveTaskPrompt } from '../services/llm';
import {
  deleteTask,
  getTask,
  listModelRuns,
  updateTaskStatus,
  updateTaskSessionList,
  type ModelRunFromDB,
  type TaskSession as TaskSessionRecord,
  type TaskFromDB,
} from '../services/task';
import {
  normalizeManagedSourceFolders,
  type NormalizeManagedSourceFoldersResult,
} from '../services/git';

/* ── Status config ── */
const STATUS: Record<TaskStatus, {
  label: string;
  dotCls: string;
  badgeCls: string;
}> = {
  Claimed:     { label: '已领题',    dotCls: 'bg-blue-500',                    badgeCls: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' },
  Downloading: { label: '下载中',    dotCls: 'bg-amber-500 animate-pulse',     badgeCls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
  Downloaded:  { label: '已下载',    dotCls: 'bg-slate-500',                   badgeCls: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700' },
  PromptReady: { label: '提示词就绪', dotCls: 'bg-violet-500',                  badgeCls: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/20' },
  Submitted:   { label: '已提交',    dotCls: 'bg-emerald-500',                 badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  Error:       { label: '错误',      dotCls: 'bg-red-500',                     badgeCls: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20' },
};

const COLUMNS: TaskStatus[] = ['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error'];

type CardSize = 'sm' | 'md' | 'lg';

type EditableTaskSession = TaskSessionRecord & {
  localId: string;
};

function createSessionDraft(
  fallbackTaskType: string,
  session?: Partial<TaskSessionRecord>,
): EditableTaskSession {
  const normalizedTaskType =
    normalizeTaskTypeName(session?.taskType ?? '') ||
    normalizeTaskTypeName(fallbackTaskType) ||
    'Feature迭代';

  return {
    localId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId: session?.sessionId ?? '',
    taskType: normalizedTaskType,
    consumeQuota: session?.consumeQuota ?? false,
  };
}

function hydrateSessionDrafts(
  sessionList: TaskSessionRecord[] | null | undefined,
  fallbackTaskType: string,
): EditableTaskSession[] {
  const source =
    sessionList && sessionList.length > 0
      ? sessionList
      : [{ sessionId: '', taskType: fallbackTaskType, consumeQuota: true }];

  return source.map((session, index) =>
    createSessionDraft(fallbackTaskType, {
      ...session,
      consumeQuota: index === 0 || session.consumeQuota,
    }),
  );
}

export default function Board() {
  const navigate = useNavigate();
  const tasks                  = useAppStore(s => s.tasks);
  const loadTasks              = useAppStore(s => s.loadTasks);
  const removeTaskFromStore    = useAppStore(s => s.removeTask);
  const activeProject          = useAppStore(s => s.activeProject);
  const setActiveProject       = useAppStore(s => s.setActiveProject);
  const loadActiveProject      = useAppStore(s => s.loadActiveProject);
  const updateTaskStatusInStore = useAppStore(s => s.updateTaskStatus);
  const updateTaskTypeInStore = useAppStore(s => s.updateTaskType);
  const sourceModelName = activeProject?.sourceModelFolder?.trim() || 'ORIGIN';
  const availableTaskTypes = useMemo(
    () => buildProjectTaskTypes(activeProject, tasks.map((task) => task.taskType)),
    [activeProject, tasks],
  );
  const projectQuotas = useMemo(
    () => parseTaskTypeQuotas(activeProject?.taskTypeQuotas),
    [activeProject?.taskTypeQuotas],
  );

  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [showProjectOverview, setShowProjectOverview] = useState(false);
  const [search, setSearch]           = useState('');
  const [activeTypes, setActiveTypes]   = useState<Set<TaskType>>(new Set());
  const [activeStages, setActiveStages] = useState<Set<TaskStatus>>(new Set());
  const [cardSize, setCardSize]         = useState<CardSize>('md');
  const [selected, setSelected]       = useState<Task | null>(null);
  const [pendingDelete, setPendingDelete]     = useState<Task | null>(null);
  const [deleting, setDeleting]   = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskFromDB | null>(null);
  const [selectedModelRuns, setSelectedModelRuns]   = useState<ModelRunFromDB[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError]     = useState('');
  const [statusChanging, setStatusChanging] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaveState, setPromptSaveState] = useState<'idle' | 'saved'>('idle');
  const [promptCopied, setPromptCopied] = useState(false);
  const [sessionListDraft, setSessionListDraft] = useState<EditableTaskSession[]>([]);
  const [sessionListSaving, setSessionListSaving] = useState(false);
  const [sessionSaveState, setSessionSaveState] = useState<'idle' | 'saved'>('idle');

  const sessionTaskTypeOptions = useMemo(
    () =>
      buildProjectTaskTypes(activeProject, [
        ...tasks.map((task) => task.taskType),
        ...sessionListDraft.map((session) => session.taskType),
      ]),
    [activeProject, sessionListDraft, tasks],
  );

  const toggleType = (id: TaskType) =>
    setActiveTypes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleStage = (id: TaskStatus) =>
    setActiveStages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const hasFilters = activeTypes.size > 0 || activeStages.size > 0 || search.length > 0;
  const clearFilters = () => { setActiveTypes(new Set()); setActiveStages(new Set()); setSearch(''); };

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { loadActiveProject(); }, [loadActiveProject]);

  useEffect(() => {
    if (!selected?.id) {
      setSelectedTaskDetail(null);
      setSelectedModelRuns([]);
      setDrawerError('');
      setPromptDraft('');
      setSessionListDraft([]);
      setSessionSaveState('idle');
      setPromptSaveState('idle');
      return;
    }
    let cancelled = false;
    setDrawerLoading(true);
    setDrawerError('');
    (async () => {
      const [taskDetail, modelRuns] = await Promise.all([getTask(selected.id), listModelRuns(selected.id)]);
      if (cancelled) return;
      setSelectedTaskDetail(taskDetail);
      setPromptDraft(taskDetail?.promptText ?? '');
      setSessionListDraft(
        hydrateSessionDrafts(taskDetail?.sessionList, taskDetail?.taskType ?? selected.taskType),
      );
      setSessionSaveState('idle');
      setPromptSaveState('idle');
      setPromptCopied(false);
      setSelectedModelRuns(modelRuns);
      setDrawerLoading(false);
    })().catch((error) => {
      if (cancelled) return;
      setDrawerError(error instanceof Error ? error.message : '详情加载失败');
      setDrawerLoading(false);
    });
    return () => { cancelled = true; };
  }, [selected?.id]);

  useEffect(() => {
    const allowedTaskTypes = new Set(availableTaskTypes);
    setActiveTypes((prev) => {
      const next = new Set([...prev].filter((taskType) => allowedTaskTypes.has(taskType)));
      if (next.size === prev.size && [...next].every((taskType) => prev.has(taskType))) {
        return prev;
      }
      return next;
    });
  }, [availableTaskTypes]);

  const filtered = useMemo(() => tasks.filter(t => {
    const matchSearch = !search ||
      t.projectName.toLowerCase().includes(search.toLowerCase()) ||
      t.projectId.includes(search) ||
      t.id.toLowerCase().includes(search.toLowerCase());
    const matchType  = activeTypes.size === 0 || activeTypes.has(t.taskType);
    const matchStage = activeStages.size === 0 || activeStages.has(t.status);
    return matchSearch && matchType && matchStage;
  }), [tasks, search, activeTypes, activeStages]);

  const projectTaskSummaries = useMemo(
    () =>
      availableTaskTypes.map((taskType) => {
        const matchingTasks = tasks.filter(
          (task) => normalizeTaskTypeName(task.taskType) === taskType,
        );

        return {
          taskType,
          remainingQuota: getTaskTypeQuotaValue(projectQuotas, taskType),
          waitingTasks: matchingTasks.filter((task) => task.status === 'Claimed'),
          processingTasks: matchingTasks.filter((task) =>
            task.status === 'Downloading' || task.status === 'Downloaded' || task.status === 'PromptReady',
          ),
          submittedTasks: matchingTasks.filter((task) => task.status === 'Submitted'),
          errorTasks: matchingTasks.filter((task) => task.status === 'Error'),
        };
      }),
    [availableTaskTypes, projectQuotas, tasks],
  );

  const visibleProjectTaskSummaries = useMemo(
    () =>
      projectTaskSummaries.filter((summary) =>
        summary.remainingQuota !== null ||
        summary.waitingTasks.length > 0 ||
        summary.processingTasks.length > 0 ||
        summary.submittedTasks.length > 0 ||
        summary.errorTasks.length > 0,
      ),
    [projectTaskSummaries],
  );

  const gridClass: Record<CardSize, string> = {
    sm: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
    md: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    lg: 'grid-cols-1 sm:grid-cols-2',
  };

  const handleDeleteTask = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteTask(pendingDelete.id);
      removeTaskFromStore(pendingDelete.id);
      if (selected?.id === pendingDelete.id) setSelected(null);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除题卡失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    setStatusChanging(true);
    try {
      await updateTaskStatus(taskId, newStatus);
      updateTaskStatusInStore(taskId, newStatus);
      setSelected(prev => prev ? { ...prev, status: newStatus } : null);
      setSelectedTaskDetail(prev => prev ? { ...prev, status: newStatus } : null);
    } catch (err) {
      console.error('Failed to update task status:', err);
    } finally {
      setStatusChanging(false);
    }
  };

  const handlePromptSave = async () => {
    if (!selected?.id) return;
    if (!promptDraft.trim()) {
      setDrawerError('提示词不能为空');
      return;
    }

    setPromptSaving(true);
    setDrawerError('');
    try {
      await saveTaskPrompt(selected.id, promptDraft);
      setSelectedTaskDetail((prev) => prev ? { ...prev, promptText: promptDraft, status: 'PromptReady' } : prev);
      setSelected((prev) => prev ? { ...prev, status: 'PromptReady' } : prev);
      updateTaskStatusInStore(selected.id, 'PromptReady');
      setPromptSaveState('saved');
      await loadTasks();
      window.setTimeout(() => setPromptSaveState('idle'), 1600);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : '提示词保存失败');
    } finally {
      setPromptSaving(false);
    }
  };

  const handlePromptCopy = async () => {
    if (!promptDraft.trim()) return;
    await navigator.clipboard.writeText(promptDraft);
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1500);
  };

  const handleAddSession = () => {
    const fallbackTaskType =
      sessionListDraft[sessionListDraft.length - 1]?.taskType ||
      selectedTaskDetail?.taskType ||
      selected?.taskType ||
      availableTaskTypes[0] ||
      'Feature迭代';

    setSessionListDraft((prev) => [
      ...prev,
      createSessionDraft(fallbackTaskType, {
        taskType: fallbackTaskType,
        consumeQuota: false,
      }),
    ]);
    setSessionSaveState('idle');
  };

  const handleSessionChange = (
    localId: string,
    patch: Partial<Pick<EditableTaskSession, 'sessionId' | 'taskType' | 'consumeQuota'>>,
  ) => {
    setSessionListDraft((prev) =>
      prev.map((session, index) => {
        if (session.localId !== localId) return session;
        return {
          ...session,
          ...patch,
          consumeQuota: index === 0 ? true : (patch.consumeQuota ?? session.consumeQuota),
        };
      }),
    );
    setSessionSaveState('idle');
  };

  const handleRemoveSession = (localId: string) => {
    setSessionListDraft((prev) =>
      prev
        .filter((session) => session.localId !== localId)
        .map((session, index) => (index === 0 ? { ...session, consumeQuota: true } : session)),
    );
    setSessionSaveState('idle');
  };

  const handleResetSessions = () => {
    const fallbackTaskType = selectedTaskDetail?.taskType ?? selected?.taskType ?? availableTaskTypes[0] ?? 'Feature迭代';
    setSessionListDraft(hydrateSessionDrafts(selectedTaskDetail?.sessionList, fallbackTaskType));
    setSessionSaveState('idle');
  };

  const handleSessionListSave = async () => {
    if (!selected?.id) return;
    if (sessionListDraft.length === 0) {
      setDrawerError('至少保留一个 session');
      return;
    }

    const nextSessionList: TaskSessionRecord[] = sessionListDraft.map((session, index) => ({
      sessionId: session.sessionId.trim(),
      taskType: normalizeTaskTypeName(session.taskType) || selected.taskType,
      consumeQuota: index === 0 || session.consumeQuota,
    }));

    setSessionListSaving(true);
    setDrawerError('');
    try {
      await updateTaskSessionList({
        id: selected.id,
        sessionList: nextSessionList,
      });

      const nextTaskType = nextSessionList[0]?.taskType ?? selected.taskType;
      updateTaskTypeInStore(selected.id, nextTaskType);
      setSelected((prev) => (prev ? { ...prev, taskType: nextTaskType } : prev));
      setSelectedTaskDetail((prev) =>
        prev ? { ...prev, taskType: nextTaskType, sessionList: nextSessionList } : prev,
      );
      setSessionListDraft(hydrateSessionDrafts(nextSessionList, nextTaskType));
      setSessionSaveState('saved');
      await Promise.all([loadTasks(), loadActiveProject()]);
      window.setTimeout(() => setSessionSaveState('idle'), 1600);
    } catch (error) {
      setDrawerError(error instanceof Error ? error.message : 'session 保存失败');
    } finally {
      setSessionListSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Sticky header ─────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-stone-50 dark:bg-[#161615] px-8 pt-6 pb-4 border-b border-stone-200 dark:border-stone-800">

        {/* Row 1: search + controls */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="搜索项目名称或 ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-8 py-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400 dark:placeholder:text-stone-600"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-default">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <span className="text-sm text-stone-400 dark:text-stone-500 font-medium tabular-nums ml-auto">
            {filtered.length} / {tasks.length}
          </span>

          {/* Card size toggle */}
          <div className="flex items-center gap-0.5 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl p-1">
            {([
              { size: 'sm' as CardSize, icon: AlignJustify, title: '紧凑' },
              { size: 'md' as CardSize, icon: Grid2X2,      title: '标准' },
              { size: 'lg' as CardSize, icon: LayoutGrid,   title: '宽松' },
            ]).map(({ size, icon: Icon, title }) => (
              <button
                key={size}
                title={title}
                onClick={() => setCardSize(size)}
                className={`p-2 rounded-xl transition-all cursor-default ${
                  cardSize === size
                    ? 'bg-[#111827] dark:bg-[#E5EAF2] text-white dark:text-[#0D1117] shadow-sm'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800'
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowProjectPanel(true)}
            className="p-2 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors cursor-default"
            title="项目配置"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowProjectOverview(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors shadow-sm cursor-default"
          >
            <LayoutGrid className="w-4 h-4" />
            查看项目概况
          </button>
        </div>

        {/* Row 2: task type filter chips */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 w-14 flex-shrink-0">类型</span>
          {availableTaskTypes.map((taskType) => {
            const presentation = getTaskTypePresentation(taskType);
            const active = activeTypes.has(presentation.value);
            return (
              <button
                key={presentation.value}
                onClick={() => toggleType(presentation.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-default ${
                  active
                    ? `${presentation.badge} shadow-sm scale-[1.02]`
                    : 'bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? presentation.dot : 'bg-stone-300 dark:bg-stone-600'}`} />
                {presentation.label}
              </button>
            );
          })}
        </div>

        {/* Row 3: stage filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 w-14 flex-shrink-0">阶段</span>
          {COLUMNS.map(status => {
            const cfg    = STATUS[status];
            const count  = tasks.filter(t => t.status === status).length;
            const active = activeStages.has(status);
            return (
              <button
                key={status}
                onClick={() => toggleStage(status)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-default ${
                  active
                    ? `${cfg.badgeCls} shadow-sm scale-[1.02]`
                    : 'bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? cfg.dotCls : 'bg-stone-300 dark:bg-stone-600'}`} />
                {cfg.label}
                <span className={`tabular-nums font-bold ${active ? 'opacity-75' : 'text-stone-400 dark:text-stone-500'}`}>{count}</span>
              </button>
            );
          })}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-all cursor-default"
            >
              <X className="w-3 h-3" />
              清除
            </button>
          )}
        </div>
      </div>

      {/* ── Card grid ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center mb-4">
              <Search className="w-5 h-5 text-stone-300 dark:text-stone-600" />
            </div>
            <p className="text-sm font-semibold text-stone-500 dark:text-stone-400 mb-1">没有匹配的任务</p>
            <p className="text-xs text-stone-400 dark:text-stone-500">试试调整筛选条件</p>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 px-4 py-2 text-xs font-semibold text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-colors cursor-default"
              >
                清除所有筛选
              </button>
            )}
          </div>
        ) : (
          <motion.div layout className={`grid gap-3 ${gridClass[cardSize]}`}>
            <AnimatePresence mode="popLayout">
              {filtered.map(task => (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                >
                  <TaskCard
                    task={task}
                    size={cardSize}
                    onClick={() => setSelected(task)}
                    onDelete={() => { setDeleteError(''); setPendingDelete(task); }}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* ── Modals + Drawers ──────────────────────────── */}
      <AnimatePresence>

        {showProjectOverview && activeProject && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProjectOverview(false)}
              className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
            />
            <ProjectOverviewPanel
              project={activeProject}
              summaries={visibleProjectTaskSummaries}
              taskCount={tasks.length}
              onClose={() => setShowProjectOverview(false)}
              onNormalized={loadTasks}
              onSelectTask={(task) => {
                setShowProjectOverview(false);
                setSelected(task);
              }}
            />
          </>
        )}

        {showProjectOverview && !activeProject && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProjectOverview(false)}
              className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
            />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-[520px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
            >
              <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">项目概况</h2>
                <button onClick={() => setShowProjectOverview(false)} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">暂无激活项目，请先在设置中创建并激活项目</div>
            </motion.aside>
          </>
        )}

        {/* Delete confirm */}
        {pendingDelete && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (deleting) return; setPendingDelete(null); setDeleteError(''); }}
              className="fixed inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6"
            >
              <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">确认删除题卡</h2>
                <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">将删除「{pendingDelete.projectName}」的题卡、关联模型记录，以及本地对比目录中的文件。此操作不可撤销。</p>
                {deleteError && <p className="mt-3 text-sm text-red-500">{deleteError}</p>}
                <div className="mt-6 flex justify-end gap-3">
                  <button onClick={() => { if (deleting) return; setPendingDelete(null); setDeleteError(''); }} className="px-4 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-700 dark:text-stone-300 cursor-default">取消</button>
                  <button onClick={handleDeleteTask} disabled={deleting} className="px-4 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 cursor-default">
                    {deleting ? '删除中...' : '确认删除'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}

        {/* Task detail drawer */}
        {selected && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelected(null)} className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20" />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
            >
              <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS[selected.status].dotCls}`} />
                    <select
                      value={selected.status}
                      disabled={statusChanging}
                      onChange={e => handleStatusChange(selected.id, e.target.value as TaskStatus)}
                      className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border-0 outline-none cursor-default appearance-none ${STATUS[selected.status].badgeCls} disabled:opacity-60`}
                    >
                      {COLUMNS.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
                    </select>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${getTaskTypePresentation(selected.taskType).badge}`}>
                      {getTaskTypePresentation(selected.taskType).label}
                    </span>
                    <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">
                      {sessionListDraft.length || 1} 个 session
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight truncate">{selected.projectName}</h2>
                  <p className="text-xs font-mono text-stone-400 mt-0.5">#{selected.projectId} · {selected.id}</p>
                </div>
                <button onClick={() => setSelected(null)} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 flex-shrink-0 cursor-default">
                  <X className="w-4 h-4" />
                </button>
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
                      <InfoCard label="项目 ID" value={selected.projectId} mono />
                      <InfoCard label="创建时间" value={new Date(selected.createdAt * 1000).toLocaleString('zh-CN')} />
                    </div>

                    <div className="rounded-2xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-8">
                      <div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between gap-3">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">Session 列表</span>
                          <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">第一个 session 固定扣减任务总数，后续按需勾选。</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {sessionSaveState === 'saved' && (
                            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">已保存</span>
                          )}
                          <button
                            onClick={handleAddSession}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-100 dark:bg-stone-700 text-[11px] font-semibold text-stone-600 dark:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-600 transition-colors cursor-default"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            新增 session
                          </button>
                        </div>
                      </div>
                      <div className="px-4 py-4 bg-white dark:bg-stone-900">
                        <div className="space-y-3">
                          {sessionListDraft.map((session, index) => {
                            const presentation = getTaskTypePresentation(session.taskType);
                            const remainingQuota = getTaskTypeQuotaValue(projectQuotas, session.taskType);
                            return (
                              <div
                                key={session.localId}
                                className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-4 py-4"
                              >
                                <div className="flex items-center justify-between gap-3 mb-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                                      Session {index + 1}
                                    </span>
                                    {index === 0 && (
                                      <span className="px-2 py-0.5 rounded-full bg-stone-200 dark:bg-stone-700 text-[10px] font-semibold text-stone-600 dark:text-stone-300">
                                        主 session
                                      </span>
                                    )}
                                  </div>
                                  {index > 0 && (
                                    <button
                                      onClick={() => handleRemoveSession(session.localId)}
                                      className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-default"
                                      title="删除 session"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>

                                <label className="block mb-3">
                                  <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">sessionId</span>
                                  <input
                                    value={session.sessionId}
                                    onChange={(event) => handleSessionChange(session.localId, { sessionId: event.target.value })}
                                    placeholder="记录实际 sessionId"
                                    className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-2.5 text-sm font-mono text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                                  />
                                </label>

                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                                  <label className="block min-w-0">
                                    <span className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1.5">任务类型</span>
                                    <select
                                      value={session.taskType}
                                      onChange={(event) => handleSessionChange(session.localId, { taskType: event.target.value })}
                                      className={`w-full rounded-2xl border px-4 py-2.5 text-sm font-semibold outline-none appearance-none cursor-default ${presentation.badge}`}
                                    >
                                      {sessionTaskTypeOptions.map((taskType) => {
                                        const optionPresentation = getTaskTypePresentation(taskType);
                                        const optionQuota = getTaskTypeQuotaValue(projectQuotas, optionPresentation.value);
                                        return (
                                          <option key={optionPresentation.value} value={optionPresentation.value}>
                                            {optionPresentation.label}
                                            {optionQuota !== null ? ` · 剩余 ${optionQuota}` : ''}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </label>

                                  <label className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${
                                    session.consumeQuota
                                      ? 'border-stone-300 dark:border-stone-600 bg-stone-100 dark:bg-stone-800'
                                      : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900'
                                  }`}>
                                    <input
                                      type="checkbox"
                                      checked={index === 0 ? true : session.consumeQuota}
                                      disabled={index === 0}
                                      onChange={(event) => handleSessionChange(session.localId, { consumeQuota: event.target.checked })}
                                      className="w-4 h-4 rounded accent-slate-700 dark:accent-slate-300 cursor-default disabled:opacity-60"
                                    />
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">扣任务数</p>
                                      <p className="text-[10px] text-stone-400 dark:text-stone-500">
                                        {index === 0
                                          ? '首个 session 固定扣减'
                                          : remainingQuota !== null
                                            ? `当前剩余 ${remainingQuota}`
                                            : '当前类型不限额'}
                                      </p>
                                    </div>
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3 flex justify-end gap-3">
                          <button
                            onClick={handleResetSessions}
                            disabled={sessionListSaving}
                            className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-xs font-semibold text-stone-600 dark:text-stone-300 disabled:opacity-50 cursor-default"
                          >
                            还原
                          </button>
                          <button
                            onClick={() => void handleSessionListSave()}
                            disabled={sessionListSaving || sessionListDraft.length === 0}
                            className="px-3 py-2 rounded-xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-xs font-semibold text-white dark:text-[#0D1117] disabled:opacity-50 cursor-default"
                          >
                            {sessionListSaving ? '保存中…' : '保存 session 列表'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 提示词展示区 */}
                    <div className="rounded-2xl border border-stone-200 dark:border-stone-700 overflow-hidden mb-8">
                      <div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800/50 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">提示词</span>
                          <button
                            onClick={() => void handlePromptCopy()}
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
                        <textarea
                          value={promptDraft}
                          onChange={(event) => {
                            setPromptDraft(event.target.value);
                            setPromptSaveState('idle');
                          }}
                          rows={5}
                          placeholder="在这里直接新增或修改提示词"
                          className="w-full rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-4 py-3 text-xs leading-relaxed text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-slate-400/30 resize-y"
                        />
                        <div className="mt-3 flex justify-end gap-3">
                          <button
                            onClick={() => {
                              setPromptDraft(selectedTaskDetail?.promptText ?? '');
                              setPromptSaveState('idle');
                            }}
                            disabled={promptSaving}
                            className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-xs font-semibold text-stone-600 dark:text-stone-300 disabled:opacity-50 cursor-default"
                          >
                            还原
                          </button>
                          <button
                            onClick={() => void handlePromptSave()}
                            disabled={promptSaving || !promptDraft.trim()}
                            className="px-3 py-2 rounded-xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-xs font-semibold text-white dark:text-[#0D1117] disabled:opacity-50 cursor-default"
                          >
                            {promptSaving ? '保存中…' : '保存提示词'}
                          </button>
                        </div>
                      </div>
                    </div>

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
                          {selectedModelRuns.map(run => {
                            const p = modelRunPresentation(run.status);
                            return (
                              <div key={run.id} className="px-4 py-3 bg-stone-50 dark:bg-stone-800/50 rounded-2xl border border-stone-200 dark:border-stone-700">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2.5">
                                      <p.icon className={`w-3.5 h-3.5 flex-shrink-0 ${p.iconCls}`} />
                                      <span className="font-mono text-sm text-stone-700 dark:text-stone-300">{run.modelName}</span>
                                      {isSourceModel(run.modelName, sourceModelName) && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">源码</span>}
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${p.badgeCls}`}>{p.label}</span>
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
              </div>

              <div className="px-7 py-5 border-t border-stone-100 dark:border-stone-800 flex gap-3">
                <button onClick={() => { setSelected(null); navigate(`/prompt?taskId=${selected.id}`); }} className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-2xl text-sm font-semibold text-stone-700 dark:text-stone-300 transition-colors cursor-default">生成提示词</button>
                <button onClick={() => { setSelected(null); navigate(`/submit?taskId=${selected.id}`); }} className="flex-1 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors shadow-sm cursor-default">提交 PR</button>
              </div>
            </motion.aside>
          </>
        )}

        {/* Project panel */}
        {showProjectPanel && activeProject && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowProjectPanel(false)} className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20" />
            <ProjectPanel project={activeProject} onClose={() => setShowProjectPanel(false)} onSaved={updated => { setActiveProject(updated); setShowProjectPanel(false); }} />
          </>
        )}

        {showProjectPanel && !activeProject && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowProjectPanel(false)} className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20" />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
            >
              <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">项目配置</h2>
                <button onClick={() => setShowProjectPanel(false)} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">暂无激活项目，请先在设置中创建并激活项目</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── TaskCard ──────────────────────────────────────── */
function TaskCard({ task, size, onClick, onDelete }: { task: Task; size: CardSize; onClick: () => void; onDelete: () => void }) {
  const cfg = STATUS[task.status];
  const typePresentation = getTaskTypePresentation(task.taskType);

  if (size === 'sm') {
    return (
      <motion.div layout onClick={onClick}
        className="group bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-3.5 hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-sm transition-all cursor-default"
      >
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${cfg.dotCls}`} />
          <div className="flex items-center gap-1.5 ml-auto">
            <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold border ${cfg.badgeCls}`}>{cfg.label}</span>
            <button onClick={e => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-default">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-50 leading-snug line-clamp-1 mb-0.5">{task.projectName}</p>
        <p className="font-mono text-[11px] text-stone-400 dark:text-stone-500 mb-1.5">#{task.projectId}</p>
        <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${typePresentation.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
          {typePresentation.label}
        </span>
        {task.totalModels > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <div className="flex-1 h-1 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${task.progress === task.totalModels ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${(task.progress / task.totalModels) * 100}%` }} />
            </div>
            <span className="text-[10px] font-bold tabular-nums text-stone-400">{task.progress}/{task.totalModels}</span>
          </div>
        )}
      </motion.div>
    );
  }

  if (size === 'lg') {
    return (
      <motion.div layout onClick={onClick}
        className="group bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-sm transition-all cursor-default"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`w-2 h-2 rounded-full ${cfg.dotCls}`} />
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${cfg.badgeCls}`}>{cfg.label}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${typePresentation.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
              {typePresentation.label}
            </span>
          </div>
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-default">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="font-semibold text-base text-stone-900 dark:text-stone-50 leading-snug line-clamp-2 mb-1">{task.projectName}</p>
        <p className="font-mono text-xs text-stone-400 dark:text-stone-500 mb-4">#{task.projectId}</p>
        <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{new Date(task.createdAt * 1000).toLocaleDateString('zh-CN')}</span>
          </div>
          {task.totalModels > 0 && (
            <div className="flex items-center gap-1 font-semibold tabular-nums">
              {task.progress === task.totalModels ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : task.runningModels > 0 ? <PlayCircle className="w-3.5 h-3.5 text-amber-500" /> : <CircleDashed className="w-3.5 h-3.5" />}
              {task.progress}/{task.totalModels} 模型
            </div>
          )}
        </div>
        {task.totalModels > 0 && (
          <div className="mt-3 h-1.5 w-full bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${task.progress === task.totalModels ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${(task.progress / task.totalModels) * 100}%` }} />
          </div>
        )}
      </motion.div>
    );
  }

  // md (default)
  return (
    <motion.div layout onClick={onClick}
      className="group bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700 rounded-2xl p-4 hover:bg-white dark:hover:bg-stone-800 hover:border-stone-300 dark:hover:border-stone-600 hover:shadow-sm transition-all cursor-default"
    >
      <div className="flex items-center justify-between mb-3">
        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dotCls}`} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400 dark:text-stone-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(task.createdAt * 1000).toLocaleDateString('zh-CN')}
          </span>
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-default">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <p className="font-semibold text-sm text-stone-900 dark:text-stone-50 mb-1 leading-snug line-clamp-2">{task.projectName}</p>
      <p className="font-mono text-xs text-stone-400 dark:text-stone-500 mb-2">#{task.projectId}</p>
      <span className={`mb-4 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${typePresentation.badge}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
        {typePresentation.label}
      </span>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <GitBranch className="w-3.5 h-3.5" />
          <span className="font-mono truncate max-w-[120px]">{task.id}</span>
        </div>
        {task.totalModels > 0 && (
          <div className="flex items-center gap-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
            {task.progress === task.totalModels ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : task.runningModels > 0 ? <PlayCircle className="w-3.5 h-3.5 text-slate-500" /> : <CircleDashed className="w-3.5 h-3.5" />}
            {task.progress}/{task.totalModels}
          </div>
        )}
      </div>
      {task.status === 'Downloading' && task.totalModels > 0 && (
        <div className="mt-3 h-1 w-full bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
          <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${(task.progress / task.totalModels) * 100}%` }} />
        </div>
      )}
    </motion.div>
  );
}

/* ── Helpers ──────────────────────────────────────── */
function InfoCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
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
  if (status === 'done')    return { label: '完成',  icon: CheckCircle2, iconCls: 'text-emerald-500', badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' };
  if (status === 'running') return { label: '执行中', icon: PlayCircle,   iconCls: 'text-amber-500',  badgeCls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' };
  if (status === 'error')   return { label: '异常',   icon: X,            iconCls: 'text-red-500',    badgeCls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' };
  return { label: '待处理', icon: CircleDashed, iconCls: 'text-stone-400', badgeCls: 'bg-stone-100 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400' };
}

type TaskTypeSummary = {
  taskType: string;
  remainingQuota: number | null;
  waitingTasks: Task[];
  processingTasks: Task[];
  submittedTasks: Task[];
  errorTasks: Task[];
};

function TaskTypeOverviewCard({
  summary,
  onSelectTask,
}: {
  summary: TaskTypeSummary;
  onSelectTask: (task: Task) => void;
}) {
  const presentation = getTaskTypePresentation(summary.taskType);
  const remainingLabel = summary.remainingQuota === null ? '不限额' : `剩余 ${summary.remainingQuota}`;

  return (
    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-950/40 px-4 py-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${presentation.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
            {presentation.label}
          </span>
        </div>
        <span className="rounded-full bg-white dark:bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-800">
          {remainingLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <OverviewMetric label="待处理" value={summary.waitingTasks.length} tone="stone" />
        <OverviewMetric label="处理中" value={summary.processingTasks.length} tone="amber" />
        <OverviewMetric label="已提交" value={summary.submittedTasks.length} tone="emerald" />
        <OverviewMetric label="异常" value={summary.errorTasks.length} tone="red" />
      </div>

      <div className="space-y-3">
        <TaskGroupPreview
          label="处理中"
          tasks={summary.processingTasks}
          emptyText="当前没有执行中的题卡"
          onSelectTask={onSelectTask}
          tone="amber"
        />
        <TaskGroupPreview
          label="待处理"
          tasks={summary.waitingTasks}
          emptyText={summary.remainingQuota === 0 ? '当前没有待处理题卡' : '这个分类还没开始'}
          onSelectTask={onSelectTask}
          tone="stone"
        />
      </div>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'stone' | 'amber' | 'emerald' | 'red';
}) {
  const toneMap = {
    stone: 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400',
    amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    red: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
  } as const;

  return (
    <div className={`rounded-2xl px-3 py-2 ${toneMap[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TaskGroupPreview({
  label,
  tasks,
  emptyText,
  onSelectTask,
  tone,
}: {
  label: string;
  tasks: Task[];
  emptyText: string;
  onSelectTask: (task: Task) => void;
  tone: 'stone' | 'amber';
}) {
  const toneMap = {
    stone: 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700',
    amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20',
  } as const;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
          {label}
        </span>
        <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">
          {tasks.length}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tasks.slice(0, 4).map((task) => (
            <button
              key={task.id}
              onClick={() => onSelectTask(task)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:opacity-90 cursor-default ${toneMap[tone]}`}
            >
              {task.id}
            </button>
          ))}
          {tasks.length > 4 && (
            <span className="rounded-full border border-stone-200 dark:border-stone-700 px-2.5 py-1 text-[11px] text-stone-400 dark:text-stone-500">
              +{tasks.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectOverviewPanel({
  project,
  summaries,
  taskCount,
  onClose,
  onNormalized,
  onSelectTask,
}: {
  project: ProjectConfig;
  summaries: TaskTypeSummary[];
  taskCount: number;
  onClose: () => void;
  onNormalized: () => Promise<void>;
  onSelectTask: (task: Task) => void;
}) {
  const modelList = normalizeProjectModels(project.models);
  const totalInFlight = summaries.reduce(
    (count, summary) => count + summary.waitingTasks.length + summary.processingTasks.length,
    0,
  );
  const [normalizing, setNormalizing] = useState(false);
  const [normalizeError, setNormalizeError] = useState('');
  const [normalizeResult, setNormalizeResult] = useState<NormalizeManagedSourceFoldersResult | null>(null);

  const handleNormalize = async () => {
    setNormalizing(true);
    setNormalizeError('');
    try {
      const result = await normalizeManagedSourceFolders(project.id);
      setNormalizeResult(result);
      await onNormalized();
    } catch (error) {
      setNormalizeError(error instanceof Error ? error.message : '归一处理失败');
    } finally {
      setNormalizing(false);
    }
  };

  return (
    <motion.aside
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className="fixed top-0 right-0 bottom-0 w-[560px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
    >
      <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-stone-400 dark:text-stone-500">项目概况</p>
          <h2 className="mt-1 text-lg font-bold text-stone-900 dark:text-stone-50">{project.name}</h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">主页恢复为题目卡片视图，项目信息集中在这里查看。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleNormalize}
            disabled={normalizing}
            title="将现有源码目录归一为 GitLab 项目名"
            className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 disabled:opacity-50 cursor-default"
          >
            <RefreshCw className={`w-4 h-4 ${normalizing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-7 space-y-6">
        <div className="rounded-3xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">源码目录归一</h3>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                默认把源码目录命名为对应 GitLab 项目名，例如 <code className="font-mono">label-00688</code>。
              </p>
            </div>
            <button
              type="button"
              onClick={handleNormalize}
              disabled={normalizing}
              className="px-3 py-2 rounded-2xl bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs font-semibold text-stone-700 dark:text-stone-300 disabled:opacity-50 cursor-default"
            >
              {normalizing ? '处理中…' : '执行归一'}
            </button>
          </div>
          {normalizeError && <p className="mt-3 text-sm text-red-500">{normalizeError}</p>}
          {normalizeResult && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-stone-500 dark:text-stone-400">
                共扫描 {normalizeResult.totalTasks} 个任务，已重命名 {normalizeResult.renamedCount}，已回写 {normalizeResult.updatedCount}，已跳过 {normalizeResult.skippedCount}，错误 {normalizeResult.errorCount}。
              </p>
              {normalizeResult.errorCount > 0 && (
                <div className="space-y-1">
                  {normalizeResult.details
                    .filter((detail) => detail.status === 'error')
                    .slice(0, 3)
                    .map((detail) => (
                      <p key={detail.taskId} className="text-xs text-red-500">
                        {detail.taskId}: {detail.message}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="题卡总数" value={String(taskCount)} />
          <InfoCard label="模型数量" value={String(modelList.length)} />
          <InfoCard label="源码模型" value={project.sourceModelFolder || 'ORIGIN'} mono />
          <InfoCard label="源码目录名" value="GitLab 项目名" />
          <InfoCard label="源码仓库" value={project.defaultSubmitRepo || '未配置'} mono />
        </div>

        <InfoCard label="本地克隆根目录" value={project.cloneBasePath} mono />

        {summaries.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">试题分配</h3>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">只展示当前有分配额度或已有流转记录的任务分类。</p>
              </div>
              <span className="rounded-2xl bg-stone-100 dark:bg-stone-800 px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
                在途 {totalInFlight}
              </span>
            </div>
            <div className="grid gap-3">
              {summaries.map((summary) => (
                <TaskTypeOverviewCard
                  key={summary.taskType}
                  summary={summary}
                  onSelectTask={onSelectTask}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}

/* ── ProjectPanel ─────────────────────────────────── */
function ProjectPanel({ project, onClose, onSaved }: { project: ProjectConfig; onClose: () => void; onSaved: (updated: ProjectConfig) => void }) {
  const [form, setForm] = useState<ProjectConfig>({ ...project });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  const [taskTypes, setTaskTypes] = useState<string[]>(() => buildProjectTaskTypes(project));
  const [quotas, setQuotas] = useState<TaskTypeQuotas>(() => parseTaskTypeQuotas(project.taskTypeQuotas));

  const setField = <K extends keyof Pick<ProjectConfig, 'name' | 'gitlabUrl' | 'gitlabToken' | 'cloneBasePath' | 'models' | 'sourceModelFolder' | 'defaultSubmitRepo'>>(key: K, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    const modelList = normalizeProjectModels(form.models);
    const sourceModelFolder =
      modelList.find((model) => model.toUpperCase() === (form.sourceModelFolder?.trim() || 'ORIGIN').toUpperCase()) ??
      'ORIGIN';

    if (!form.name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    if (!form.cloneBasePath.trim()) {
      setError('本地克隆根目录不能为空');
      return;
    }
    if (taskTypes.length === 0) {
      setError('请至少保留一个任务类型');
      return;
    }
    if (form.defaultSubmitRepo.trim() && !/^[^/\s]+\/[^/\s]+$/.test(form.defaultSubmitRepo.trim())) {
      setError('源码仓库格式应为 owner/repo');
      return;
    }
    if (!modelList.some((model) => model.toUpperCase() === sourceModelFolder.toUpperCase())) {
      setError('源码模型必须在模型列表中');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const nextProject = {
        ...form,
        models: serializeProjectModels(modelList),
        sourceModelFolder,
        defaultSubmitRepo: form.defaultSubmitRepo.trim(),
        taskTypes: serializeProjectTaskTypes(taskTypes),
        taskTypeQuotas: serializeTaskTypeQuotas(quotas, taskTypes),
      };
      await updateProject(nextProject);
      onSaved(nextProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const modelList = normalizeProjectModels(form.models);

  const setModels = (list: string[]) => setField('models', serializeProjectModels(list));

  return (
    <motion.aside
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className="fixed top-0 right-0 bottom-0 w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
    >
      <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">项目配置</h2>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-7 space-y-5">
        {[
          { label: '项目名称', key: 'name' as const, placeholder: '我的项目' },
          { label: 'GitLab URL', key: 'gitlabUrl' as const, placeholder: 'https://gitlab.example.com' },
          { label: 'GitLab Token', key: 'gitlabToken' as const, placeholder: 'glpat-xxxx' },
          { label: '本地克隆根目录', key: 'cloneBasePath' as const, placeholder: '/Users/me/repos' },
        ].map(({ label, key, placeholder }) => (
          <label key={key} className="block">
            <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">{label}</span>
            <input value={(form as any)[key] || ''} onChange={e => setField(key, e.target.value)} placeholder={placeholder} className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30" />
          </label>
        ))}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">模型列表</span>
            <button onClick={() => setAddingModel(true)} className="text-xs font-semibold text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 flex items-center gap-1 cursor-default"><Plus className="w-3.5 h-3.5" /> 添加</button>
          </div>
          {addingModel && (
            <div className="flex gap-2 mb-2">
              <input value={newModelInput} onChange={e => setNewModelInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newModelInput.trim()) { setModels([...modelList, newModelInput.trim()]); setNewModelInput(''); setAddingModel(false); } }} placeholder="模型名称" autoFocus className="flex-1 px-3 py-2 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30" />
              <button onClick={() => { if (newModelInput.trim()) { setModels([...modelList, newModelInput.trim()]); setNewModelInput(''); setAddingModel(false); } }} className="px-3 py-2 rounded-xl bg-[#111827] text-white text-sm font-semibold cursor-default">添加</button>
              <button onClick={() => { setAddingModel(false); setNewModelInput(''); }} className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-600 cursor-default">取消</button>
            </div>
          )}
          <div className="space-y-1.5">
            {modelList.length === 0 ? (
              <p className="text-sm text-stone-400 dark:text-stone-600 text-center py-4 border border-dashed border-stone-200 dark:border-stone-800 rounded-xl">暂无模型</p>
            ) : modelList.map((m, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700">
                <span className="font-mono text-sm text-stone-700 dark:text-stone-300">{m}</span>
                {isOriginModel(m) ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">原始</span>
                ) : (
                  <button
                    onClick={() => {
                      const nextModels = modelList.filter((_, j) => j !== i);
                      setModels(nextModels);
                      if (form.sourceModelFolder.trim().toUpperCase() === m.trim().toUpperCase()) {
                        setField('sourceModelFolder', nextModels[0] ?? 'ORIGIN');
                      }
                    }}
                    className="text-stone-400 hover:text-red-500 transition-colors cursor-default"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
            任务类型与配额
          </span>
          <p className="mb-3 text-xs text-stone-400 dark:text-stone-500">
            这里维护项目级任务类型。留空表示不限，0 表示当前已不可再领取。
          </p>
          <TaskTypeQuotaEditor
            taskTypes={taskTypes}
            quotas={quotas}
            onTaskTypesChange={setTaskTypes}
            onQuotasChange={setQuotas}
            addButtonLabel="添加任务类型"
          />
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">源码模型</span>
          <select
            value={form.sourceModelFolder || 'ORIGIN'}
            onChange={(event) => setField('sourceModelFolder', event.target.value)}
            className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          >
            {modelList.map((modelName) => (
              <option key={modelName} value={modelName}>{modelName}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
            这里指定哪个模型副本作为源码来源。实际源码目录会自动使用对应 GitLab 项目名。
          </p>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">源码仓库</span>
          <input
            value={form.defaultSubmitRepo || ''}
            onChange={(event) => setField('defaultSubmitRepo', event.target.value)}
            placeholder="owner/repo"
            className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          />
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      <div className="px-7 py-5 border-t border-stone-100 dark:border-stone-800 flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 rounded-2xl text-sm font-semibold text-stone-700 dark:text-stone-300 cursor-default">取消</button>
        <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold disabled:opacity-50 cursor-default">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </motion.aside>
  );
}
