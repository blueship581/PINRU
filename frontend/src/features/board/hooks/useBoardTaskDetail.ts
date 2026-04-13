import { useEffect, useMemo, useRef, useState } from 'react';
import type { TaskDetailDrawerTab } from '../../../shared/components/TaskDetailDrawer';
import {
  buildTaskTypeChangeConfirmMessage,
  DEFAULT_TASK_TYPE,
  getLlmProviders,
  getProjectTaskSettings,
  normalizeTaskTypeName,
  type ProjectConfig,
} from '../../../api/config';
import {
  generateTaskPrompt,
  saveTaskPrompt,
  type GeneratePromptRequest,
  type LlmProviderConfig,
} from '../../../api/llm';
import { submitJob } from '../../../api/job';
import {
  extractTaskSessions,
  getTask,
  listModelRuns,
  updateTaskSessionList,
  updateTaskStatus,
  updateTaskType,
  type ExtractTaskSessionCandidate,
  type ModelRunFromDB,
  type PromptGenerationStatus,
  type TaskFromDB,
  type TaskSession as TaskSessionRecord,
} from '../../../api/task';
import {
  buildSessionModelOptions,
  filterCandidatesForModel,
} from '../../../shared/lib/sessionCandidateUtils';
import {
  buildDraftsFromExtractedCandidate,
  buildSessionEditorOpenSet,
  createSessionDraft,
  hasSessionDraftChanges,
  hydrateSessionDrafts,
  mapSessionDraftsToSessionList,
  type EditableTaskSession,
} from '../../../shared/lib/sessionUtils';
import {
  PROMPT_GENERATION_STATUS,
  normalizePromptGenerationStatus,
} from '../components/BoardPresentation';
import { useAppStore, type Task, type TaskStatus } from '../../../store';

const PROMPT_GENERATION_TIMEOUT_MS = 1_200_000;

function getDefaultTaskDetailTab(status?: TaskStatus | null): TaskDetailDrawerTab {
  return status === 'Submitted' ? 'sessions' : 'prompt';
}

type UseBoardTaskDetailArgs = {
  activeProject: ProjectConfig | null;
  availableTaskTypes: string[];
  sourceModelName: string;
  tasks: Task[];
  loadTasks: () => Promise<void>;
  loadActiveProject: () => Promise<void>;
  updateTaskStatusInStore: (id: string, status: TaskStatus) => void;
  updateTaskTypeInStore: (id: string, taskType: string) => void;
};

export function useBoardTaskDetail({
  activeProject,
  availableTaskTypes,
  sourceModelName,
  tasks,
  loadTasks,
  loadActiveProject,
  updateTaskStatusInStore,
  updateTaskTypeInStore,
}: UseBoardTaskDetailArgs) {
  const [selected, setSelected] = useState<Task | null>(null);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskFromDB | null>(null);
  const [selectedModelRuns, setSelectedModelRuns] = useState<ModelRunFromDB[]>([]);
  const [selectedSessionModelName, setSelectedSessionModelName] = useState('');
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const [statusChanging, setStatusChanging] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptGeneratingTaskIds, setPromptGeneratingTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [llmProviders, setLlmProviders] = useState<LlmProviderConfig[]>([]);
  const [sessionListDraft, setSessionListDraft] = useState<EditableTaskSession[]>([]);
  const [sessionListSaving, setSessionListSaving] = useState(false);
  const [sessionSaveState, setSessionSaveState] = useState<'idle' | 'saved'>('idle');
  const [sessionExtracting, setSessionExtracting] = useState(false);
  const [sessionExtractCandidates, setSessionExtractCandidates] = useState<
    ExtractTaskSessionCandidate[]
  >([]);
  const [openSessionEditors, setOpenSessionEditors] = useState<Set<string>>(new Set());
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [taskTypeChanging, setTaskTypeChanging] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] =
    useState<TaskDetailDrawerTab>('prompt');
  const sessionDraftVersionRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);

  const sessionTaskTypeOptions = useMemo(
    () =>
      getProjectTaskSettings(activeProject, [
        ...tasks.map((task) => task.taskType),
        ...tasks.flatMap((task) =>
          task.sessionList.map((session) => session.taskType),
        ),
        ...sessionListDraft.map((session) => session.taskType),
      ]).taskTypes,
    [activeProject, sessionListDraft, tasks],
  );

  const selectedPromptGenerationStatus = normalizePromptGenerationStatus(
    selectedTaskDetail?.promptGenerationStatus ??
      selected?.promptGenerationStatus,
  );
  const selectedPromptGenerationMeta =
    PROMPT_GENERATION_STATUS[selectedPromptGenerationStatus];
  const selectedPromptGenerationError =
    selectedTaskDetail?.promptGenerationError ??
    selected?.promptGenerationError ??
    null;
  const promptSaveState: 'idle' | 'saved' =
    promptDraft === (selectedTaskDetail?.promptText ?? '') ? 'saved' : 'idle';
  const promptGenerating =
    selected?.id !== undefined && selected?.id !== null
      ? promptGeneratingTaskIds.has(selected.id)
      : false;
  const sessionModelOptions = useMemo(
    () => buildSessionModelOptions(selectedModelRuns, sourceModelName),
    [selectedModelRuns, sourceModelName],
  );
  const selectedSessionModelRun = useMemo(
    () =>
      selectedModelRuns.find(
        (run) => run.modelName === selectedSessionModelName,
      ) ?? null,
    [selectedModelRuns, selectedSessionModelName],
  );
  const primaryTaskType =
    normalizeTaskTypeName(
      sessionListDraft[0]?.taskType ??
        selectedSessionModelRun?.sessionList?.[0]?.taskType ??
        selectedTaskDetail?.sessionList?.[0]?.taskType ??
        selectedTaskDetail?.taskType ??
        selected?.taskType ??
        availableTaskTypes[0] ??
        DEFAULT_TASK_TYPE,
    ) || DEFAULT_TASK_TYPE;
  const sessionFallbackTaskType =
    selectedTaskDetail?.taskType ??
    selected?.taskType ??
    availableTaskTypes[0] ??
    DEFAULT_TASK_TYPE;
  const persistedSessionList =
    selectedSessionModelRun?.sessionList ??
    selectedTaskDetail?.sessionList ??
    selected?.sessionList ??
    null;
  const hasUnsavedSessionChanges = useMemo(
    () =>
      selected !== null &&
      hasSessionDraftChanges(
        sessionListDraft,
        persistedSessionList,
        sessionFallbackTaskType,
      ),
    [persistedSessionList, selected, sessionFallbackTaskType, sessionListDraft],
  );

  const hydrateSessionDraftState = (
    modelName: string,
    taskDetail: TaskFromDB | null,
    modelRuns: ModelRunFromDB[],
    selectedTask: Task | null,
  ) => {
    const fallbackTaskType =
      taskDetail?.taskType ??
      selectedTask?.taskType ??
      availableTaskTypes[0] ??
      DEFAULT_TASK_TYPE;
    const nextPersistedSessionList =
      modelRuns.find((run) => run.modelName === modelName)?.sessionList ??
      taskDetail?.sessionList ??
      selectedTask?.sessionList ??
      null;
    const hydratedSessions = hydrateSessionDrafts(
      nextPersistedSessionList,
      fallbackTaskType,
    );
    sessionDraftVersionRef.current = 0;
    setSessionListDraft(hydratedSessions);
    setSessionExtractCandidates([]);
    setOpenSessionEditors(buildSessionEditorOpenSet(hydratedSessions));
    setCopiedSessionId(null);
    setSessionSaveState('idle');
  };

  const setTaskPromptGenerating = (taskId: string, isGenerating: boolean) => {
    setPromptGeneratingTaskIds((prev) => {
      const next = new Set(prev);
      if (isGenerating) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const patchTaskSummaryState = (taskId: string, patch: Partial<Task>) => {
    setSelected((prev) =>
      prev?.id === taskId ? { ...prev, ...patch } : prev,
    );
    useAppStore.setState((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, ...patch } : task,
      ),
    }));
  };

  useEffect(() => {
    selectedTaskIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || sessionModelOptions.length === 0) {
      setSelectedSessionModelName('');
      return;
    }
    if (
      sessionModelOptions.some(
        (option) => option.modelName === selectedSessionModelName,
      )
    ) {
      return;
    }
    setSelectedSessionModelName(sessionModelOptions[0].modelName);
  }, [selected, selectedSessionModelName, sessionModelOptions]);

  useEffect(() => {
    if (!selected?.id) {
      sessionDraftVersionRef.current = 0;
      setSelectedTaskDetail(null);
      setSelectedModelRuns([]);
      setSelectedSessionModelName('');
      setDrawerError('');
      setPromptDraft('');
      setSessionListDraft([]);
      setSessionExtractCandidates([]);
      setOpenSessionEditors(new Set());
      setCopiedSessionId(null);
      setSessionSaveState('idle');
      setActiveDrawerTab(getDefaultTaskDetailTab());
      return;
    }

    let cancelled = false;
    setActiveDrawerTab(getDefaultTaskDetailTab(selected.status));
    setDrawerLoading(true);
    setDrawerError('');

    (async () => {
      const [taskDetail, modelRuns] = await Promise.all([
        getTask(selected.id),
        listModelRuns(selected.id),
      ]);
      if (cancelled) {
        return;
      }

      setSelectedTaskDetail(taskDetail);
      setPromptDraft(taskDetail?.promptText ?? '');
      setPromptCopied(false);
      setSelectedModelRuns(modelRuns);
      const initialSessionModelName =
        buildSessionModelOptions(modelRuns, sourceModelName)[0]?.modelName ?? '';
      setSelectedSessionModelName(initialSessionModelName);
      hydrateSessionDraftState(
        initialSessionModelName,
        taskDetail,
        modelRuns,
        selected,
      );
      setDrawerLoading(false);
    })().catch((error) => {
      if (cancelled) {
        return;
      }
      setDrawerError(error instanceof Error ? error.message : '详情加载失败');
      setDrawerLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selected?.id, sourceModelName]);

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    setStatusChanging(true);
    try {
      await updateTaskStatus(taskId, newStatus);
      updateTaskStatusInStore(taskId, newStatus);
      setSelected((prev) =>
        prev?.id === taskId ? { ...prev, status: newStatus } : prev,
      );
      setSelectedTaskDetail((prev) =>
        prev?.id === taskId ? { ...prev, status: newStatus } : prev,
      );
    } catch (error) {
      console.error('Failed to update task status:', error);
    } finally {
      setStatusChanging(false);
    }
  };

  const refreshTaskTypeChangeState = async (
    taskId: string,
    shouldRefreshDetail: boolean,
  ) => {
    if (!shouldRefreshDetail) {
      await Promise.all([loadActiveProject(), loadTasks()]);
      return;
    }

    const [_, __, taskDetail, modelRuns] = await Promise.all([
      loadActiveProject(),
      loadTasks(),
      getTask(taskId),
      listModelRuns(taskId),
    ]);

    const latestTask =
      useAppStore.getState().tasks.find((task) => task.id === taskId) ?? null;
    if (latestTask) {
      setSelected((prev) => (prev?.id === taskId ? latestTask : prev));
    }

    setSelectedTaskDetail(taskDetail);
    setSelectedModelRuns(modelRuns);
    const nextSessionModelName =
      modelRuns.some((run) => run.modelName === selectedSessionModelName)
        ? selectedSessionModelName
        : buildSessionModelOptions(modelRuns, sourceModelName)[0]?.modelName ?? '';
    setSelectedSessionModelName(nextSessionModelName);
    hydrateSessionDraftState(
      nextSessionModelName,
      taskDetail,
      modelRuns,
      latestTask,
    );
  };

  const handleTaskTypeChange = async (
    taskId: string,
    nextTaskType: string,
    options?: {
      skipConfirm?: boolean;
    },
  ) => {
    const normalizedTaskType = normalizeTaskTypeName(nextTaskType);
    const taskFromStore = tasks.find((task) => task.id === taskId);
    const isSelectedTask = selected?.id === taskId;
    const currentTaskType =
      normalizeTaskTypeName(
        isSelectedTask ? primaryTaskType : taskFromStore?.taskType ?? '',
      ) || (isSelectedTask ? primaryTaskType : taskFromStore?.taskType ?? '');

    if (
      !normalizedTaskType ||
      !currentTaskType ||
      normalizedTaskType === currentTaskType
    ) {
      return {
        ok: false,
        error: '',
      };
    }

    if (
      !options?.skipConfirm &&
      !window.confirm(
        buildTaskTypeChangeConfirmMessage(
          currentTaskType,
          normalizedTaskType,
        ),
      )
    ) {
      return {
        ok: false,
        error: '',
      };
    }

    const previousTaskType = taskFromStore?.taskType ?? currentTaskType;
    const previousSelected = selected;
    const previousTaskDetail = selectedTaskDetail;
    const previousSessionListDraft = sessionListDraft;

    updateTaskTypeInStore(taskId, normalizedTaskType);

    if (isSelectedTask) {
      setSelected((prev) =>
        prev?.id === taskId
          ? { ...prev, taskType: normalizedTaskType }
          : prev,
      );
      setSelectedTaskDetail((prev) => {
        if (!prev || prev.id !== taskId) {
          return prev;
        }

        const nextSessionList =
          prev.sessionList.length > 0
            ? prev.sessionList.map((session, index) =>
                index === 0
                  ? { ...session, taskType: normalizedTaskType }
                  : session,
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
    let updateError: unknown = null;
    let refreshError: unknown = null;
    let result: { ok: boolean; error: string } = {
      ok: true,
      error: '',
    };

    try {
      await updateTaskType(taskId, normalizedTaskType);
    } catch (error) {
      updateError = error;
    }

    try {
      await refreshTaskTypeChangeState(taskId, isSelectedTask);
    } catch (error) {
      refreshError = error;
    }

    if (updateError) {
      if (refreshError) {
        updateTaskTypeInStore(taskId, previousTaskType);
        if (isSelectedTask) {
          setSelected(previousSelected);
          setSelectedTaskDetail(previousTaskDetail);
          setSessionListDraft(previousSessionListDraft);
        }
      }

      const message =
        updateError instanceof Error ? updateError.message : '任务类型更新失败';
      if (isSelectedTask) {
        setDrawerError(message);
      } else {
        console.error('Failed to update task type:', updateError);
      }
      result = {
        ok: false,
        error: message,
      };
      setTaskTypeChanging(false);
      return result;
    } else if (refreshError) {
      console.error('Failed to refresh task type change state:', refreshError);
      if (isSelectedTask) {
        setDrawerError(
          '任务类型已更新，但详情刷新失败，请重新打开题卡查看最新状态',
        );
      }
      result = {
        ok: true,
        error:
          '任务类型已更新，但详情刷新失败，请重新打开题卡查看最新状态',
      };
      setTaskTypeChanging(false);
      return result;
    }

    setTaskTypeChanging(false);
    return result;
  };

  const handlePromptSave = async () => {
    if (!selected?.id) {
      return;
    }
    if (!promptDraft.trim()) {
      setDrawerError('提示词不能为空');
      return;
    }

    setPromptSaving(true);
    setDrawerError('');
    try {
      await saveTaskPrompt(selected.id, promptDraft);
      const now = Math.floor(Date.now() / 1000);
      setSelectedTaskDetail((prev) =>
        prev
          ? {
              ...prev,
              promptText: promptDraft,
              status: 'PromptReady',
              promptGenerationStatus: 'done',
              promptGenerationError: null,
              promptGenerationStartedAt:
                prev.promptGenerationStartedAt ?? now,
              promptGenerationFinishedAt: now,
            }
          : prev,
      );
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              status: 'PromptReady',
              promptGenerationStatus: 'done' as PromptGenerationStatus,
              promptGenerationError: null,
            }
          : prev,
      );
      updateTaskStatusInStore(selected.id, 'PromptReady');
      await loadTasks();
    } catch (error) {
      setDrawerError(error instanceof Error ? error.message : '提示词保存失败');
    } finally {
      setPromptSaving(false);
    }
  };

  const handlePromptCopy = async () => {
    if (!promptDraft.trim()) {
      return;
    }
    await navigator.clipboard.writeText(promptDraft);
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1500);
  };

  const handlePromptDraftChange = (value: string) => {
    setPromptDraft(value);
  };

  const handlePromptReset = () => {
    setPromptDraft(selectedTaskDetail?.promptText ?? '');
  };

  useEffect(() => {
    getLlmProviders()
      .then(setLlmProviders)
      .catch(() => setLlmProviders([]));
  }, []);

  const handleGeneratePrompt = async (config: Omit<GeneratePromptRequest, 'taskId'>) => {
    const taskId = selected?.id;
    if (!taskId) return;

    setTaskPromptGenerating(taskId, true);
    setDrawerError('');

    const inputPayload = JSON.stringify({ taskId, ...config });

    try {
      await submitJob({
        jobType: 'prompt_generate',
        taskId,
        inputPayload,
        timeoutSeconds: PROMPT_GENERATION_TIMEOUT_MS / 1000,
      });
      const now = Math.floor(Date.now() / 1000);
      setSelectedTaskDetail((prev) =>
        prev?.id === taskId
          ? {
              ...prev,
              promptGenerationStatus: 'running',
              promptGenerationError: null,
              promptGenerationStartedAt: prev.promptGenerationStartedAt ?? now,
              promptGenerationFinishedAt: null,
            }
          : prev,
      );
      patchTaskSummaryState(taskId, {
        promptGenerationStatus: 'running',
        promptGenerationError: null,
      });
      useAppStore.getState().loadBackgroundJobs();
    } catch (submitErr) {
      if (selectedTaskIdRef.current === taskId) {
        setDrawerError(
          submitErr instanceof Error ? submitErr.message : '提交后台任务失败',
        );
      }
      setTaskPromptGenerating(taskId, false);
      return;
    }

    // Poll task detail until prompt generation completes
    let safetyTimeout = 0;
    const pollInterval = window.setInterval(async () => {
      try {
        const taskDetail = await getTask(taskId);
        if (!taskDetail) return;

        const status = normalizePromptGenerationStatus(taskDetail.promptGenerationStatus);
        if (status === 'done') {
          window.clearInterval(pollInterval);
          window.clearTimeout(safetyTimeout);
          if (selectedTaskIdRef.current === taskId) {
            setPromptDraft(taskDetail.promptText ?? '');
            setSelectedTaskDetail(taskDetail);
          }
          patchTaskSummaryState(taskId, {
            status: 'PromptReady' as TaskStatus,
            promptGenerationStatus: 'done' as PromptGenerationStatus,
            promptGenerationError: null,
          });
          updateTaskStatusInStore(taskId, 'PromptReady');
          setTaskPromptGenerating(taskId, false);
          await loadTasks();
          useAppStore.getState().loadBackgroundJobs();
        } else if (status === 'error') {
          window.clearInterval(pollInterval);
          window.clearTimeout(safetyTimeout);
          if (selectedTaskIdRef.current === taskId) {
            setSelectedTaskDetail(taskDetail);
            setDrawerError(taskDetail.promptGenerationError ?? '提示词生成失败');
          }
          patchTaskSummaryState(taskId, {
            promptGenerationStatus: 'error' as PromptGenerationStatus,
            promptGenerationError: taskDetail.promptGenerationError,
          });
          setTaskPromptGenerating(taskId, false);
          await loadTasks();
          useAppStore.getState().loadBackgroundJobs();
        }
      } catch {
        // ignore poll errors
      }
    }, 1500);

    // Safety: stop polling after the background job timeout window.
    safetyTimeout = window.setTimeout(() => {
      window.clearInterval(pollInterval);
      if (selectedTaskIdRef.current === taskId) {
        setDrawerError('提示词生成等待超时，请查看后台任务面板或重试');
      }
      setTaskPromptGenerating(taskId, false);
    }, PROMPT_GENERATION_TIMEOUT_MS);
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
      isCompleted: true,
      isSatisfied: true,
      evaluation: '',
    });
    sessionDraftVersionRef.current += 1;
    setSessionListDraft((prev) => [...prev, nextSession]);
    setOpenSessionEditors((prev) => new Set(prev).add(nextSession.localId));
    setSessionSaveState('idle');
  };

  const handleSessionChange = (
    localId: string,
    patch: Partial<
      Pick<
        EditableTaskSession,
        | 'sessionId'
        | 'taskType'
        | 'consumeQuota'
        | 'isCompleted'
        | 'isSatisfied'
        | 'evaluation'
        | 'userConversation'
      >
    >,
  ) => {
    sessionDraftVersionRef.current += 1;
    setSessionListDraft((prev) =>
      prev.map((session, index) => {
        if (session.localId !== localId) {
          return session;
        }
        return {
          ...session,
          ...patch,
          consumeQuota:
            index === 0 ? true : patch.consumeQuota ?? session.consumeQuota,
        };
      }),
    );
    setSessionSaveState('idle');
  };

  const handleSessionListSave = async (options?: {
    drafts?: EditableTaskSession[];
    skipIfUnchanged?: boolean;
    modelRunId?: string | null;
  }) => {
    if (!selected?.id || sessionListSaving) {
      return false;
    }

    const draftToSave = options?.drafts ?? sessionListDraft;
    const targetModelRunId =
      options?.modelRunId ?? selectedSessionModelRun?.id ?? null;
    if (
      options?.skipIfUnchanged &&
      !hasSessionDraftChanges(
        draftToSave,
        persistedSessionList,
        sessionFallbackTaskType,
      )
    ) {
      return true;
    }

    if (draftToSave.length === 0) {
      setDrawerError('至少保留一个 session');
      return false;
    }

    for (let index = 0; index < draftToSave.length; index += 1) {
      const session = draftToSave[index];
      if (session.isCompleted === null || session.isCompleted === undefined) {
        setDrawerError(`第 ${index + 1} 轮请选择是否完成`);
        return false;
      }
      if (session.isSatisfied === null || session.isSatisfied === undefined) {
        setDrawerError(`第 ${index + 1} 轮请选择是否满意`);
        return false;
      }
    }

    const nextSessionList: TaskSessionRecord[] = mapSessionDraftsToSessionList(
      draftToSave,
      selected.taskType,
    );
    const saveVersion = sessionDraftVersionRef.current;

    setSessionListSaving(true);
    setDrawerError('');
    try {
      await updateTaskSessionList({
        id: selected.id,
        modelRunId: targetModelRunId,
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
        prev
          ? {
              ...prev,
              taskType: nextTaskType,
              sessionList:
                targetModelRunId === null ? nextSessionList : prev.sessionList,
            }
          : prev,
      );
      setSelectedModelRuns((prev) =>
        prev.map((run) =>
          run.id === targetModelRunId
            ? {
                ...run,
                sessionList: nextSessionList,
                sessionId:
                  [...nextSessionList]
                    .reverse()
                    .find((session) => session.sessionId.trim())?.sessionId ??
                  null,
                conversationRounds: nextSessionList.length,
                conversationDate: Math.floor(Date.now() / 1000),
              }
            : run,
        ),
      );

      const hydratedSessions = hydrateSessionDrafts(
        nextSessionList,
        nextTaskType,
      );
      const shouldSyncDraftState =
        sessionDraftVersionRef.current === saveVersion;

      if (shouldSyncDraftState) {
        sessionDraftVersionRef.current = saveVersion;
        setSessionListDraft(hydratedSessions);
        setOpenSessionEditors(buildSessionEditorOpenSet(hydratedSessions));
        setCopiedSessionId(null);
        setSessionSaveState('saved');
      } else {
        setSessionSaveState('idle');
      }

      await Promise.all([loadTasks(), loadActiveProject()]);
      if (shouldSyncDraftState) {
        window.setTimeout(() => setSessionSaveState('idle'), 1600);
      }
      return true;
    } catch (error) {
      setDrawerError(error instanceof Error ? error.message : 'session 保存失败');
      return false;
    } finally {
      setSessionListSaving(false);
    }
  };

  const handleRemoveSession = (localId: string) => {
    const targetIndex = sessionListDraft.findIndex(
      (session) => session.localId === localId,
    );
    if (targetIndex < 0) {
      return;
    }

    if (!window.confirm(`确认删除第 ${targetIndex + 1} 轮 session 吗？`)) {
      return;
    }

    const nextDrafts = sessionListDraft
      .filter((session) => session.localId !== localId)
      .map((session, index) =>
        index === 0 ? { ...session, consumeQuota: true } : session,
      );

    sessionDraftVersionRef.current += 1;
    setSessionListDraft(nextDrafts);
    setOpenSessionEditors((prev) => {
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
    setCopiedSessionId((prev) => (prev === localId ? null : prev));
    setSessionSaveState('idle');
    void handleSessionListSave({
      drafts: nextDrafts,
      modelRunId: selectedSessionModelRun?.id ?? null,
    });
  };

  const handleResetSessions = () => {
    hydrateSessionDraftState(
      selectedSessionModelName,
      selectedTaskDetail,
      selectedModelRuns,
      selected,
    );
  };

  const applyExtractedSessionCandidate = (
    candidate: ExtractTaskSessionCandidate,
  ) => {
    const fallbackTaskType =
      selectedTaskDetail?.taskType ??
      selected?.taskType ??
      availableTaskTypes[0] ??
      DEFAULT_TASK_TYPE;

    const nextDrafts = buildDraftsFromExtractedCandidate(
      candidate,
      sessionListDraft,
      fallbackTaskType,
    );
    if (nextDrafts.length === 0) {
      setDrawerError('提取结果中没有可用的 session');
      return;
    }

    sessionDraftVersionRef.current += 1;
    setSessionListDraft(nextDrafts);
    setSessionExtractCandidates([]);
    setOpenSessionEditors(buildSessionEditorOpenSet(nextDrafts));
    setCopiedSessionId(null);
    setSessionSaveState('idle');
    setDrawerError('');
  };

  const handleAutoExtractSessions = async () => {
    if (!selected?.id) {
      return;
    }

    setSessionExtracting(true);
    setSessionExtractCandidates([]);
    setDrawerError('');
    try {
      const result = await extractTaskSessions(selected.id);
      const scopedCandidates = filterCandidatesForModel(
        result.candidates,
        selectedModelRuns,
        selectedSessionModelName,
      );

      if (scopedCandidates.length === 0) {
        if (selectedSessionModelName) {
          setDrawerError(
            `未在 Trae 中找到与模型 ${selectedSessionModelName} 对应的对话`,
          );
        } else {
          setDrawerError('未在 Trae 中找到与当前题卡匹配的对话');
        }
        return;
      }

      if (scopedCandidates.length === 1) {
        applyExtractedSessionCandidate(scopedCandidates[0]);
        return;
      }

      setSessionExtractCandidates(scopedCandidates);
    } catch (error) {
      setDrawerError(
        error instanceof Error ? error.message : '自动提取 session 失败',
      );
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

  const handleSessionModelChange = async (modelName: string) => {
    if (modelName === selectedSessionModelName) {
      return;
    }

    const saved = await handleSessionListSave({
      skipIfUnchanged: true,
      modelRunId: selectedSessionModelRun?.id ?? null,
    });
    if (!saved) {
      return;
    }

    setSelectedSessionModelName(modelName);
    hydrateSessionDraftState(
      modelName,
      selectedTaskDetail,
      selectedModelRuns,
      selected,
    );
  };

  const handleCopySessionId = async (localId: string, sessionId: string) => {
    if (!sessionId.trim()) {
      return;
    }
    await navigator.clipboard.writeText(sessionId.trim());
    setCopiedSessionId(localId);
    window.setTimeout(() => {
      setCopiedSessionId((current) => (current === localId ? null : current));
    }, 1500);
  };

  const handleSessionEditorBlur = async () => {
    await handleSessionListSave({
      skipIfUnchanged: true,
      modelRunId: selectedSessionModelRun?.id ?? null,
    });
  };

  const closeSessionExtractCandidates = () => {
    setSessionExtractCandidates([]);
  };

  return {
    selected,
    setSelected,
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
    sessionExtractCandidates,
    openSessionEditors,
    copiedSessionId,
    promptDraft,
    promptSaving,
    promptSaveState,
    promptCopied,
    activeDrawerTab,
    setActiveDrawerTab,
    sessionModelOptions,
    selectedSessionModelName,
    handleSessionModelChange,
    sessionTaskTypeOptions,
    selectedPromptGenerationStatus,
    selectedPromptGenerationMeta,
    selectedPromptGenerationError,
    handleStatusChange,
    handleTaskTypeChange,
    handleAddSession,
    handleAutoExtractSessions,
    handleSessionChange,
    toggleSessionEditor,
    handleSessionEditorBlur,
    handleCopySessionId,
    handleRemoveSession,
    handleResetSessions,
    handleSessionListSave,
    handlePromptDraftChange,
    handlePromptCopy,
    handlePromptReset,
    handlePromptSave,
    promptGenerating,
    llmProviders,
    handleGeneratePrompt,
    applyExtractedSessionCandidate,
    closeSessionExtractCandidates,
  };
}

export type BoardTaskDetailController = ReturnType<typeof useBoardTaskDetail>;
