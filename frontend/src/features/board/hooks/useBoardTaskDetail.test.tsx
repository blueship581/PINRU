import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardTaskDetail } from './useBoardTaskDetail';
import { useAppStore, type Task } from '../../../store';
import type { ProjectConfig } from '../../../api/config';
import type { TaskFromDB } from '../../../api/task';

const {
  mockGetLlmProviders,
  mockSubmitJob,
  mockListJobs,
  mockGetTask,
  mockListModelRuns,
  mockListAiReviewNodes,
  mockListAiReviewRounds,
  mockUpdateTaskType,
} = vi.hoisted(() => ({
  mockGetLlmProviders: vi.fn(),
  mockSubmitJob: vi.fn(),
  mockListJobs: vi.fn(),
  mockGetTask: vi.fn(),
  mockListModelRuns: vi.fn(),
  mockListAiReviewNodes: vi.fn(),
  mockListAiReviewRounds: vi.fn(),
  mockUpdateTaskType: vi.fn(),
}));

vi.mock('../../../api/config', async () => {
  const actual = await vi.importActual<typeof import('../../../api/config')>(
    '../../../api/config',
  );
  return {
    ...actual,
    getLlmProviders: mockGetLlmProviders,
  };
});

vi.mock('../../../api/job', async () => {
  const actual = await vi.importActual<typeof import('../../../api/job')>(
    '../../../api/job',
  );
  return {
    ...actual,
    submitJob: mockSubmitJob,
    listJobs: mockListJobs,
  };
});

vi.mock('../../../api/task', async () => {
  const actual = await vi.importActual<typeof import('../../../api/task')>(
    '../../../api/task',
  );
  return {
    ...actual,
    getTask: mockGetTask,
    listModelRuns: mockListModelRuns,
    listAiReviewNodes: mockListAiReviewNodes,
    listAiReviewRounds: mockListAiReviewRounds,
    updateTaskType: mockUpdateTaskType,
  };
});

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    projectId: overrides.projectId ?? '1849',
    projectName: overrides.projectName ?? 'label-01849',
    status: overrides.status ?? 'Claimed',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [],
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'idle',
    promptGenerationError: overrides.promptGenerationError ?? null,
    createdAt: overrides.createdAt ?? 1,
    executionRounds: overrides.executionRounds ?? 1,
    aiReviewRounds: overrides.aiReviewRounds ?? 0,
    aiReviewStatus: overrides.aiReviewStatus ?? 'none',
    progress: overrides.progress ?? 0,
    totalModels: overrides.totalModels ?? 0,
    runningModels: overrides.runningModels ?? 0,
  };
}

function createTaskDetail(overrides: Partial<TaskFromDB> = {}): TaskFromDB {
  return {
    id: overrides.id ?? 'task-1',
    gitlabProjectId: overrides.gitlabProjectId ?? 1849,
    projectName: overrides.projectName ?? 'label-01849',
    status: overrides.status ?? 'Claimed',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [],
    localPath: overrides.localPath ?? '/tmp/task',
    promptText: overrides.promptText ?? '',
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'idle',
    promptGenerationError: overrides.promptGenerationError ?? null,
    promptGenerationStartedAt: overrides.promptGenerationStartedAt ?? null,
    promptGenerationFinishedAt: overrides.promptGenerationFinishedAt ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    notes: overrides.notes ?? null,
    projectConfigId: overrides.projectConfigId ?? null,
    projectType: overrides.projectType ?? '',
    changeScope: overrides.changeScope ?? '',
  };
}

describe('useBoardTaskDetail prompt generation', () => {
  beforeEach(() => {
    mockGetLlmProviders.mockResolvedValue([]);
    mockSubmitJob.mockResolvedValue({ id: 'job-1' });
    mockListJobs.mockResolvedValue([]);
    mockListModelRuns.mockResolvedValue([]);
    mockListAiReviewNodes.mockResolvedValue([]);
    mockListAiReviewRounds.mockResolvedValue([]);
    useAppStore.setState({ tasks: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps promptGenerating scoped to the task that started generation', async () => {
    const taskA = createTask({ id: 'task-1', projectName: 'alpha' });
    const taskB = createTask({ id: 'task-2', projectName: 'beta' });

    const taskDetails: Record<string, TaskFromDB> = {
      'task-1': createTaskDetail({ id: 'task-1', projectName: 'alpha' }),
      'task-2': createTaskDetail({ id: 'task-2', projectName: 'beta' }),
    };

    mockGetTask.mockImplementation(async (taskId: string) => taskDetails[taskId] ?? null);

    const activeProject: ProjectConfig = {
      id: 'project-1',
      name: 'PINRU',
      gitlabUrl: '',
      gitlabToken: '',
      hasGitLabToken: false,
      cloneBasePath: '',
      models: 'ORIGIN',
      sourceModelFolder: 'ORIGIN',
      defaultSubmitRepo: '',
      taskTypes: '',
      taskTypeQuotas: '',
      taskTypeTotals: '',
      overviewMarkdown: '',
      createdAt: 1,
      updatedAt: 1,
    };

    const loadTasks = vi.fn().mockResolvedValue(undefined);
    const loadActiveProject = vi.fn().mockResolvedValue(undefined);
    const updateTaskStatusInStore = vi.fn();
    const updateTaskTypeInStore = vi.fn();

    const { result } = renderHook(() =>
      useBoardTaskDetail({
        activeProject,
        availableTaskTypes: ['Bug修复'],
        sourceModelName: 'ORIGIN',
        tasks: [taskA, taskB],
        loadTasks,
        loadActiveProject,
        updateTaskStatusInStore,
        updateTaskTypeInStore,
      }),
    );

    act(() => {
      result.current.setSelected(taskA);
    });

    await waitFor(() => {
      expect(result.current.selectedTaskDetail?.id).toBe('task-1');
    });

    await act(async () => {
      await result.current.handleGeneratePrompt({
        providerId: null,
        taskType: 'Bug修复',
        scopes: ['单文件'],
        constraints: ['无约束'],
      });
    });

    expect(result.current.promptGenerating).toBe(true);

    act(() => {
      result.current.setSelected(taskB);
    });

    await waitFor(() => {
      expect(result.current.selectedTaskDetail?.id).toBe('task-2');
    });

    expect(result.current.promptGenerating).toBe(false);

    taskDetails['task-1'] = createTaskDetail({
      id: 'task-1',
      projectName: 'alpha',
      status: 'PromptReady',
      promptText: 'task-a prompt',
      promptGenerationStatus: 'done',
      promptGenerationFinishedAt: 10,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1600));
    });

    await waitFor(() => {
      expect(loadTasks).toHaveBeenCalled();
    });

    expect(result.current.selectedTaskDetail?.id).toBe('task-2');
    expect(result.current.promptDraft).toBe('');
    expect(result.current.selected?.id).toBe('task-2');
    expect(result.current.promptGenerating).toBe(false);
  });

  it('derives promptSaveState from persisted prompt text after reopen and edit', async () => {
    const task = createTask({ id: 'task-1', projectName: 'alpha' });
    const activeProject: ProjectConfig = {
      id: 'project-1',
      name: 'PINRU',
      gitlabUrl: '',
      gitlabToken: '',
      hasGitLabToken: false,
      cloneBasePath: '',
      models: 'ORIGIN',
      sourceModelFolder: 'ORIGIN',
      defaultSubmitRepo: '',
      taskTypes: '',
      taskTypeQuotas: '',
      taskTypeTotals: '',
      overviewMarkdown: '',
      createdAt: 1,
      updatedAt: 1,
    };

    mockGetTask.mockResolvedValue(
      createTaskDetail({
        id: 'task-1',
        projectName: 'alpha',
        status: 'PromptReady',
        promptText: 'persisted prompt',
        promptGenerationStatus: 'done',
      }),
    );

    const loadTasks = vi.fn().mockResolvedValue(undefined);
    const loadActiveProject = vi.fn().mockResolvedValue(undefined);
    const updateTaskStatusInStore = vi.fn();
    const updateTaskTypeInStore = vi.fn();

    const { result } = renderHook(() =>
      useBoardTaskDetail({
        activeProject,
        availableTaskTypes: ['Bug修复'],
        sourceModelName: 'ORIGIN',
        tasks: [task],
        loadTasks,
        loadActiveProject,
        updateTaskStatusInStore,
        updateTaskTypeInStore,
      }),
    );

    act(() => {
      result.current.setSelected(task);
    });

    await waitFor(() => {
      expect(result.current.selectedTaskDetail?.id).toBe('task-1');
    });

    expect(result.current.promptDraft).toBe('persisted prompt');
    expect(result.current.promptSaveState).toBe('saved');

    act(() => {
      result.current.handlePromptDraftChange('persisted prompt with edits');
    });

    expect(result.current.promptSaveState).toBe('idle');

    act(() => {
      result.current.handlePromptReset();
    });

    expect(result.current.promptDraft).toBe('persisted prompt');
    expect(result.current.promptSaveState).toBe('saved');
  });

  it('treats null model run payloads as an empty array when opening task detail', async () => {
    const task = createTask({ id: 'task-1', projectName: 'alpha' });
    const activeProject: ProjectConfig = {
      id: 'project-1',
      name: 'PINRU',
      gitlabUrl: '',
      gitlabToken: '',
      hasGitLabToken: false,
      cloneBasePath: '',
      models: 'ORIGIN',
      sourceModelFolder: 'ORIGIN',
      defaultSubmitRepo: '',
      taskTypes: '',
      taskTypeQuotas: '',
      taskTypeTotals: '',
      overviewMarkdown: '',
      createdAt: 1,
      updatedAt: 1,
    };

    mockGetTask.mockResolvedValue(
      createTaskDetail({
        id: 'task-1',
        projectName: 'alpha',
      }),
    );
    mockListModelRuns.mockResolvedValue(null);

    const loadTasks = vi.fn().mockResolvedValue(undefined);
    const loadActiveProject = vi.fn().mockResolvedValue(undefined);
    const updateTaskStatusInStore = vi.fn();
    const updateTaskTypeInStore = vi.fn();

    const { result } = renderHook(() =>
      useBoardTaskDetail({
        activeProject,
        availableTaskTypes: ['Bug修复'],
        sourceModelName: 'ORIGIN',
        tasks: [task],
        loadTasks,
        loadActiveProject,
        updateTaskStatusInStore,
        updateTaskTypeInStore,
      }),
    );

    act(() => {
      result.current.setSelected(task);
    });

    await waitFor(() => {
      expect(result.current.selectedTaskDetail?.id).toBe('task-1');
    });

    expect(result.current.selectedModelRuns).toEqual([]);
    expect(result.current.sessionModelOptions).toEqual([]);
    expect(result.current.drawerError).toBe('');
  });

  it('blocks task type migration before optimistic update and shows a friendly limit message', async () => {
    const featureTask = createTask({
      id: 'task-1',
      projectId: '1849',
      projectName: 'alpha',
      taskType: 'Feature迭代',
    });
    const bugTask = createTask({
      id: 'task-2',
      projectId: '1849',
      projectName: 'alpha',
      taskType: 'Bug修复',
    });
    const activeProject: ProjectConfig = {
      id: 'project-1',
      name: 'PINRU',
      gitlabUrl: '',
      gitlabToken: '',
      hasGitLabToken: false,
      cloneBasePath: '',
      models: 'ORIGIN',
      sourceModelFolder: 'ORIGIN',
      defaultSubmitRepo: '',
      taskTypes: 'Bug修复\nFeature迭代',
      taskTypeQuotas: '{"Bug修复":1,"Feature迭代":2}',
      taskTypeTotals: '',
      overviewMarkdown: '',
      createdAt: 1,
      updatedAt: 1,
    };

    mockGetTask.mockResolvedValue(
      createTaskDetail({
        id: 'task-1',
        gitlabProjectId: 1849,
        projectName: 'alpha',
        taskType: 'Feature迭代',
      }),
    );

    const loadTasks = vi.fn().mockResolvedValue(undefined);
    const loadActiveProject = vi.fn().mockResolvedValue(undefined);
    const updateTaskStatusInStore = vi.fn();
    const updateTaskTypeInStore = vi.fn();

    const { result } = renderHook(() =>
      useBoardTaskDetail({
        activeProject,
        availableTaskTypes: ['Bug修复', 'Feature迭代'],
        sourceModelName: 'ORIGIN',
        tasks: [featureTask, bugTask],
        loadTasks,
        loadActiveProject,
        updateTaskStatusInStore,
        updateTaskTypeInStore,
      }),
    );

    act(() => {
      result.current.setSelected(featureTask);
    });

    await waitFor(() => {
      expect(result.current.selectedTaskDetail?.id).toBe('task-1');
    });

    let changeResult:
      | Awaited<ReturnType<typeof result.current.handleTaskTypeChange>>
      | undefined;
    await act(async () => {
      changeResult = await result.current.handleTaskTypeChange(
        'task-1',
        'Bug修复',
        {
          skipConfirm: true,
        },
      );
    });

    expect(changeResult?.ok).toBe(false);
    expect(changeResult?.error).toContain('不能切换到「');
    expect(changeResult?.error).toContain('Bug');
    expect(changeResult?.error).toContain('单题上限 1');
    expect(result.current.drawerError).toBe(changeResult?.error);
    expect(updateTaskTypeInStore).not.toHaveBeenCalled();
    expect(mockUpdateTaskType).not.toHaveBeenCalled();
  });
});
