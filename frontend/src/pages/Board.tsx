import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Clock, GitBranch, CheckCircle2, CircleDashed, PlayCircle, Copy, Check,
  X, ExternalLink, Plus, Trash2, Settings, AlignJustify, Grid2X2, LayoutGrid, RefreshCw,
  ChevronRight, ArrowLeft,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, TaskStatus, TaskType, Task } from '../store';
import { motion, AnimatePresence } from 'motion/react';
import TaskTypeQuotaEditor from '../components/TaskTypeQuotaEditor';
import TaskGroupSection from '../components/TaskGroupSection';
import TaskTypeOverviewBar from '../components/TaskTypeOverviewBar';
import TaskDetailDrawer, { type TaskDetailDrawerTab } from '../components/TaskDetailDrawer';
import {
  buildTaskTypeOverviewSummaries,
  type TaskTypeOverviewSummary,
} from '../lib/taskTypeOverview';
import {
  buildProjectTaskTypes,
  DEFAULT_TASK_TYPE,
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
  extractTaskSessions,
  getTask,
  listModelRuns,
  type ExtractTaskSessionCandidate,
  type PromptGenerationStatus,
  updateTaskStatus,
  updateTaskType,
  updateTaskSessionList,
  type ModelRunFromDB,
  type TaskSession as TaskSessionRecord,
  type TaskFromDB,
} from '../services/task';
import {
  normalizeManagedSourceFolders,
  type NormalizeManagedSourceFoldersResult,
} from '../services/git';
import {
  buildDraftsFromExtractedCandidate,
  buildSessionEditorOpenSet,
  createSessionDraft,
  hydrateSessionDrafts,
  isSessionCounted,
  mapSessionDraftsToSessionList,
  type EditableTaskSession,
} from '../lib/sessionUtils';

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

const PROMPT_GENERATION_STATUS: Record<PromptGenerationStatus, {
  label: string;
  badgeCls: string;
  panelCls: string;
}> = {
  idle: {
    label: '未生成',
    badgeCls: 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400',
    panelCls: 'bg-stone-50 dark:bg-stone-900/40 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400',
  },
  running: {
    label: '正在生成',
    badgeCls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    panelCls: 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/40 text-amber-700 dark:text-amber-400',
  },
  done: {
    label: '已写入任务',
    badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    panelCls: 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  },
  error: {
    label: '生成失败',
    badgeCls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    panelCls: 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/40 text-red-600 dark:text-red-400',
  },
};

function normalizePromptGenerationStatus(status?: string | null): PromptGenerationStatus {
  if (status === 'running' || status === 'done' || status === 'error') {
    return status;
  }
  return 'idle';
}

function isOriginModel(name: string) {
  return name.trim().toUpperCase() === 'ORIGIN';
}

type CardSize = 'sm' | 'md' | 'lg';
type TaskSortOption = 'created-desc' | 'created-asc' | 'round-desc' | 'round-asc';
type TaskCardContextMenuState = {
  task: Task;
  position: {
    x: number;
    y: number;
  };
};

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
    () =>
      buildProjectTaskTypes(activeProject, [
        ...tasks.map((task) => task.taskType),
        ...tasks.flatMap((task) => task.sessionList.map((session) => session.taskType)),
      ]),
    [activeProject, tasks],
  );
  const projectQuotas = useMemo(
    () => parseTaskTypeQuotas(activeProject?.taskTypeQuotas),
    [activeProject?.taskTypeQuotas],
  );
  const projectTotals = useMemo(
    () => parseTaskTypeQuotas(activeProject?.taskTypeTotals),
    [activeProject?.taskTypeTotals],
  );

  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [showProjectOverview, setShowProjectOverview] = useState(false);
  const [search, setSearch]           = useState('');
  const [activeTypes, setActiveTypes]   = useState<Set<TaskType>>(new Set());
  const [activeStages, setActiveStages] = useState<Set<TaskStatus>>(new Set());
  const [activeRounds, setActiveRounds] = useState<Set<number>>(new Set());
  const [cardSize, setCardSize]         = useState<CardSize>('md');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<TaskSortOption>('created-desc');
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
  const [sessionExtracting, setSessionExtracting] = useState(false);
  const [sessionExtractCandidates, setSessionExtractCandidates] = useState<ExtractTaskSessionCandidate[]>([]);
  const [openSessionEditors, setOpenSessionEditors] = useState<Set<string>>(new Set());
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [taskTypeChanging, setTaskTypeChanging] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<TaskDetailDrawerTab>('sessions');
  const [taskCardContextMenu, setTaskCardContextMenu] = useState<TaskCardContextMenuState | null>(null);
  const taskCardContextMenuRef = useRef<HTMLDivElement | null>(null);

  const sessionTaskTypeOptions = useMemo(
    () =>
      buildProjectTaskTypes(activeProject, [
        ...tasks.map((task) => task.taskType),
        ...tasks.flatMap((task) => task.sessionList.map((session) => session.taskType)),
        ...sessionListDraft.map((session) => session.taskType),
      ]),
    [activeProject, sessionListDraft, tasks],
  );
  const selectedPromptGenerationStatus = normalizePromptGenerationStatus(
    selectedTaskDetail?.promptGenerationStatus ?? selected?.promptGenerationStatus,
  );
  const selectedPromptGenerationMeta = PROMPT_GENERATION_STATUS[selectedPromptGenerationStatus];
  const selectedPromptGenerationError =
    selectedTaskDetail?.promptGenerationError ??
    selected?.promptGenerationError ??
    null;
  const primaryTaskType =
    normalizeTaskTypeName(
      sessionListDraft[0]?.taskType ??
      selectedTaskDetail?.sessionList?.[0]?.taskType ??
      selectedTaskDetail?.taskType ??
      selected?.taskType ??
      availableTaskTypes[0] ??
      DEFAULT_TASK_TYPE,
    ) || DEFAULT_TASK_TYPE;

  const toggleType = (id: TaskType) =>
    setActiveTypes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleStage = (id: TaskStatus) =>
    setActiveStages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleRound = (round: number) =>
    setActiveRounds(prev => { const n = new Set(prev); n.has(round) ? n.delete(round) : n.add(round); return n; });

  const toggleGroupCollapse = (taskType: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(taskType)) {
        next.delete(taskType);
      } else {
        next.add(taskType);
      }
      return next;
    });

  const availableExecutionRounds = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.executionRounds))).sort((left, right) => left - right),
    [tasks],
  );

  const hasFilters =
    activeTypes.size > 0 ||
    activeStages.size > 0 ||
    activeRounds.size > 0 ||
    search.length > 0;
  const clearFilters = () => {
    setActiveTypes(new Set());
    setActiveStages(new Set());
    setActiveRounds(new Set());
    setSearch('');
  };

  const closeTaskCardContextMenu = () => {
    setTaskCardContextMenu(null);
  };

  const openTaskCardContextMenu = (event: React.MouseEvent, task: Task) => {
    event.preventDefault();
    event.stopPropagation();

    const padding = 12;
    const menuWidth = 296;
    const estimatedHeight = 460;

    setTaskCardContextMenu({
      task,
      position: {
        x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
        y: Math.max(padding, Math.min(event.clientY, window.innerHeight - estimatedHeight - padding)),
      },
    });
  };

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { loadActiveProject(); }, [loadActiveProject]);

  useEffect(() => {
    if (!taskCardContextMenu) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (taskCardContextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setTaskCardContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTaskCardContextMenu(null);
      }
    };

    const handleViewportChange = () => {
      setTaskCardContextMenu(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [taskCardContextMenu]);

  useEffect(() => {
    if (!selected?.id) {
      setSelectedTaskDetail(null);
      setSelectedModelRuns([]);
      setDrawerError('');
      setPromptDraft('');
      setSessionListDraft([]);
      setSessionExtractCandidates([]);
      setOpenSessionEditors(new Set());
      setCopiedSessionId(null);
      setSessionSaveState('idle');
      setPromptSaveState('idle');
      setActiveDrawerTab('sessions');
      return;
    }
    let cancelled = false;
    setActiveDrawerTab('sessions');
    setDrawerLoading(true);
    setDrawerError('');
    (async () => {
      const [taskDetail, modelRuns] = await Promise.all([getTask(selected.id), listModelRuns(selected.id)]);
      if (cancelled) return;
      setSelectedTaskDetail(taskDetail);
      setPromptDraft(taskDetail?.promptText ?? '');
      const hydratedSessions = hydrateSessionDrafts(
        taskDetail?.sessionList,
        taskDetail?.taskType ?? selected.taskType,
      );
      setSessionListDraft(hydratedSessions);
      setSessionExtractCandidates([]);
      setOpenSessionEditors(buildSessionEditorOpenSet(hydratedSessions));
      setCopiedSessionId(null);
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

  useEffect(() => {
    const allowedRounds = new Set(availableExecutionRounds);
    setActiveRounds((prev) => {
      const next = new Set([...prev].filter((round) => allowedRounds.has(round)));
      if (next.size === prev.size && [...next].every((round) => prev.has(round))) {
        return prev;
      }
      return next;
    });
  }, [availableExecutionRounds]);

  const filtered = useMemo(() => tasks.filter(t => {
    const matchSearch = !search ||
      t.projectName.toLowerCase().includes(search.toLowerCase()) ||
      t.projectId.includes(search) ||
      t.id.toLowerCase().includes(search.toLowerCase());
    const matchType  = activeTypes.size === 0 || activeTypes.has(normalizeTaskTypeName(t.taskType));
    const matchStage = activeStages.size === 0 || activeStages.has(t.status);
    const matchRound = activeRounds.size === 0 || activeRounds.has(t.executionRounds);
    return matchSearch && matchType && matchStage && matchRound;
  }), [tasks, search, activeTypes, activeStages, activeRounds]);

  const sortedTasks = useMemo(() => {
    const next = [...filtered];
    const compareByName = (left: Task, right: Task) =>
      left.projectName.localeCompare(right.projectName, 'zh-CN', { numeric: true, sensitivity: 'base' });

    next.sort((left, right) => {
      if (sortBy === 'created-asc') {
        return left.createdAt - right.createdAt || right.executionRounds - left.executionRounds || compareByName(left, right);
      }
      if (sortBy === 'round-desc') {
        return right.executionRounds - left.executionRounds || right.createdAt - left.createdAt || compareByName(left, right);
      }
      if (sortBy === 'round-asc') {
        return left.executionRounds - right.executionRounds || right.createdAt - left.createdAt || compareByName(left, right);
      }
      return right.createdAt - left.createdAt || right.executionRounds - left.executionRounds || compareByName(left, right);
    });

    return next;
  }, [filtered, sortBy]);

  const groupedTasks = useMemo(() => {
    const grouped = new Map<string, Task[]>();

    for (const taskType of availableTaskTypes) {
      grouped.set(taskType, []);
    }

    for (const task of sortedTasks) {
      const normalizedTaskType = normalizeTaskTypeName(task.taskType) || task.taskType;
      const existingTasks = grouped.get(normalizedTaskType);
      if (existingTasks) {
        existingTasks.push(task);
        continue;
      }
      grouped.set(normalizedTaskType, [task]);
    }

    return Array.from(grouped.entries())
      .map(([taskType, groupTasks]) => ({ taskType, tasks: groupTasks }))
      .filter((group) => group.tasks.length > 0);
  }, [availableTaskTypes, sortedTasks]);

  const projectTaskSummaries = useMemo(
    () => buildTaskTypeOverviewSummaries(availableTaskTypes, tasks, projectQuotas, projectTotals),
    [availableTaskTypes, tasks, projectQuotas, projectTotals],
  );

  const visibleProjectTaskSummaries = useMemo(
    () =>
      projectTaskSummaries.filter((summary) =>
        summary.remainingQuota !== null ||
        summary.waitingTasks.length > 0 ||
        summary.processingTasks.length > 0 ||
        summary.submittedSessionCount > 0 ||
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
      setSelected((prev) => (prev?.id === taskId ? { ...prev, status: newStatus } : prev));
      setSelectedTaskDetail((prev) => (prev?.id === taskId ? { ...prev, status: newStatus } : prev));
    } catch (err) {
      console.error('Failed to update task status:', err);
    } finally {
      setStatusChanging(false);
    }
  };

  const handleTaskTypeChange = async (taskId: string, nextTaskType: string) => {
    const normalizedTaskType = normalizeTaskTypeName(nextTaskType);
    const taskFromStore = tasks.find((task) => task.id === taskId);
    const isSelectedTask = selected?.id === taskId;
    const currentTaskType =
      normalizeTaskTypeName(
        isSelectedTask ? primaryTaskType : (taskFromStore?.taskType ?? ''),
      ) || (isSelectedTask ? primaryTaskType : (taskFromStore?.taskType ?? ''));

    if (!normalizedTaskType || !currentTaskType || normalizedTaskType === currentTaskType) {
      return;
    }

    const previousTaskType = taskFromStore?.taskType ?? currentTaskType;
    const previousSelected = selected;
    const previousTaskDetail = selectedTaskDetail;
    const previousSessionListDraft = sessionListDraft;

    updateTaskTypeInStore(taskId, normalizedTaskType);

    if (isSelectedTask) {
      setSelected((prev) => (prev?.id === taskId ? { ...prev, taskType: normalizedTaskType } : prev));
      setSelectedTaskDetail((prev) => {
        if (!prev || prev.id !== taskId) return prev;

        const nextSessionList =
          prev.sessionList.length > 0
            ? prev.sessionList.map((session, index) =>
                index === 0 ? { ...session, taskType: normalizedTaskType } : session,
              )
            : prev.sessionList;

        return {
          ...prev,
          taskType: normalizedTaskType,
          sessionList: nextSessionList,
        };
      });
      setSessionListDraft((prev) =>
        prev.map((session, index) =>
          index === 0 ? { ...session, taskType: normalizedTaskType } : session,
        ),
      );
      setSessionSaveState('idle');
      setDrawerError('');
    }

    setTaskTypeChanging(true);
    try {
      await updateTaskType(taskId, normalizedTaskType);
      await loadActiveProject();
    } catch (error) {
      updateTaskTypeInStore(taskId, previousTaskType);
      if (isSelectedTask) {
        setSelected(previousSelected);
        setSelectedTaskDetail(previousTaskDetail);
        setSessionListDraft(previousSessionListDraft);
        setDrawerError(error instanceof Error ? error.message : '任务类型更新失败');
      } else {
        console.error('Failed to update task type:', error);
      }
    } finally {
      setTaskTypeChanging(false);
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
      const now = Math.floor(Date.now() / 1000);
      setSelectedTaskDetail((prev) => prev ? {
        ...prev,
        promptText: promptDraft,
        status: 'PromptReady',
        promptGenerationStatus: 'done',
        promptGenerationError: null,
        promptGenerationStartedAt: prev.promptGenerationStartedAt ?? now,
        promptGenerationFinishedAt: now,
      } : prev);
      setSelected((prev) => prev ? {
        ...prev,
        status: 'PromptReady',
        promptGenerationStatus: 'done',
        promptGenerationError: null,
      } : prev);
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
      DEFAULT_TASK_TYPE;

    const nextSession = createSessionDraft(fallbackTaskType, {
      taskType: fallbackTaskType,
      consumeQuota: false,
      isCompleted: null,
      isSatisfied: null,
      evaluation: '',
    });
    setSessionListDraft((prev) => [...prev, nextSession]);
    setOpenSessionEditors((prev) => new Set(prev).add(nextSession.localId));
    setSessionSaveState('idle');
  };

  const handleSessionChange = (
    localId: string,
    patch: Partial<Pick<EditableTaskSession, 'sessionId' | 'taskType' | 'consumeQuota' | 'isCompleted' | 'isSatisfied' | 'evaluation' | 'userConversation'>>,
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
    setOpenSessionEditors((prev) => {
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
    setCopiedSessionId((prev) => (prev === localId ? null : prev));
    setSessionSaveState('idle');
  };

  const handleResetSessions = () => {
    const fallbackTaskType = selectedTaskDetail?.taskType ?? selected?.taskType ?? availableTaskTypes[0] ?? DEFAULT_TASK_TYPE;
    const hydratedSessions = hydrateSessionDrafts(selectedTaskDetail?.sessionList, fallbackTaskType);
    setSessionListDraft(hydratedSessions);
    setSessionExtractCandidates([]);
    setOpenSessionEditors(buildSessionEditorOpenSet(hydratedSessions));
    setCopiedSessionId(null);
    setSessionSaveState('idle');
  };

  const applyExtractedSessionCandidate = (candidate: ExtractTaskSessionCandidate) => {
    const fallbackTaskType =
      selectedTaskDetail?.taskType ??
      selected?.taskType ??
      availableTaskTypes[0] ??
      DEFAULT_TASK_TYPE;

    const nextDrafts = buildDraftsFromExtractedCandidate(candidate, sessionListDraft, fallbackTaskType);
    if (nextDrafts.length === 0) {
      setDrawerError('提取结果中没有可用的 session');
      return;
    }

    setSessionListDraft(nextDrafts);
    setSessionExtractCandidates([]);
    setOpenSessionEditors(buildSessionEditorOpenSet(nextDrafts));
    setCopiedSessionId(null);
    setSessionSaveState('idle');
    setDrawerError('');
  };

  const handleAutoExtractSessions = async () => {
    if (!selected?.id) return;

    setSessionExtracting(true);
    setSessionExtractCandidates([]);
    setDrawerError('');
    try {
      const result = await extractTaskSessions(selected.id);
      if (result.candidates.length === 0) {
        setDrawerError('未在 Trae 中找到与当前题卡匹配的对话');
        return;
      }

      if (result.candidates.length === 1) {
        applyExtractedSessionCandidate(result.candidates[0]);
        return;
      }

      setSessionExtractCandidates(result.candidates);
    } catch (error) {
      setDrawerError(error instanceof Error ? error.message : '自动提取 session 失败');
    } finally {
      setSessionExtracting(false);
    }
  };

  const toggleSessionEditor = (localId: string) => {
    setOpenSessionEditors((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) {
        next.delete(localId);
      } else {
        next.add(localId);
      }
      return next;
    });
  };

  const handleCopySessionId = async (localId: string, sessionId: string) => {
    if (!sessionId.trim()) return;
    await navigator.clipboard.writeText(sessionId.trim());
    setCopiedSessionId(localId);
    window.setTimeout(() => {
      setCopiedSessionId((current) => (current === localId ? null : current));
    }, 1500);
  };

  const handleSessionListSave = async () => {
    if (!selected?.id) return;
    if (sessionListDraft.length === 0) {
      setDrawerError('至少保留一个 session');
      return;
    }

    for (let index = 0; index < sessionListDraft.length; index += 1) {
      const session = sessionListDraft[index];
      if (session.isCompleted === null || session.isCompleted === undefined) {
        setDrawerError(`第 ${index + 1} 轮请选择是否完成`);
        return;
      }
      if (session.isSatisfied === null || session.isSatisfied === undefined) {
        setDrawerError(`第 ${index + 1} 轮请选择是否满意`);
        return;
      }
    }

    const nextSessionList: TaskSessionRecord[] = mapSessionDraftsToSessionList(sessionListDraft, selected.taskType);

    setSessionListSaving(true);
    setDrawerError('');
    try {
      await updateTaskSessionList({
        id: selected.id,
        sessionList: nextSessionList,
      });

      const nextTaskType = nextSessionList[0]?.taskType ?? selected.taskType;
      updateTaskTypeInStore(selected.id, nextTaskType);
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              taskType: nextTaskType,
              executionRounds: Math.max(nextSessionList.length, 1),
            }
          : prev,
      );
      setSelectedTaskDetail((prev) =>
        prev ? { ...prev, taskType: nextTaskType, sessionList: nextSessionList } : prev,
      );
      const hydratedSessions = hydrateSessionDrafts(nextSessionList, nextTaskType);
      setSessionListDraft(hydratedSessions);
      setOpenSessionEditors(buildSessionEditorOpenSet(hydratedSessions));
      setCopiedSessionId(null);
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

          <div className="ml-auto flex items-center gap-2 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-3">
            <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400">排序</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as TaskSortOption)}
              className="bg-transparent py-2 text-sm font-medium text-stone-600 dark:text-stone-300 outline-none cursor-default"
            >
              <option value="created-desc">最新创建</option>
              <option value="created-asc">最早创建</option>
              <option value="round-desc">轮次从高到低</option>
              <option value="round-asc">轮次从低到高</option>
            </select>
          </div>

          <span className="text-sm text-stone-400 dark:text-stone-500 font-medium tabular-nums">
            {sortedTasks.length} / {tasks.length}
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

        {availableExecutionRounds.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 w-14 flex-shrink-0">轮次</span>
            {availableExecutionRounds.map((round) => {
              const count = tasks.filter((task) => task.executionRounds === round).length;
              const active = activeRounds.has(round);

              return (
                <button
                  key={round}
                  onClick={() => toggleRound(round)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-default ${
                    active
                      ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/20 shadow-sm scale-[1.02]'
                      : 'bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  第 {round} 轮
                  <span className={`tabular-nums font-bold ${active ? 'opacity-75' : 'text-stone-400 dark:text-stone-500'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {visibleProjectTaskSummaries.length > 0 && (
        <TaskTypeOverviewBar summaries={visibleProjectTaskSummaries} />
      )}

      {/* ── Card grid ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-5">
        {sortedTasks.length === 0 ? (
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
          <div className="space-y-6">
            {groupedTasks.map(({ taskType, tasks: tasksInGroup }) => {
              const hideHeader = activeTypes.size > 0 && groupedTasks.length === 1;

              return (
                <TaskGroupSection
                  key={taskType}
                  taskType={taskType}
                  tasks={tasksInGroup}
                  isCollapsed={hideHeader ? false : collapsedGroups.has(taskType)}
                  onToggleCollapse={() => toggleGroupCollapse(taskType)}
                  gridClass={gridClass[cardSize]}
                  hideHeader={hideHeader}
                  renderTaskCard={(task) => (
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
                        onContextMenu={(event) => openTaskCardContextMenu(event, task)}
                        onDelete={() => { setDeleteError(''); setPendingDelete(task); }}
                      />
                    </motion.div>
                  )}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modals + Drawers ──────────────────────────── */}
      <AnimatePresence>
        {taskCardContextMenu && (
          <TaskCardContextMenu
            menuRef={taskCardContextMenuRef}
            task={taskCardContextMenu.task}
            position={taskCardContextMenu.position}
            statusOptions={COLUMNS}
            availableTaskTypes={availableTaskTypes}
            statusMeta={STATUS}
            statusChanging={statusChanging}
            taskTypeChanging={taskTypeChanging}
            onClose={closeTaskCardContextMenu}
            onStatusChange={(status) => {
              closeTaskCardContextMenu();
              void handleStatusChange(taskCardContextMenu.task.id, status);
            }}
            onTaskTypeChange={(taskType) => {
              closeTaskCardContextMenu();
              void handleTaskTypeChange(taskCardContextMenu.task.id, taskType);
            }}
          />
        )}

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
              onOpenTaskContextMenu={openTaskCardContextMenu}
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
          <TaskDetailDrawer
            selected={selected}
            selectedTaskDetail={selectedTaskDetail}
            selectedModelRuns={selectedModelRuns}
            drawerLoading={drawerLoading}
            drawerError={drawerError}
            statusChanging={statusChanging}
            taskTypeChanging={taskTypeChanging}
            sessionListDraft={sessionListDraft}
            sessionListSaving={sessionListSaving}
            sessionSaveState={sessionSaveState}
            sessionExtracting={sessionExtracting}
            openSessionEditors={openSessionEditors}
            copiedSessionId={copiedSessionId}
            promptDraft={promptDraft}
            promptSaving={promptSaving}
            promptSaveState={promptSaveState}
            promptCopied={promptCopied}
            activeDrawerTab={activeDrawerTab}
            sessionTaskTypeOptions={sessionTaskTypeOptions}
            projectQuotas={projectQuotas}
            sourceModelName={sourceModelName}
            selectedPromptGenerationStatus={selectedPromptGenerationStatus}
            selectedPromptGenerationMeta={selectedPromptGenerationMeta}
            selectedPromptGenerationError={selectedPromptGenerationError}
            statusMeta={STATUS}
            statusOptions={COLUMNS}
            onClose={() => setSelected(null)}
            onStatusChange={handleStatusChange}
            onTabChange={setActiveDrawerTab}
            onAddSession={handleAddSession}
            onAutoExtractSessions={() => void handleAutoExtractSessions()}
            onSessionChange={handleSessionChange}
            onToggleSessionEditor={toggleSessionEditor}
            onCopySessionId={handleCopySessionId}
            onRemoveSession={handleRemoveSession}
            onResetSessions={handleResetSessions}
            onSaveSessionList={() => void handleSessionListSave()}
            onPromptDraftChange={(value) => {
              setPromptDraft(value);
              setPromptSaveState('idle');
            }}
            onPromptCopy={handlePromptCopy}
            onPromptReset={() => {
              setPromptDraft(selectedTaskDetail?.promptText ?? '');
              setPromptSaveState('idle');
            }}
            onPromptSave={() => void handlePromptSave()}
            onOpenPrompt={() => { setSelected(null); navigate(`/prompt?taskId=${selected.id}`); }}
            onOpenSubmit={() => { setSelected(null); navigate(`/submit?taskId=${selected.id}`); }}
          />
        )}

        {selected && sessionExtractCandidates.length > 1 && (
          <SessionExtractCandidateModal
            candidates={sessionExtractCandidates}
            onClose={() => setSessionExtractCandidates([])}
            onSelect={(candidate) => applyExtractedSessionCandidate(candidate)}
          />
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
function SessionExtractCandidateModal({
  candidates,
  onClose,
  onSelect,
}: {
  candidates: ExtractTaskSessionCandidate[];
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
              <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">检测到多个 Trae 对话</h2>
              <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                当前题卡匹配到多个会话，请选择要回填到试题预览里的那一个。
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
            {candidates.map((candidate) => (
              <div
                key={candidate.id}
                className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
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
            ))}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function matchKindLabel(matchKind: string) {
  if (matchKind === 'exact') return '完全匹配';
  if (matchKind === 'child') return '项目子目录';
  if (matchKind === 'parent') return '项目父目录';
  return matchKind || '未知';
}

function TaskCardContextMenu({
  menuRef,
  task,
  position,
  statusOptions,
  availableTaskTypes,
  statusMeta,
  statusChanging,
  taskTypeChanging,
  onClose,
  onStatusChange,
  onTaskTypeChange,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>;
  task: Task;
  position: {
    x: number;
    y: number;
  };
  statusOptions: TaskStatus[];
  availableTaskTypes: string[];
  statusMeta: typeof STATUS;
  statusChanging: boolean;
  taskTypeChanging: boolean;
  onClose: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onTaskTypeChange: (taskType: string) => void;
}) {
  type ContextMenuPanel = 'root' | 'status' | 'taskType';

  const [panel, setPanel] = useState<ContextMenuPanel>('root');
  const [direction, setDirection] = useState<1 | -1>(1);
  const currentTaskType = normalizeTaskTypeName(task.taskType) || task.taskType;
  const currentStatusMeta = statusMeta[task.status];
  const currentTaskTypePresentation = getTaskTypePresentation(currentTaskType);

  const openPanel = (nextPanel: Exclude<ContextMenuPanel, 'root'>) => {
    setDirection(1);
    setPanel(nextPanel);
  };

  const returnToRoot = () => {
    setDirection(-1);
    setPanel('root');
  };

  const panelVariants = {
    enter: (nextDirection: 1 | -1) => ({
      opacity: 0,
      x: nextDirection > 0 ? 28 : -28,
      filter: 'blur(6px)',
    }),
    center: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
    },
    exit: (nextDirection: 1 | -1) => ({
      opacity: 0,
      x: nextDirection > 0 ? -28 : 28,
      filter: 'blur(6px)',
    }),
  };

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.93, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      style={{ left: position.x, top: position.y }}
      className="fixed z-40 w-[256px] overflow-hidden rounded-xl border border-stone-200/70 bg-white shadow-[0_4px_20px_-4px_rgba(15,23,42,0.14),0_1px_4px_rgba(15,23,42,0.05)] dark:border-stone-700/50 dark:bg-stone-900"
    >
      {/* Header */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-stone-100 dark:border-stone-800/70">
        <div className="flex items-start gap-2 justify-between">
          <p className="truncate text-[13px] font-semibold leading-snug text-stone-800 dark:text-stone-100">{task.projectName}</p>
          <span className="mt-0.5 shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-stone-400 dark:bg-stone-800 dark:text-stone-500">#{task.projectId}</span>
        </div>
        <p className="mt-1 font-mono text-[10px] text-stone-300 dark:text-stone-600 truncate">{task.id}</p>
      </div>

      {/* Panel area */}
      <div className="overflow-hidden">
        <AnimatePresence custom={direction} mode="wait" initial={false}>
          {panel === 'root' && (
            <motion.div
              key="root"
              custom={direction}
              variants={panelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
              className="py-1"
            >
              <button
                type="button"
                onClick={() => openPanel('status')}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-default"
              >
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${currentStatusMeta.badgeCls}`}>
                  <span className={`h-2 w-2 rounded-full ${currentStatusMeta.dotCls}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-none text-stone-400 dark:text-stone-500 mb-0.5">任务状态</p>
                  <p className="text-[13px] font-semibold leading-tight text-stone-700 dark:text-stone-200 truncate">{currentStatusMeta.label}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-300 dark:text-stone-600" />
              </button>

              <div className="mx-3.5 border-t border-stone-100 dark:border-stone-800/70" />

              <button
                type="button"
                onClick={() => openPanel('taskType')}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-default"
              >
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${currentTaskTypePresentation.badge}`}>
                  <span className={`h-2 w-2 rounded-full ${currentTaskTypePresentation.dot}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-none text-stone-400 dark:text-stone-500 mb-0.5">任务类型</p>
                  <p className="text-[13px] font-semibold leading-tight text-stone-700 dark:text-stone-200 truncate">{currentTaskTypePresentation.label}</p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-300 dark:text-stone-600" />
              </button>
            </motion.div>
          )}

          {panel === 'status' && (
            <motion.div
              key="status"
              custom={direction}
              variants={panelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center gap-1.5 px-2 py-2 border-b border-stone-100 dark:border-stone-800/70">
                <button
                  type="button"
                  onClick={returnToRoot}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300 cursor-default"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <p className="text-[12px] font-semibold text-stone-600 dark:text-stone-300">切换任务状态</p>
              </div>
              <div className="max-h-[272px] overflow-y-auto py-1">
                {statusOptions.map((status) => {
                  const active = task.status === status;
                  const meta = statusMeta[status];
                  return (
                    <button
                      key={status}
                      type="button"
                      disabled={statusChanging}
                      onClick={() => onStatusChange(status)}
                      className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors cursor-default ${
                        active ? 'bg-stone-50 dark:bg-stone-800/50' : 'hover:bg-stone-50 dark:hover:bg-stone-800/50'
                      } ${statusChanging ? 'opacity-50' : ''}`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dotCls}`} />
                      <span className={`flex-1 truncate text-[13px] ${active ? 'font-semibold text-stone-800 dark:text-stone-100' : 'font-medium text-stone-600 dark:text-stone-300'}`}>
                        {meta.label}
                      </span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-stone-400 dark:text-stone-500" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {panel === 'taskType' && (
            <motion.div
              key="taskType"
              custom={direction}
              variants={panelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center gap-1.5 px-2 py-2 border-b border-stone-100 dark:border-stone-800/70">
                <button
                  type="button"
                  onClick={returnToRoot}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300 cursor-default"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <p className="text-[12px] font-semibold text-stone-600 dark:text-stone-300">切换任务类型</p>
              </div>
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
                        active ? 'bg-stone-50 dark:bg-stone-800/50' : 'hover:bg-stone-50 dark:hover:bg-stone-800/50'
                      } ${taskTypeChanging ? 'opacity-50' : ''}`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${presentation.dot}`} />
                      <span className={`flex-1 truncate text-[13px] ${active ? 'font-semibold text-stone-800 dark:text-stone-100' : 'font-medium text-stone-600 dark:text-stone-300'}`}>
                        {presentation.label}
                      </span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-stone-400 dark:text-stone-500" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function TaskRoundBadge({ rounds, compact = false }: { rounds: number; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-sky-200 bg-sky-50 font-semibold text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300 ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      }`}
    >
      第 {rounds} 轮
    </span>
  );
}

function TaskCard({
  task,
  size,
  onClick,
  onContextMenu,
  onDelete,
}: {
  task: Task;
  size: CardSize;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  const cfg = STATUS[task.status];
  const typePresentation = getTaskTypePresentation(task.taskType);
  const promptGenerationStatus = normalizePromptGenerationStatus(task.promptGenerationStatus);
  const promptGenerationMeta = PROMPT_GENERATION_STATUS[promptGenerationStatus];
  const showPromptBadge = promptGenerationStatus === 'running' || promptGenerationStatus === 'error';

  if (size === 'sm') {
    return (
      <motion.div layout onClick={onClick} onContextMenu={onContextMenu}
        className="group bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-3.5 hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-sm transition-all cursor-default"
      >
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${cfg.dotCls}`} />
          <div className="flex items-center gap-1.5 ml-auto">
            {showPromptBadge && (
              <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold ${promptGenerationMeta.badgeCls}`}>
                {promptGenerationStatus === 'running' ? '出题中' : '出题失败'}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold border ${cfg.badgeCls}`}>{cfg.label}</span>
            <button onClick={e => { e.stopPropagation(); onDelete(); }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-default">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-50 leading-snug line-clamp-1 mb-0.5">{task.projectName}</p>
        <p className="font-mono text-[11px] text-stone-400 dark:text-stone-500 mb-1.5">#{task.projectId}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${typePresentation.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
            {typePresentation.label}
          </span>
          <TaskRoundBadge rounds={task.executionRounds} compact />
        </div>
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
      <motion.div layout onClick={onClick} onContextMenu={onContextMenu}
        className="group bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-sm transition-all cursor-default"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`w-2 h-2 rounded-full ${cfg.dotCls}`} />
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${cfg.badgeCls}`}>{cfg.label}</span>
            {showPromptBadge && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${promptGenerationMeta.badgeCls}`}>
                提示词{promptGenerationStatus === 'running' ? '生成中' : '失败'}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${typePresentation.badge}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
              {typePresentation.label}
            </span>
            <TaskRoundBadge rounds={task.executionRounds} />
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
    <motion.div layout onClick={onClick} onContextMenu={onContextMenu}
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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${typePresentation.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
          {typePresentation.label}
        </span>
        <TaskRoundBadge rounds={task.executionRounds} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <GitBranch className="w-3.5 h-3.5" />
          <span className="font-mono truncate max-w-[120px]">{task.id}</span>
        </div>
        <div className="flex items-center gap-2">
          {showPromptBadge && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${promptGenerationMeta.badgeCls}`}>
              {promptGenerationStatus === 'running' ? '出题中' : '出题失败'}
            </span>
          )}
          {task.totalModels > 0 && (
            <div className="flex items-center gap-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
              {task.progress === task.totalModels ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : task.runningModels > 0 ? <PlayCircle className="w-3.5 h-3.5 text-slate-500" /> : <CircleDashed className="w-3.5 h-3.5" />}
              {task.progress}/{task.totalModels}
            </div>
          )}
        </div>
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

type TaskTypeSummary = TaskTypeOverviewSummary;

function TaskTypeOverviewCard({
  summary,
  onSelectTask,
  onOpenTaskContextMenu,
}: {
  summary: TaskTypeSummary;
  onSelectTask: (task: Task) => void;
  onOpenTaskContextMenu: (event: React.MouseEvent, task: Task) => void;
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
        <OverviewMetric label="已提交轮次" value={summary.submittedSessionCount} tone="emerald" />
        <OverviewMetric label="异常" value={summary.errorTasks.length} tone="red" />
      </div>

      <div className="space-y-3">
        <TaskGroupPreview
          label="处理中"
          tasks={summary.processingTasks}
          emptyText="当前没有执行中的题卡"
          onSelectTask={onSelectTask}
          onOpenTaskContextMenu={onOpenTaskContextMenu}
          tone="amber"
        />
        <TaskGroupPreview
          label="待处理"
          tasks={summary.waitingTasks}
          emptyText={summary.remainingQuota === 0 ? '当前没有待处理题卡' : '这个分类还没开始'}
          onSelectTask={onSelectTask}
          onOpenTaskContextMenu={onOpenTaskContextMenu}
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
  onOpenTaskContextMenu,
  tone,
}: {
  label: string;
  tasks: Task[];
  emptyText: string;
  onSelectTask: (task: Task) => void;
  onOpenTaskContextMenu: (event: React.MouseEvent, task: Task) => void;
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
              onContextMenu={(event) => onOpenTaskContextMenu(event, task)}
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
  onOpenTaskContextMenu,
}: {
  project: ProjectConfig;
  summaries: TaskTypeSummary[];
  taskCount: number;
  onClose: () => void;
  onNormalized: () => Promise<void>;
  onSelectTask: (task: Task) => void;
  onOpenTaskContextMenu: (event: React.MouseEvent, task: Task) => void;
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
            title="将现有任务目录和源码目录归一为任务类型命名规则"
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
                任务目录会归一为 <code className="font-mono">label-00947-bug修复</code>，源码目录会归一为 <code className="font-mono">01995-bug修复</code>。
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
          <InfoCard label="源码目录名" value="项目ID-任务类型" />
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
                  onOpenTaskContextMenu={onOpenTaskContextMenu}
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
  const [quotas, setQuotas] = useState<TaskTypeQuotas>(() => parseTaskTypeQuotas(project.taskTypeTotals || project.taskTypeQuotas));

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
        taskTypeQuotas: form.taskTypeQuotas,
        taskTypeTotals: serializeTaskTypeQuotas(quotas, taskTypes),
      };
      await updateProject(nextProject);
      const refreshedProjects = await getProjects();
      const updatedProject = refreshedProjects.find((item) => item.id === nextProject.id) ?? nextProject;
      onSaved(updatedProject);
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
            这里维护项目级任务类型总量。保存后会按当前已分配数量自动重算剩余额度。
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
