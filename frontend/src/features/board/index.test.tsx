import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Board from './index';
import { useAppStore, type Task } from '../../store';

const eventsOnMock = vi.fn();
let jobProgressHandler: ((event: { data: {
  id: string;
  jobType: string;
  taskId: string | null;
  status: string;
  progress: number;
  progressMessage: string | null;
  errorMessage: string | null;
} }) => void) | null = null;

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: (eventName: string, handler: typeof jobProgressHandler) => {
      eventsOnMock(eventName, handler);
      if (eventName === 'job:progress') {
        jobProgressHandler = handler;
      }
      return vi.fn();
    },
  },
}));

vi.mock('./components/BatchActionBar', () => ({
  BatchActionBar: () => null,
}));

vi.mock('./components/BoardMainContent', () => ({
  BoardMainContent: () => <div>board</div>,
}));

vi.mock('./components/BoardLayerStack', () => ({
  BoardLayerStack: () => null,
}));

vi.mock('./hooks/useBoardTaskDetail', () => ({
  useBoardTaskDetail: () => ({
    selected: null,
    setSelected: vi.fn(),
    selectedTaskDetail: null,
    selectedModelRuns: [],
    selectedSessionModelName: '',
    setSelectedSessionModelName: vi.fn(),
    drawerLoading: false,
    drawerError: '',
    statusChanging: false,
    promptDraft: '',
    promptSaving: false,
    promptSaveState: 'idle',
    promptCopied: false,
    promptGenerating: false,
    llmProviders: [],
    sessionListDraft: [],
    sessionListSaving: false,
    sessionSaveState: 'idle',
    hasUnsavedSessionChanges: false,
    sessionExtracting: false,
    sessionExtractCandidates: [],
    openSessionEditors: new Set(),
    copiedSessionId: null,
    taskTypeChanging: false,
    activeDrawerTab: 'prompt',
    setActiveDrawerTab: vi.fn(),
    sessionModelOptions: [],
    primaryTaskType: 'Bug修复',
    projectQuotas: {},
    selectedPromptGenerationStatus: 'idle',
    selectedPromptGenerationMeta: {
      label: '未生成',
      badgeCls: '',
      panelCls: '',
    },
    selectedPromptGenerationError: null,
    handleStatusChange: vi.fn(),
    handleTaskTypeChange: vi.fn(),
    handlePromptSave: vi.fn(),
    handlePromptCopy: vi.fn(),
    handlePromptDraftChange: vi.fn(),
    handlePromptReset: vi.fn(),
    handleGeneratePrompt: vi.fn(),
    handleAddSession: vi.fn(),
    handleAutoExtractSessions: vi.fn(),
    handleSessionChange: vi.fn(),
    handleToggleSessionEditor: vi.fn(),
    handleSessionEditorBlur: vi.fn(),
    handleCopySessionId: vi.fn(),
    handleRemoveSession: vi.fn(),
    handleResetSessions: vi.fn(),
    handleSessionListSave: vi.fn(),
    handleSessionModelChange: vi.fn(),
    handleOpenSubmit: vi.fn(),
  }),
}));

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

describe('Board prompt job sync', () => {
  beforeEach(() => {
    jobProgressHandler = null;
    vi.clearAllMocks();
  });

  it('refreshes task cards when a prompt_generate job completes', async () => {
    const loadTasks = vi.fn().mockResolvedValue(undefined);
    const loadActiveProject = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      tasks: [createTask({
        id: 'task-1',
        status: 'Claimed',
        promptGenerationStatus: 'running',
      })],
      loadTasks,
      loadActiveProject,
      removeTask: vi.fn(),
      activeProject: null,
      setActiveProject: vi.fn(),
      updateTaskStatus: vi.fn(),
      updateTaskType: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Board />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(eventsOnMock).toHaveBeenCalledWith('job:progress', expect.any(Function));
    });

    act(() => {
      jobProgressHandler?.({
        data: {
          id: 'job-1',
          jobType: 'prompt_generate',
          taskId: 'task-1',
          status: 'done',
          progress: 100,
          progressMessage: '已完成',
          errorMessage: null,
        },
      });
    });

    await waitFor(() => {
      expect(loadTasks).toHaveBeenCalledTimes(2);
    });

    const task = useAppStore.getState().tasks.find((item) => item.id === 'task-1');
    expect(task?.status).toBe('PromptReady');
    expect(task?.promptGenerationStatus).toBe('done');
    expect(task?.promptGenerationError).toBeNull();
  });
});
