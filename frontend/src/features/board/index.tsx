import { useState, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Events } from '@wailsio/runtime';
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
  submitJob,
  submitSessionSyncJob,
  submitAiReviewJob,
  type JobProgressEvent,
} from '../../api/job';
import type { ModelRunFromDB } from '../../api/task';
import {
  BatchActionBar,
} from './components/BatchActionBar';
import {
  CardSize,
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

const COLUMNS: TaskStatus[] = [
  'Claimed',
  'Downloading',
  'Downloaded',
  'PromptReady',
  'ExecutionCompleted',
  'Submitted',
  'Error',
];
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
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
    const cancel = Events.On('job:progress', (event: { data: JobProgressEvent }) => {
      const data = event.data;
      if (data.jobType === 'session_sync') {
        detail.handleSessionSyncEvent(data);
        if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
          void loadTasks();
        }
        return;
      }

      if (data.jobType !== 'prompt_generate') {
        return;
      }

      const taskId = data.taskId ?? '';
      if (!taskId) {
        return;
      }

      if (data.status === 'done') {
        useAppStore.setState((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status:
                    task.status === 'ExecutionCompleted' || task.status === 'Submitted'
                      ? task.status
                      : 'PromptReady',
                  promptGenerationStatus: 'done',
                  promptGenerationError: null,
                }
              : task,
          ),
        }));
        void loadTasks();
        return;
      }

      if (data.status === 'error') {
        useAppStore.setState((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  promptGenerationStatus: 'error',
                  promptGenerationError: data.errorMessage ?? null,
                }
              : task,
          ),
        }));
        void loadTasks();
        return;
      }

      if (data.status === 'cancelled') {
        useAppStore.setState((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  promptGenerationStatus: 'idle',
                  promptGenerationError: null,
                }
              : task,
          ),
        }));
        void loadTasks();
      }
    });

    return () => { cancel(); };
  }, [detail, loadTasks]);

  useEffect(() => {
    if (!taskCardContextMenu) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (taskCardContextMenuRef.current?.contains(target)) {
        return;
      }
      // Also allow clicks inside the prompt-gen fly-out portal
      if ((target as Element).closest?.('[data-prompt-gen-flyout]')) {
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

  useEffect(() => {
    if (!selectionMode || detail.selected) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        exitSelectionMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionMode, detail.selected]);

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      if (prev) setSelectedTaskIds(new Set());
      return !prev;
    });
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedTaskIds(new Set());
  };

  const handleGeneratePromptFromContextMenu = (constraints: string[], scope: string) => {
    if (!taskCardContextMenu) return;
    const { task } = taskCardContextMenu;
    closeTaskCardContextMenu();

    void (async () => {
      try {
        const inputPayload = JSON.stringify({
          taskId: task.id,
          taskType: task.taskType,
          constraints: constraints.length > 0 ? constraints : ['无约束'],
          scopes: scope ? [scope] : [],
          thinkingBudget: '',
        });
        await submitJob({
          jobType: 'prompt_generate',
          taskId: task.id,
          inputPayload,
          timeoutSeconds: 1200,
        });
        useAppStore.getState().loadBackgroundJobs();
      } finally {
        void loadTasks();
      }
    })();

    // Refresh quickly so the task card shows 'running' status
    window.setTimeout(() => void loadTasks(), 400);
  };

  const handleAiReview = (run: ModelRunFromDB) => {
    if (!detail.selected || !run.localPath) return;
    void (async () => {
      try {
        await submitAiReviewJob(detail.selected!.id, {
          modelRunId: run.id,
          modelName: run.modelName,
          localPath: run.localPath!,
        });
        useAppStore.getState().loadBackgroundJobs();
      } finally {
        void detail.refreshModelRuns();
      }
    })();
    window.setTimeout(() => void detail.refreshModelRuns(), 600);
  };

  const handleAfterBatchApply = async (
    field: 'status' | 'taskType',
    value: string,
    taskIds: string[],
  ) => {
    if (field !== 'status' || value !== 'ExecutionCompleted' || taskIds.length === 0) {
      return;
    }

    await Promise.allSettled(taskIds.map((taskId) => submitSessionSyncJob(taskId)));
    void useAppStore.getState().loadBackgroundJobs();
  };

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

  // 各维度的计数基准：排除自身维度，反映其他维度当前筛选的结果
  const tasksForStageCount = useMemo(
    () => filterBoardTasks(tasks, { search, activeTypes, activeStages: new Set(), activeRounds }),
    [tasks, search, activeTypes, activeRounds],
  );
  const tasksForRoundCount = useMemo(
    () => filterBoardTasks(tasks, { search, activeTypes, activeStages, activeRounds: new Set() }),
    [tasks, search, activeTypes, activeStages],
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
  const projectTaskRemainingToCompleteByType = useMemo(
    () =>
      Object.fromEntries(
        projectTaskSummaries.map((summary) => [
          summary.taskType,
          summary.remainingToCompleteCount,
        ]),
      ) as Record<string, number | null>,
    [projectTaskSummaries],
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
        tasksForStageCount={tasksForStageCount}
        tasksForRoundCount={tasksForRoundCount}
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
        selectionMode={selectionMode}
        selectedTaskIds={selectedTaskIds}
        onToggleSelectionMode={toggleSelectionMode}
        onToggleTaskSelection={toggleTaskSelection}
      />

      <BoardLayerStack
        taskCardContextMenu={taskCardContextMenu}
        taskCardContextMenuRef={taskCardContextMenuRef}
        availableTaskTypes={availableTaskTypes}
        statusOptions={COLUMNS}
        localFolderOpening={taskCardFolderOpening}
        actionError={taskCardContextMenuError}
        onOpenLocalFolder={() => {
          void handleOpenTaskLocalFolder();
        }}
        onTaskCardStatusChange={(status) => {
          if (!taskCardContextMenu) return;
          closeTaskCardContextMenu();
          void detail.handleStatusChange(taskCardContextMenu.task.id, status);
        }}
        onTaskCardGeneratePrompt={handleGeneratePromptFromContextMenu}
        onTaskCardTaskTypeChange={async (taskType) => {
          if (!taskCardContextMenu) return;
          setTaskCardContextMenuError('');
          const result = await detail.handleTaskTypeChange(
            taskCardContextMenu.task.id,
            taskType,
            { skipConfirm: true },
          );
          if (result.ok) {
            closeTaskCardContextMenu();
            return;
          }
          if (result.error) {
            setTaskCardContextMenuError(result.error);
          }
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
        taskTypeRemainingToCompleteByType={projectTaskRemainingToCompleteByType}
        sourceModelName={sourceModelName}
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
        onAiReview={handleAiReview}
      />

      {selectionMode && selectedTaskIds.size > 0 && (
        <BatchActionBar
          selectedCount={selectedTaskIds.size}
          selectedTaskIds={selectedTaskIds}
          availableTaskTypes={availableTaskTypes}
          onAfterApply={handleAfterBatchApply}
          onDone={() => {
            void loadTasks();
            exitSelectionMode();
          }}
          onCancel={exitSelectionMode}
        />
      )}
    </div>
  );
}
