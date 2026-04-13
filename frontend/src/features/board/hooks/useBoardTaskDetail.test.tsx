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
} = vi.hoisted(() => ({
  mockGetLlmProviders: vi.fn(),
  mockSubmitJob: vi.fn(),
  mockListJobs: vi.fn(),
  mockGetTask: vi.fn(),
  mockListModelRuns: vi.fn(),
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
  };
}

describe('useBoardTaskDetail prompt generation', () => {
  beforeEach(() => {
    mockGetLlmProviders.mockResolvedValue([]);
    mockSubmitJob.mockResolvedValue({ id: 'job-1' });
    mockListJobs.mockResolvedValue([]);
    mockListModelRuns.mockResolvedValue([]);
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
});
