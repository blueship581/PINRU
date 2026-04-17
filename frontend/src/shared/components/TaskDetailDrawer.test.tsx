import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDetailDrawer from './TaskDetailDrawer';
import { useAppStore, type Task } from '../../store';
import { polishText as polishTextApi } from '../../api/llm';
import type {
  AiReviewRoundFromDB,
  ModelRunFromDB,
  PromptGenerationStatus,
  TaskFromDB,
} from '../../api/task';

vi.mock('../../api/llm', async () => {
  const actual = await vi.importActual<typeof import('../../api/llm')>('../../api/llm');
  return {
    ...actual,
    polishText: vi.fn(),
  };
});

const polishTextMock = vi.mocked(polishTextApi);
import { createSessionDraft } from '../lib/sessionUtils';
import type { BackgroundJob } from '../../api/job';

const cliMock = vi.hoisted(() => {
  let lineHandler: ((line: string) => void) | null = null;
  let doneHandler: ((errMsg?: string | null) => void) | null = null;
  return {
    startClaude: vi.fn().mockResolvedValue({ sessionId: 'mock-session' }),
    onCLILine: vi.fn((_sessionId: string, callback: (line: string) => void) => {
      lineHandler = callback;
      return () => {
        if (lineHandler === callback) lineHandler = null;
      };
    }),
    onCLIDone: vi.fn((_sessionId: string, callback: (errMsg?: string | null) => void) => {
      doneHandler = callback;
      return () => {
        if (doneHandler === callback) doneHandler = null;
      };
    }),
    emitLine: (line: string) => lineHandler?.(line),
    emitDone: (errMsg?: string | null) => doneHandler?.(errMsg),
    reset: () => {
      lineHandler = null;
      doneHandler = null;
    },
  };
});

vi.mock('../../api/cli', () => ({
  startClaude: cliMock.startClaude,
  onCLILine: cliMock.onCLILine,
  onCLIDone: cliMock.onCLIDone,
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
    localPath: overrides.localPath ?? '/tmp/task-1',
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

function renderDrawer() {
  const draft = createSessionDraft('Bug修复', {
    sessionId: 'session-1234567890',
    taskType: 'Bug修复',
    consumeQuota: true,
    isCompleted: true,
    isSatisfied: true,
    evaluation: '',
    userConversation: '用户问题描述',
  });
  const onCopySessionId = vi.fn();

  render(
    <TaskDetailDrawer
      selected={createTask({ sessionList: [draft] })}
      selectedTaskDetail={createTaskDetail({ sessionList: [draft] })}
      selectedModelRuns={[]}
      drawerLoading={false}
      drawerError=""
      statusChanging={false}
      taskTypeChanging={false}
      sessionListDraft={[draft]}
      sessionListSaving={false}
      sessionSaveState="idle"
      hasUnsavedSessionChanges={false}
      sessionExtracting={false}
      openSessionEditors={new Set()}
      copiedSessionId={null}
      promptDraft=""
      promptSaving={false}
      promptSaveState="idle"
      promptCopied={false}
      activeDrawerTab="sessions"
      sessionModelOptions={[]}
      selectedSessionModelName=""
      sessionTaskTypeOptions={['Bug修复']}
      taskTypeRemainingToCompleteByType={{ Bug修复: 8 }}
      sourceModelName="ORIGIN"
      selectedPromptGenerationStatus={'idle' as PromptGenerationStatus}
      selectedPromptGenerationMeta={{
        label: '空闲',
        badgeCls: '',
        panelCls: '',
      }}
      selectedPromptGenerationError={null}
      escCloseHintVisible={false}
      statusMeta={{
        Claimed: { label: '已领取', dotCls: 'bg-blue-500', badgeCls: '' },
        Downloading: { label: '下载中', dotCls: 'bg-amber-500', badgeCls: '' },
        Downloaded: { label: '已下载', dotCls: 'bg-zinc-500', badgeCls: '' },
        PromptReady: { label: '提示词完成', dotCls: 'bg-indigo-500', badgeCls: '' },
        ExecutionCompleted: { label: '执行完成', dotCls: 'bg-cyan-500', badgeCls: '' },
        Submitted: { label: '已提交', dotCls: 'bg-emerald-500', badgeCls: '' },
        Error: { label: '错误', dotCls: 'bg-red-500', badgeCls: '' },
      }}
      statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'ExecutionCompleted', 'Submitted', 'Error']}
      onClose={() => {}}
      onStatusChange={() => {}}
      onTabChange={() => {}}
      onAddSession={() => {}}
      onAutoExtractSessions={() => {}}
      onSessionChange={() => {}}
      onToggleSessionEditor={() => {}}
      onSessionEditorBlur={() => {}}
      onCopySessionId={onCopySessionId}
      onRemoveSession={() => {}}
      onResetSessions={() => {}}
      onSaveSessionList={() => {}}
      onPromptDraftChange={() => {}}
      onPromptCopy={() => {}}
      onPromptReset={() => {}}
      onPromptSave={() => {}}
      onSessionModelChange={() => {}}
      onOpenSubmit={() => {}}
      llmProviders={[]}
      promptGenerating={false}
      onGeneratePrompt={() => {}}
    />,
  );

  return { draft, onCopySessionId };
}

function createModelRun(overrides: Partial<ModelRunFromDB> = {}): ModelRunFromDB {
  return {
    id: overrides.id ?? 'run-1',
    taskId: overrides.taskId ?? 'task-1',
    modelName: overrides.modelName ?? 'model-a',
    branchName: overrides.branchName ?? 'feat/task-1',
    localPath: overrides.localPath ?? '/tmp/task-1/model-a',
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

function createBackgroundJob(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: overrides.id ?? 'job-1',
    jobType: overrides.jobType ?? 'ai_review',
    taskId: overrides.taskId ?? 'task-1',
    status: overrides.status ?? 'done',
    progress: overrides.progress ?? 100,
    progressMessage: overrides.progressMessage ?? null,
    errorMessage: overrides.errorMessage ?? null,
    inputPayload: overrides.inputPayload ?? JSON.stringify({
      modelRunId: 'run-1',
      modelName: 'model-a',
      localPath: '/tmp/task-1/model-a',
    }),
    outputPayload: overrides.outputPayload ?? JSON.stringify({
      modelRunId: 'run-1',
      modelName: 'model-a',
      reviewStatus: 'warning',
      reviewRound: 2,
      reviewNotes: '导出逻辑还缺异常处理',
      nextPrompt: '把导出失败提示和空数据保护补齐，再复审一轮。',
    }),
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 1,
    timeoutSeconds: overrides.timeoutSeconds ?? 600,
    createdAt: overrides.createdAt ?? 1,
    startedAt: overrides.startedAt ?? 2,
    finishedAt: overrides.finishedAt ?? 3,
  };
}

function createAiReviewRound(overrides: Partial<AiReviewRoundFromDB> = {}): AiReviewRoundFromDB {
  return {
    id: overrides.id ?? 'round-1',
    taskId: overrides.taskId ?? 'task-1',
    modelRunId: overrides.modelRunId ?? 'run-1',
    localPath: overrides.localPath ?? '/tmp/task-1/model-a',
    modelName: overrides.modelName ?? 'model-a',
    roundNumber: overrides.roundNumber ?? 1,
    originalPrompt: overrides.originalPrompt ?? '原始提示词',
    promptText: overrides.promptText ?? '当前提示词',
    status: overrides.status ?? 'warning',
    isCompleted: overrides.isCompleted ?? true,
    isSatisfied: overrides.isSatisfied ?? false,
    reviewNotes: overrides.reviewNotes ?? '导出逻辑还缺异常处理，需要补上错误提示。',
    nextPrompt: overrides.nextPrompt ?? '把导出失败提示和空数据保护补齐，再复审一轮。',
    projectType: overrides.projectType ?? '',
    changeScope: overrides.changeScope ?? '',
    keyLocations: overrides.keyLocations ?? '',
    jobId: overrides.jobId ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

function renderTaskDetailDrawer(
  overrides: Partial<Parameters<typeof TaskDetailDrawer>[0]> = {},
) {
  render(
    <TaskDetailDrawer
      selected={createTask()}
      selectedTaskDetail={createTaskDetail()}
      selectedModelRuns={[]}
      drawerLoading={false}
      drawerError=""
      statusChanging={false}
      taskTypeChanging={false}
      sessionListDraft={[createSessionDraft('Bug修复')]}
      sessionListSaving={false}
      sessionSaveState="idle"
      hasUnsavedSessionChanges={false}
      sessionExtracting={false}
      openSessionEditors={new Set()}
      copiedSessionId={null}
      promptDraft=""
      promptSaving={false}
      promptSaveState="idle"
      promptCopied={false}
      activeDrawerTab="sessions"
      sessionModelOptions={[]}
      selectedSessionModelName=""
      sessionTaskTypeOptions={['Bug修复']}
      taskTypeRemainingToCompleteByType={{ Bug修复: 8 }}
      sourceModelName="ORIGIN"
      selectedPromptGenerationStatus={'idle' as PromptGenerationStatus}
      selectedPromptGenerationMeta={{
        label: '空闲',
        badgeCls: '',
        panelCls: '',
      }}
      selectedPromptGenerationError={null}
      escCloseHintVisible={false}
      statusMeta={{
        Claimed: { label: '已领取', dotCls: 'bg-blue-500', badgeCls: '' },
        Downloading: { label: '下载中', dotCls: 'bg-amber-500', badgeCls: '' },
        Downloaded: { label: '已下载', dotCls: 'bg-zinc-500', badgeCls: '' },
        PromptReady: { label: '提示词完成', dotCls: 'bg-indigo-500', badgeCls: '' },
        ExecutionCompleted: { label: '执行完成', dotCls: 'bg-cyan-500', badgeCls: '' },
        Submitted: { label: '已提交', dotCls: 'bg-emerald-500', badgeCls: '' },
        Error: { label: '错误', dotCls: 'bg-red-500', badgeCls: '' },
      }}
      statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'ExecutionCompleted', 'Submitted', 'Error']}
      onClose={() => {}}
      onStatusChange={() => {}}
      onTabChange={() => {}}
      onAddSession={() => {}}
      onAutoExtractSessions={() => {}}
      onSessionChange={() => {}}
      onToggleSessionEditor={() => {}}
      onSessionEditorBlur={() => {}}
      onCopySessionId={() => {}}
      onRemoveSession={() => {}}
      onResetSessions={() => {}}
      onSaveSessionList={() => {}}
      onPromptDraftChange={() => {}}
      onPromptCopy={() => {}}
      onPromptReset={() => {}}
      onPromptSave={() => {}}
      onSessionModelChange={() => {}}
      onOpenSubmit={() => {}}
      llmProviders={[]}
      promptGenerating={false}
      onGeneratePrompt={() => {}}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  useAppStore.setState({ backgroundJobs: [], aiReviewVisible: false });
  vi.restoreAllMocks();
  cliMock.reset();
  cliMock.startClaude.mockResolvedValue({ sessionId: 'mock-session' });
  polishTextMock.mockReset();
});

describe('TaskDetailDrawer session copy affordance', () => {
  it('keeps session id copy on the keyboard shortcut after the session card switched to user conversation', () => {
    const { draft, onCopySessionId } = renderDrawer();

    expect(screen.getByRole('button', { name: '复制 Session ID' })).toBeInTheDocument();
    expect(screen.getByText('用户对话')).toBeInTheDocument();
    expect(screen.getByText(draft.sessionId)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });

    expect(onCopySessionId).toHaveBeenCalledWith(draft.localId, draft.sessionId);
  });

  it('supports the keyboard shortcut outside editable fields', () => {
    const { draft, onCopySessionId } = renderDrawer();

    fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true });

    expect(onCopySessionId).toHaveBeenCalledWith(draft.localId, draft.sessionId);
  });

  it('does not hijack the shortcut while editing the session id input', () => {
    const { onCopySessionId } = renderDrawer();
    fireEvent.doubleClick(screen.getByText('session-1234567890'));
    const input = screen.getByPlaceholderText('输入 Session ID');

    input.focus();
    fireEvent.keyDown(input, { key: 'C', ctrlKey: true, shiftKey: true });

    expect(onCopySessionId).not.toHaveBeenCalled();
  });

  it('keeps auto extract as an icon action in the session list and uses the updated submit label', () => {
    renderDrawer();

    expect(screen.getByRole('button', { name: '自动提取 session' })).toBeInTheDocument();
    expect(screen.queryByText('自动提取')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交代码' })).toBeInTheDocument();
  });

  it('shows the global remaining count in the task type selector', () => {
    renderDrawer();

    expect(screen.getByRole('button', { name: 'Bug 修复' })).toBeInTheDocument();
  });

  it('hides AI review entry points by default', () => {
    render(
      <TaskDetailDrawer
        selected={createTask()}
        selectedTaskDetail={createTaskDetail()}
        selectedModelRuns={[createModelRun()]}
        drawerLoading={false}
        drawerError=""
        statusChanging={false}
        taskTypeChanging={false}
        sessionListDraft={[createSessionDraft('Bug修复')]}
        sessionListSaving={false}
        sessionSaveState="idle"
        hasUnsavedSessionChanges={false}
        sessionExtracting={false}
        openSessionEditors={new Set()}
        copiedSessionId={null}
        promptDraft=""
        promptSaving={false}
        promptSaveState="idle"
        promptCopied={false}
        activeDrawerTab="ai-review"
        sessionModelOptions={[]}
        selectedSessionModelName=""
        sessionTaskTypeOptions={['Bug修复']}
        taskTypeRemainingToCompleteByType={{ Bug修复: 8 }}
        sourceModelName="ORIGIN"
        selectedPromptGenerationStatus={'idle' as PromptGenerationStatus}
        selectedPromptGenerationMeta={{
          label: '空闲',
          badgeCls: '',
          panelCls: '',
        }}
        selectedPromptGenerationError={null}
        escCloseHintVisible={false}
        statusMeta={{
          Claimed: { label: '已领取', dotCls: 'bg-blue-500', badgeCls: '' },
          Downloading: { label: '下载中', dotCls: 'bg-amber-500', badgeCls: '' },
          Downloaded: { label: '已下载', dotCls: 'bg-zinc-500', badgeCls: '' },
          PromptReady: { label: '提示词完成', dotCls: 'bg-indigo-500', badgeCls: '' },
          ExecutionCompleted: { label: '执行完成', dotCls: 'bg-cyan-500', badgeCls: '' },
          Submitted: { label: '已提交', dotCls: 'bg-emerald-500', badgeCls: '' },
          Error: { label: '错误', dotCls: 'bg-red-500', badgeCls: '' },
        }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'ExecutionCompleted', 'Submitted', 'Error']}
        onClose={() => {}}
        onStatusChange={() => {}}
        onTabChange={() => {}}
        onAddSession={() => {}}
        onAutoExtractSessions={() => {}}
        onSessionChange={() => {}}
        onToggleSessionEditor={() => {}}
        onSessionEditorBlur={() => {}}
        onCopySessionId={() => {}}
        onRemoveSession={() => {}}
        onResetSessions={() => {}}
        onSaveSessionList={() => {}}
        onPromptDraftChange={() => {}}
        onPromptCopy={() => {}}
        onPromptReset={() => {}}
        onPromptSave={() => {}}
        onSessionModelChange={() => {}}
        onOpenSubmit={() => {}}
        llmProviders={[]}
        promptGenerating={false}
        onGeneratePrompt={() => {}}
        onAiReview={() => {}}
      />,
    );

    expect(screen.queryByText('AI复审')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI 复审' })).not.toBeInTheDocument();
    expect(screen.queryByText('当前复审状态')).not.toBeInTheDocument();
  });

  it('shows a visible AI review button in the model runs tab', () => {
    useAppStore.setState({ aiReviewVisible: true });
    const onAiReview = vi.fn();

    render(
      <TaskDetailDrawer
        selected={createTask()}
        selectedTaskDetail={createTaskDetail()}
        selectedModelRuns={[createModelRun()]}
        drawerLoading={false}
        drawerError=""
        statusChanging={false}
        taskTypeChanging={false}
        sessionListDraft={[createSessionDraft('Bug修复')]}
        sessionListSaving={false}
        sessionSaveState="idle"
        hasUnsavedSessionChanges={false}
        sessionExtracting={false}
        openSessionEditors={new Set()}
        copiedSessionId={null}
        promptDraft=""
        promptSaving={false}
        promptSaveState="idle"
        promptCopied={false}
        activeDrawerTab="model-runs"
        sessionModelOptions={[]}
        selectedSessionModelName=""
        sessionTaskTypeOptions={['Bug修复']}
        taskTypeRemainingToCompleteByType={{ Bug修复: 8 }}
        sourceModelName="ORIGIN"
        selectedPromptGenerationStatus={'idle' as PromptGenerationStatus}
        selectedPromptGenerationMeta={{
          label: '空闲',
          badgeCls: '',
          panelCls: '',
        }}
        selectedPromptGenerationError={null}
        escCloseHintVisible={false}
        statusMeta={{
          Claimed: { label: '已领取', dotCls: 'bg-blue-500', badgeCls: '' },
          Downloading: { label: '下载中', dotCls: 'bg-amber-500', badgeCls: '' },
          Downloaded: { label: '已下载', dotCls: 'bg-zinc-500', badgeCls: '' },
          PromptReady: { label: '提示词完成', dotCls: 'bg-indigo-500', badgeCls: '' },
          ExecutionCompleted: { label: '执行完成', dotCls: 'bg-cyan-500', badgeCls: '' },
          Submitted: { label: '已提交', dotCls: 'bg-emerald-500', badgeCls: '' },
          Error: { label: '错误', dotCls: 'bg-red-500', badgeCls: '' },
        }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'ExecutionCompleted', 'Submitted', 'Error']}
        onClose={() => {}}
        onStatusChange={() => {}}
        onTabChange={() => {}}
        onAddSession={() => {}}
        onAutoExtractSessions={() => {}}
        onSessionChange={() => {}}
        onToggleSessionEditor={() => {}}
        onSessionEditorBlur={() => {}}
        onCopySessionId={() => {}}
        onRemoveSession={() => {}}
        onResetSessions={() => {}}
        onSaveSessionList={() => {}}
        onPromptDraftChange={() => {}}
        onPromptCopy={() => {}}
        onPromptReset={() => {}}
        onPromptSave={() => {}}
        onSessionModelChange={() => {}}
        onOpenSubmit={() => {}}
        llmProviders={[]}
        promptGenerating={false}
        onGeneratePrompt={() => {}}
        onAiReview={onAiReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 复审' }));

    expect(onAiReview).toHaveBeenCalledTimes(1);
  });

  it('shows the managed source folder name for origin runs in the model runs tab', () => {
    render(
      <TaskDetailDrawer
        selected={createTask()}
        selectedTaskDetail={createTaskDetail()}
        selectedModelRuns={[createModelRun({ modelName: 'ORIGIN', localPath: '/tmp/task-1/01849-bug修复' })]}
        drawerLoading={false}
        drawerError=""
        statusChanging={false}
        taskTypeChanging={false}
        sessionListDraft={[createSessionDraft('Bug修复')]}
        sessionListSaving={false}
        sessionSaveState="idle"
        hasUnsavedSessionChanges={false}
        sessionExtracting={false}
        openSessionEditors={new Set()}
        copiedSessionId={null}
        promptDraft=""
        promptSaving={false}
        promptSaveState="idle"
        promptCopied={false}
        activeDrawerTab="model-runs"
        sessionModelOptions={[]}
        selectedSessionModelName=""
        sessionTaskTypeOptions={['Bug修复']}
        taskTypeRemainingToCompleteByType={{ Bug修复: 8 }}
        sourceModelName="ORIGIN"
        selectedPromptGenerationStatus={'idle' as PromptGenerationStatus}
        selectedPromptGenerationMeta={{
          label: '空闲',
          badgeCls: '',
          panelCls: '',
        }}
        selectedPromptGenerationError={null}
        escCloseHintVisible={false}
        statusMeta={{
          Claimed: { label: '已领取', dotCls: 'bg-blue-500', badgeCls: '' },
          Downloading: { label: '下载中', dotCls: 'bg-amber-500', badgeCls: '' },
          Downloaded: { label: '已下载', dotCls: 'bg-zinc-500', badgeCls: '' },
          PromptReady: { label: '提示词完成', dotCls: 'bg-indigo-500', badgeCls: '' },
          ExecutionCompleted: { label: '执行完成', dotCls: 'bg-cyan-500', badgeCls: '' },
          Submitted: { label: '已提交', dotCls: 'bg-emerald-500', badgeCls: '' },
          Error: { label: '错误', dotCls: 'bg-red-500', badgeCls: '' },
        }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'ExecutionCompleted', 'Submitted', 'Error']}
        onClose={() => {}}
        onStatusChange={() => {}}
        onTabChange={() => {}}
        onAddSession={() => {}}
        onAutoExtractSessions={() => {}}
        onSessionChange={() => {}}
        onToggleSessionEditor={() => {}}
        onSessionEditorBlur={() => {}}
        onCopySessionId={() => {}}
        onRemoveSession={() => {}}
        onResetSessions={() => {}}
        onSaveSessionList={() => {}}
        onPromptDraftChange={() => {}}
        onPromptCopy={() => {}}
        onPromptReset={() => {}}
        onPromptSave={() => {}}
        onSessionModelChange={() => {}}
        onOpenSubmit={() => {}}
        llmProviders={[]}
        promptGenerating={false}
        onGeneratePrompt={() => {}}
      />,
    );

    expect(screen.getByText('01849-bug修复 · ORIGIN')).toBeInTheDocument();
    expect(screen.getByText('源码')).toBeInTheDocument();
  });

  it('renders the ai review tab with rounds instead of legacy nodes', () => {
    useAppStore.setState({ aiReviewVisible: true });
    useAppStore.setState({
      backgroundJobs: [createBackgroundJob({
        inputPayload: JSON.stringify({
          reviewRoundId: 'round-1',
          modelRunId: 'run-1',
          modelName: '01874-代码生成',
          localPath: '/tmp/task-1/01874-代码生成',
        }),
        outputPayload: JSON.stringify({
          reviewRoundId: 'round-1',
          modelRunId: 'run-1',
          modelName: '01874-代码生成',
          reviewStatus: 'warning',
          reviewRound: 1,
          reviewNotes: '导出逻辑还缺异常处理',
          nextPrompt: '把导出失败提示和空数据保护补齐，再复审一轮。',
        }),
      })],
    });

    renderTaskDetailDrawer({
      activeDrawerTab: 'ai-review',
    });

    expect(screen.getByRole('button', { name: 'AI复审' })).toBeInTheDocument();
    expect(screen.queryByText(/"isCompleted":true/)).not.toBeInTheDocument();
  });

  it('uses polishedText result for ai review notes', async () => {
    useAppStore.setState({ aiReviewVisible: true });
    polishTextMock.mockResolvedValue({
      polishedText: '这是润色后的复审结论，表达更自然，也更适合直接给同事阅读，能够把问题背景、缺少的错误提示以及后续需要补齐的处理逻辑完整说清楚。',
      providerName: 'Claude Code CLI',
      model: 'claude-sonnet-4-6',
    });

    expect([...'这是润色后的复审结论，表达更自然，也更适合直接给同事阅读，能够把问题背景、缺少的错误提示以及后续需要补齐的处理逻辑完整说清楚。'].length).toBeGreaterThanOrEqual(50);

    renderTaskDetailDrawer({
      activeDrawerTab: 'ai-review',
      selectedModelRuns: [createModelRun()],
      selectedAiReviewRounds: [createAiReviewRound()],
      onAiReview: () => {},
      onSubmitNextAiReviewRound: () => {},
    });

    const reviewHeader = screen.getByText('结论').parentElement;
    const polishButton = reviewHeader?.querySelector('button[title="润色"]');
    expect(polishButton).not.toBeNull();

    fireEvent.click(polishButton as HTMLButtonElement);

    expect(polishTextMock).toHaveBeenCalledWith({ text: '导出逻辑还缺异常处理，需要补上错误提示。' });
    expect(await screen.findByRole('button', { name: '恢复原文' })).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('这是润色后的复审结论，表达更自然'))).toBeInTheDocument();
  });
});
