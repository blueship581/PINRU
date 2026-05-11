import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Submit from './index';
import { useAppStore, type Task } from '../../store';
import type { ProjectConfig } from '../../api/config';
import type { ModelRunFromDB } from '../../api/task';
import {
  extractGitHubRepoPath,
  formatRepoDate,
} from '../../shared/lib/submitRepoName';

const {
  mockGetGitHubAccounts,
  mockListModelRuns,
  mockSubmitJob,
} = vi.hoisted(() => ({
  mockGetGitHubAccounts: vi.fn(),
  mockListModelRuns: vi.fn(),
  mockSubmitJob: vi.fn(),
}));

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../../api/config', async () => {
  const actual = await vi.importActual<typeof import('../../api/config')>('../../api/config');
  return {
    ...actual,
    getGitHubAccounts: mockGetGitHubAccounts,
  };
});

vi.mock('../../api/task', async () => {
  const actual = await vi.importActual<typeof import('../../api/task')>('../../api/task');
  return {
    ...actual,
    listModelRuns: mockListModelRuns,
  };
});

vi.mock('../../api/job', async () => {
  const actual = await vi.importActual<typeof import('../../api/job')>('../../api/job');
  return {
    ...actual,
    submitJob: mockSubmitJob,
  };
});

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    projectId: overrides.projectId ?? '67',
    projectName: overrides.projectName ?? 'B-67',
    status: overrides.status ?? 'ExecutionCompleted',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [],
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'done',
    promptGenerationError: overrides.promptGenerationError ?? null,
    createdAt: overrides.createdAt ?? 1,
    executionRounds: overrides.executionRounds ?? 1,
    aiReviewRounds: overrides.aiReviewRounds ?? 0,
    aiReviewStatus: overrides.aiReviewStatus ?? 'none',
    progress: overrides.progress ?? 0,
    totalModels: overrides.totalModels ?? 1,
    runningModels: overrides.runningModels ?? 0,
  };
}

function createProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: overrides.id ?? 'project-1',
    name: overrides.name ?? '0509-gsb',
    gitlabUrl: overrides.gitlabUrl ?? '',
    gitlabToken: overrides.gitlabToken ?? '',
    hasGitLabToken: overrides.hasGitLabToken ?? false,
    cloneBasePath: overrides.cloneBasePath ?? '',
    models: overrides.models ?? 'ORIGIN\ncodex',
    sourceModelFolder: overrides.sourceModelFolder ?? 'ORIGIN',
    defaultSubmitRepo: overrides.defaultSubmitRepo ?? '',
    taskTypes: overrides.taskTypes ?? '',
    taskTypeQuotas: overrides.taskTypeQuotas ?? '',
    taskTypeTotals: overrides.taskTypeTotals ?? '',
    questionBankProjectIds: overrides.questionBankProjectIds ?? '[]',
    overviewMarkdown: overrides.overviewMarkdown ?? '',
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

function createModelRun(overrides: Partial<ModelRunFromDB> = {}): ModelRunFromDB {
  return {
    id: overrides.id ?? 'run-origin',
    taskId: overrides.taskId ?? 'task-1',
    modelName: overrides.modelName ?? 'ORIGIN',
    branchName: overrides.branchName ?? null,
    localPath: overrides.localPath ?? '/tmp/B-67/ORIGIN',
    prUrl: overrides.prUrl ?? null,
    originUrl: overrides.originUrl ?? null,
    gsbScore: overrides.gsbScore ?? null,
    status: overrides.status ?? 'done',
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    sessionId: overrides.sessionId ?? null,
    conversationRounds: overrides.conversationRounds ?? 0,
    conversationDate: overrides.conversationDate ?? null,
    submitError: overrides.submitError ?? null,
    sessionList: overrides.sessionList ?? [],
    reviewStatus: overrides.reviewStatus ?? 'none',
    reviewRound: overrides.reviewRound ?? 0,
    reviewNotes: overrides.reviewNotes ?? null,
  };
}

describe('Submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitHubAccounts.mockResolvedValue([
      {
        id: 'github-1',
        name: 'GitHub',
        username: 'blueship581',
        token: '',
        hasToken: true,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    mockListModelRuns.mockResolvedValue([createModelRun()]);
    mockSubmitJob.mockResolvedValue({ id: 'job-1' });
    useAppStore.setState({
      tasks: [createTask()],
      activeProject: createProject(),
      loadTasks: vi.fn().mockResolvedValue(undefined),
      loadActiveProject: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('builds the target repository from the selected task repo name instead of the project config name', async () => {
    const today = formatRepoDate(new Date());

    render(
      <MemoryRouter>
        <Submit />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(`blueship581/B-67-${today}`)).toBeInTheDocument();
    });

    expect(screen.queryByText(`blueship581/0509-gsb-${today}`)).not.toBeInTheDocument();
  });

  it('reuses the previously submitted source repository when available', async () => {
    mockListModelRuns.mockResolvedValue([
      createModelRun({
        originUrl: 'https://github.com/blueship581/B-67-20260510',
      }),
    ]);

    render(
      <MemoryRouter>
        <Submit />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('blueship581/B-67-20260510')).toBeInTheDocument();
    });
    expect(extractGitHubRepoPath('https://github.com/blueship581/B-67-20260510')).toBe(
      'blueship581/B-67-20260510',
    );
  });

  it('submits without repo recreation by default', async () => {
    const today = formatRepoDate(new Date());

    render(
      <MemoryRouter>
        <Submit />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(`blueship581/B-67-${today}`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /开始提交/ }));

    await waitFor(() => {
      expect(mockSubmitJob).toHaveBeenCalled();
    });

    const payload = JSON.parse(mockSubmitJob.mock.calls[0][0].inputPayload);
    expect(payload.recreateRepo).toBe(false);
  });

  it('passes repo recreation flag when the dangerous option is checked', async () => {
    render(
      <MemoryRouter>
        <Submit />
      </MemoryRouter>,
    );

    const checkbox = await screen.findByLabelText(/如果目标仓库已存在，先删除并重建/);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /开始提交/ }));

    await waitFor(() => {
      expect(mockSubmitJob).toHaveBeenCalled();
    });

    const payload = JSON.parse(mockSubmitJob.mock.calls[0][0].inputPayload);
    expect(payload.recreateRepo).toBe(true);
    expect(screen.getByText(/会永久删除远端仓库历史/)).toBeInTheDocument();
  });

  it('skips already submitted models when the switch is enabled', async () => {
    mockListModelRuns.mockResolvedValue([
      createModelRun({
        modelName: 'ORIGIN',
        originUrl: 'https://github.com/blueship581/B-67-20260510',
      }),
      createModelRun({
        modelName: 'codex',
        status: 'done',
        prUrl: 'https://github.com/blueship581/B-67-20260510/pull/1',
      }),
      createModelRun({
        modelName: 'gemini',
        status: 'running',
        prUrl: null,
      }),
    ]);
    useAppStore.setState({
      tasks: [createTask()],
      activeProject: createProject({ models: 'ORIGIN\ncodex\ngemini' }),
      loadTasks: vi.fn().mockResolvedValue(undefined),
      loadActiveProject: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <MemoryRouter>
        <Submit />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('blueship581/B-67-20260510')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /开始提交/ }));

    await waitFor(() => {
      expect(mockSubmitJob).toHaveBeenCalled();
    });

    const payload = JSON.parse(mockSubmitJob.mock.calls[0][0].inputPayload);
    expect(payload.models).toEqual(['gemini']);
  });
});
