import { useState, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, TaskStatus, TaskType, Task } from '../../store';
import {
  buildTaskTypeOverviewSummaries,
} from '../../shared/lib/taskTypeOverview';
import {
  getProjectTaskSettings,
} from '../../api/config';
import {
  deleteTask,
  openTaskLocalFolder,
} from '../../api/task';
import {
  CardSize,
  STATUS,
} from './components/BoardPresentation';
import {
  BoardMainContent,
} from './components/BoardMainContent';
import {
  filterBoardTasks,
  getAvailableExecutionRounds,
  groupBoardTasks,
  sortBoardTasks,
  type BoardSortOption,
} from './utils/boardTaskView';
import {
  BoardLayerStack,
  type TaskCardContextMenuState,
} from './components/BoardLayerStack';
import { useBoardTaskDetail } from './hooks/useBoardTaskDetail';

const COLUMNS: TaskStatus[] = ['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error'];
const DRAWER_ESC_CONFIRM_WINDOW_MS = 1600;

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
  const projectTaskSettings = useMemo(
    () =>
      getProjectTaskSettings(activeProject, [
        ...tasks.map((task) => task.taskType),
        ...tasks.flatMap((task) => task.sessionList.map((session) => session.taskType)),
      ]),
    [activeProject, tasks],
  );
  const availableTaskTypes = projectTaskSettings.taskTypes;
  const projectQuotas = projectTaskSettings.quotas;
  const projectTotals = projectTaskSettings.totals;

  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [showProjectOverview, setShowProjectOverview] = useState(false);
  const [search, setSearch]           = useState('');
  const [activeTypes, setActiveTypes]   = useState<Set<TaskType>>(new Set());
  const [activeStages, setActiveStages] = useState<Set<TaskStatus>>(new Set());
  const [activeRounds, setActiveRounds] = useState<Set<number>>(new Set());
  const [cardSize, setCardSize]         = useState<CardSize>('md');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<BoardSortOption>('created-desc');
  const [pendingDelete, setPendingDelete]     = useState<Task | null>(null);
  const [deleting, setDeleting]   = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [taskCardContextMenu, setTaskCardContextMenu] = useState<TaskCardContextMenuState | null>(null);
  const [taskCardContextMenuError, setTaskCardContextMenuError] = useState('');
  const [taskCardFolderOpening, setTaskCardFolderOpening] = useState(false);
  const [drawerEscCloseHintVisible, setDrawerEscCloseHintVisible] = useState(false);
  const taskCardContextMenuRef = useRef<HTMLDivElement | null>(null);
  const drawerEscCloseHintTimeoutRef = useRef<number | null>(null);
  const drawerEscLastPressedAtRef = useRef<number | null>(null);
  const detail = useBoardTaskDetail({
    activeProject,
    availableTaskTypes,
    sourceModelName,
    tasks,
    loadTasks,
    loadActiveProject,
    updateTaskStatusInStore,
    updateTaskTypeInStore,
  });

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

  const availableExecutionRounds = useMemo(() => getAvailableExecutionRounds(tasks), [tasks]);

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

  const clearDrawerEscCloseHintTimer = () => {
    if (drawerEscCloseHintTimeoutRef.current !== null) {
      window.clearTimeout(drawerEscCloseHintTimeoutRef.current);
      drawerEscCloseHintTimeoutRef.current = null;
    }
  };

  const resetDrawerEscCloseHint = () => {
    clearDrawerEscCloseHintTimer();
    drawerEscLastPressedAtRef.current = null;
    setDrawerEscCloseHintVisible(false);
  };

  const closeDetailDrawer = () => {
    resetDrawerEscCloseHint();
    detail.setSelected(null);
  };

  const closeTaskCardContextMenu = () => {
    setTaskCardContextMenu(null);
    setTaskCardContextMenuError('');
    setTaskCardFolderOpening(false);
  };

  const openTaskCardContextMenu = (event: MouseEvent, task: Task) => {
    event.preventDefault();
    event.stopPropagation();

    const padding = 12;
    const menuWidth = 296;
    const estimatedHeight = 460;

    setTaskCardContextMenuError('');
    setTaskCardFolderOpening(false);
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

  const shouldHandleDrawerEscape =
    Boolean(detail.selected) &&
    !taskCardContextMenu &&
    !pendingDelete &&
    !showProjectOverview &&
    !showProjectPanel &&
    detail.sessionExtractCandidates.length <= 1;

  useEffect(() => {
    resetDrawerEscCloseHint();
  }, [detail.selected?.id]);

  useEffect(() => {
    if (shouldHandleDrawerEscape) {
      return undefined;
    }
    resetDrawerEscCloseHint();
    return undefined;
  }, [shouldHandleDrawerEscape, detail.selected?.id]);

  useEffect(() => {
    if (!shouldHandleDrawerEscape) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const now = Date.now();
      const lastPressedAt = drawerEscLastPressedAtRef.current;
      if (
        lastPressedAt !== null &&
        now - lastPressedAt <= DRAWER_ESC_CONFIRM_WINDOW_MS
      ) {
        closeDetailDrawer();
        return;
      }

      drawerEscLastPressedAtRef.current = now;
      setDrawerEscCloseHintVisible(true);
      clearDrawerEscCloseHintTimer();
      drawerEscCloseHintTimeoutRef.current = window.setTimeout(() => {
        drawerEscLastPressedAtRef.current = null;
        setDrawerEscCloseHintVisible(false);
        drawerEscCloseHintTimeoutRef.current = null;
      }, DRAWER_ESC_CONFIRM_WINDOW_MS);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shouldHandleDrawerEscape, detail.selected?.id]);

  useEffect(() => () => {
    clearDrawerEscCloseHintTimer();
  }, []);

  const handleOpenTaskLocalFolder = async () => {
    if (!taskCardContextMenu || taskCardFolderOpening) {
      return;
    }

    setTaskCardFolderOpening(true);
    setTaskCardContextMenuError('');
    try {
      await openTaskLocalFolder(taskCardContextMenu.task.id);
      closeTaskCardContextMenu();
    } catch (error) {
      setTaskCardContextMenuError(error instanceof Error ? error.message : '打开本地目录失败');
      setTaskCardFolderOpening(false);
    }
  };

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

  const filtered = useMemo(
    () => filterBoardTasks(tasks, { search, activeTypes, activeStages, activeRounds }),
    [tasks, search, activeTypes, activeStages, activeRounds],
  );

  const sortedTasks = useMemo(() => sortBoardTasks(filtered, sortBy), [filtered, sortBy]);

  const groupedTasks = useMemo(
    () => groupBoardTasks(availableTaskTypes, sortedTasks),
    [availableTaskTypes, sortedTasks],
  );

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

  const gridClassBySize: Record<CardSize, string> = {
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
      if (detail.selected?.id === pendingDelete.id) detail.setSelected(null);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除题卡失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <BoardMainContent
        search={search}
        sortBy={sortBy}
        totalTaskCount={tasks.length}
        availableTaskTypes={availableTaskTypes}
        activeTypes={activeTypes}
        activeStages={activeStages}
        activeRounds={activeRounds}
        cardSize={cardSize}
        hasFilters={hasFilters}
        availableExecutionRounds={availableExecutionRounds}
        tasks={tasks}
        sortedTasks={sortedTasks}
        groupedTasks={groupedTasks}
        visibleProjectTaskSummaries={visibleProjectTaskSummaries}
        gridClass={gridClassBySize[cardSize]}
        collapsedGroups={collapsedGroups}
        onSearchChange={setSearch}
        onClearSearch={() => setSearch('')}
        onSortChange={setSortBy}
        onCardSizeChange={setCardSize}
        onOpenProjectPanel={() => setShowProjectPanel(true)}
        onOpenProjectOverview={() => setShowProjectOverview(true)}
        onToggleType={toggleType}
        onToggleStage={toggleStage}
        onToggleRound={toggleRound}
        onClearFilters={clearFilters}
        onToggleGroupCollapse={toggleGroupCollapse}
        onSelectTask={detail.setSelected}
        onOpenTaskContextMenu={openTaskCardContextMenu}
        onDeleteTask={(task) => {
          setDeleteError('');
          setPendingDelete(task);
        }}
      />

      <BoardLayerStack
        taskCardContextMenu={taskCardContextMenu}
        taskCardContextMenuRef={taskCardContextMenuRef}
        availableTaskTypes={availableTaskTypes}
        statusOptions={COLUMNS}
        localFolderOpening={taskCardFolderOpening}
        localFolderError={taskCardContextMenuError}
        onOpenLocalFolder={() => {
          void handleOpenTaskLocalFolder();
        }}
        onCloseTaskCardContextMenu={closeTaskCardContextMenu}
        onTaskCardStatusChange={(status) => {
          if (!taskCardContextMenu) return;
          closeTaskCardContextMenu();
          void detail.handleStatusChange(taskCardContextMenu.task.id, status);
        }}
        onTaskCardTaskTypeChange={(taskType) => {
          if (!taskCardContextMenu) return;
          closeTaskCardContextMenu();
          void detail.handleTaskTypeChange(taskCardContextMenu.task.id, taskType);
        }}
        showProjectOverview={showProjectOverview}
        activeProject={activeProject}
        visibleProjectTaskSummaries={visibleProjectTaskSummaries}
        taskCount={tasks.length}
        onCloseProjectOverview={() => setShowProjectOverview(false)}
        onNormalizeProjectOverview={loadTasks}
        onOpenTaskContextMenu={openTaskCardContextMenu}
        onSelectTaskFromOverview={(task) => {
          setShowProjectOverview(false);
          detail.setSelected(task);
        }}
        pendingDelete={pendingDelete}
        deleting={deleting}
        deleteError={deleteError}
        onCancelDelete={() => {
          setPendingDelete(null);
          setDeleteError('');
        }}
        onConfirmDelete={() => void handleDeleteTask()}
        detail={detail}
        detailEscCloseHintVisible={drawerEscCloseHintVisible}
        onCloseDetailDrawer={closeDetailDrawer}
        projectQuotas={projectQuotas}
        sourceModelName={sourceModelName}
        onOpenPrompt={() => {
          if (!detail.selected) return;
          closeDetailDrawer();
          navigate(`/prompt?taskId=${detail.selected.id}`);
        }}
        onOpenSubmit={() => {
          if (!detail.selected) return;
          closeDetailDrawer();
          navigate(`/submit?taskId=${detail.selected.id}`);
        }}
        showProjectPanel={showProjectPanel}
        onCloseProjectPanel={() => setShowProjectPanel(false)}
        onProjectSaved={(updated) => {
          setActiveProject(updated);
          setShowProjectPanel(false);
        }}
      />
    </div>
  );
}
