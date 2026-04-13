import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActiveProjectIdMock = vi.fn();
const getConfigMock = vi.fn();
const getProjectsMock = vi.fn();
const listModelRunsMock = vi.fn();
const listTasksMock = vi.fn();
const listJobsMock = vi.fn();

vi.mock('./api/config', () => ({
  DEFAULT_TASK_TYPE: 'Bug修复',
  getActiveProjectId: (...args: unknown[]) => getActiveProjectIdMock(...args),
  getConfig: (...args: unknown[]) => getConfigMock(...args),
  getProjects: (...args: unknown[]) => getProjectsMock(...args),
  normalizeProjectModels: (models: string) =>
    models
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  normalizeTaskTypeName: (taskType: string) => taskType,
}));

vi.mock('./api/task', () => ({
  listModelRuns: (...args: unknown[]) => listModelRunsMock(...args),
  listTasks: (...args: unknown[]) => listTasksMock(...args),
}));

vi.mock('./api/job', () => ({
  listJobs: (...args: unknown[]) => listJobsMock(...args),
}));

describe('useAppStore.loadTasks', () => {
  beforeEach(() => {
    vi.resetModules();
    getActiveProjectIdMock.mockReset();
    getConfigMock.mockReset();
    getProjectsMock.mockReset();
    listModelRunsMock.mockReset();
    listTasksMock.mockReset();
    listJobsMock.mockReset();

    getActiveProjectIdMock.mockResolvedValue('');
    getConfigMock.mockResolvedValue('');
    getProjectsMock.mockResolvedValue([]);
    listModelRunsMock.mockResolvedValue([]);
    listTasksMock.mockResolvedValue([]);
    listJobsMock.mockResolvedValue([]);
  });

  it('keeps tasks empty when there is no active or fallback project', async () => {
    const { useAppStore } = await import('./store');

    await useAppStore.getState().loadTasks();

    expect(listTasksMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().tasks).toEqual([]);
  });

  it('loads tasks with the resolved fallback project id when the stored active id is stale', async () => {
    getActiveProjectIdMock.mockResolvedValue('deleted-project');
    getProjectsMock.mockResolvedValue([
      {
        id: 'project-2',
        name: '保留项目',
        sourceModelFolder: 'ORIGIN',
        models: 'ORIGIN,cotv21-pro',
      },
    ]);

    const { useAppStore } = await import('./store');

    await useAppStore.getState().loadTasks();

    expect(listTasksMock).toHaveBeenCalledTimes(1);
    expect(listTasksMock).toHaveBeenCalledWith('project-2');
  });

  it('maps AI review rounds and status from model runs onto task cards', async () => {
    getActiveProjectIdMock.mockResolvedValue('project-1');
    getProjectsMock.mockResolvedValue([
      {
        id: 'project-1',
        name: '项目一',
        sourceModelFolder: 'ORIGIN',
        models: 'ORIGIN,cotv21-pro',
      },
    ]);
    listTasksMock.mockResolvedValue([
      {
        id: 'task-1',
        gitlabProjectId: 1849,
        projectName: 'label-01849',
        status: 'PromptReady',
        taskType: 'Bug修复',
        sessionList: [],
        localPath: null,
        promptText: null,
        promptGenerationStatus: 'done',
        promptGenerationError: null,
        promptGenerationStartedAt: null,
        promptGenerationFinishedAt: null,
        createdAt: 1,
        updatedAt: 1,
        notes: null,
        projectConfigId: 'project-1',
      },
    ]);
    listModelRunsMock.mockResolvedValue([
      {
        id: 'run-origin',
        taskId: 'task-1',
        modelName: 'ORIGIN',
        branchName: null,
        localPath: null,
        prUrl: null,
        originUrl: null,
        gsbScore: null,
        status: 'done',
        startedAt: null,
        finishedAt: null,
        sessionId: null,
        conversationRounds: 0,
        conversationDate: null,
        submitError: null,
        sessionList: [],
        reviewStatus: 'none',
        reviewRound: 0,
        reviewNotes: null,
      },
      {
        id: 'run-review',
        taskId: 'task-1',
        modelName: 'cotv21-pro',
        branchName: null,
        localPath: '/tmp/task-1/cotv21-pro',
        prUrl: null,
        originUrl: null,
        gsbScore: null,
        status: 'done',
        startedAt: null,
        finishedAt: null,
        sessionId: null,
        conversationRounds: 0,
        conversationDate: null,
        submitError: null,
        sessionList: [],
        reviewStatus: 'warning',
        reviewRound: 2,
        reviewNotes: '还有问题',
      },
    ]);

    const { useAppStore } = await import('./store');

    await useAppStore.getState().loadTasks();

    expect(useAppStore.getState().tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        aiReviewRounds: 2,
        aiReviewStatus: 'warning',
      }),
    ]);
  });
});
