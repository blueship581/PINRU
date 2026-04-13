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
});
