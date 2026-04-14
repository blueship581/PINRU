import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskDetailDrawer from './TaskDetailDrawer';
import { useAppStore, type Task } from '../../store';
import type {
  AiReviewNodeFromDB,
  ModelRunFromDB,
  PromptGenerationStatus,
  TaskFromDB,
} from '../../api/task';
import { createSessionDraft } from '../lib/sessionUtils';
import type { BackgroundJob } from '../../api/job';

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

function createAiReviewNode(overrides: Partial<AiReviewNodeFromDB> = {}): AiReviewNodeFromDB {
  const id = overrides.id ?? 'node-1';
  const rootId = overrides.rootId ?? id;

  return {
    id,
    taskId: overrides.taskId ?? 'task-1',
    modelRunId: overrides.modelRunId ?? 'run-1',
    parentId: overrides.parentId ?? null,
    rootId,
    modelName: overrides.modelName ?? 'model-a',
    localPath: overrides.localPath ?? '/tmp/task-1/model-a',
    title: overrides.title ?? '首轮审核',
    issueType: overrides.issueType ?? 'Bug修复',
    level: overrides.level ?? 1,
    sequence: overrides.sequence ?? 1,
    status: overrides.status ?? 'warning',
    runCount: overrides.runCount ?? 1,
    originalPrompt: overrides.originalPrompt ?? '请修复当前代码中的问题',
    promptText: overrides.promptText ?? '请继续修复当前节点问题',
    reviewNotes: overrides.reviewNotes ?? '当前节点还未满足要求',
    parentReviewNotes: overrides.parentReviewNotes ?? '',
    nextPrompt: overrides.nextPrompt ?? '补齐修复后重新复核',
    isCompleted: overrides.isCompleted ?? true,
    isSatisfied: overrides.isSatisfied ?? false,
    projectType: overrides.projectType ?? 'Web前端',
    changeScope: overrides.changeScope ?? '跨模块多文件',
    keyLocations: overrides.keyLocations ?? 'frontend-user/src/App.jsx:212',
    lastJobId: overrides.lastJobId ?? null,
    isActive: overrides.isActive ?? true,
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
      selectedAiReviewNodes={[]}
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
});

describe('TaskDetailDrawer session copy affordance', () => {
  it('keeps session id copy on the keyboard shortcut after the session card switched to user conversation', () => {
    const { draft, onCopySessionId } = renderDrawer();

    expect(screen.queryByRole('button', { name: '复制 Session ID' })).not.toBeInTheDocument();
    expect(screen.getByText('用户对话')).toBeInTheDocument();
    expect(screen.getByLabelText('编辑 Session ID')).toHaveValue(draft.sessionId);

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
    const input = screen.getByPlaceholderText('记录实际 sessionId');

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

    expect(screen.getByRole('option', { name: 'Bug 修复 · 待完成 8' })).toBeInTheDocument();
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

  it('shows ai review results in the dedicated tab', () => {
    useAppStore.setState({ aiReviewVisible: true });
    const rootNode = createAiReviewNode({
      id: 'node-root',
      rootId: 'node-root',
      modelName: '01874-代码生成',
      localPath: '/tmp/task-1/01874-代码生成',
      title: '首轮审核',
      promptText: '优先检查导出流程和异常提示',
      reviewNotes: '导出逻辑还缺异常处理',
      nextPrompt: '把导出失败提示和空数据保护补齐，再复审一轮。',
      isCompleted: true,
      isSatisfied: false,
    });
    const childNode = createAiReviewNode({
      id: 'node-child',
      parentId: 'node-root',
      rootId: 'node-root',
      modelRunId: null,
      modelName: '01874-代码生成',
      localPath: '/tmp/task-1/01874-代码生成',
      title: '补齐空数据保护',
      level: 2,
      sequence: 1,
      status: 'pass',
      runCount: 2,
      promptText: '确认空结果集和导出按钮禁用逻辑',
      reviewNotes: '导出前未校验空结果集',
      parentReviewNotes: '导出逻辑还缺异常处理',
      nextPrompt: '增加空列表保护后再检查导出按钮状态。',
      isCompleted: true,
      isSatisfied: true,
      changeScope: '单文件',
      keyLocations: 'frontend-user/src/components/ControlPanel.jsx:276',
    });
    useAppStore.setState({
      backgroundJobs: [createBackgroundJob({
        inputPayload: JSON.stringify({
          reviewNodeId: 'node-child',
          modelRunId: null,
          modelName: '01874-代码生成',
          localPath: '/tmp/task-1/01874-代码生成',
        }),
        progressMessage: '[01874-代码生成] {"isCompleted":true,"isSatisfied":true,"projectType":"Web前端","changeScope":"跨模块多文件","reviewNotes":"无","nextPrompt":"无","keyLocations":"frontend-user/src/App.jsx:212；frontend-user/src/components/ControlPanel.jsx:276；frontend-user/src/utils/storage.js:57"}',
        outputPayload: JSON.stringify({
          reviewNodeId: 'node-child',
          modelRunId: '',
          modelName: '01874-代码生成',
          reviewStatus: 'warning',
          reviewRound: 2,
          reviewNotes: '导出逻辑还缺异常处理',
          nextPrompt: '把导出失败提示和空数据保护补齐，再复审一轮。',
        }),
      })],
    });

    renderTaskDetailDrawer({
      activeDrawerTab: 'ai-review',
      selectedAiReviewNodes: [rootNode, childNode],
    });

    expect(screen.getByText('复核树')).toBeInTheDocument();
    expect(screen.getByText('最近复审记录')).toBeInTheDocument();
    expect(screen.getByDisplayValue('首轮审核')).toBeInTheDocument();
    expect(screen.getByDisplayValue('补齐空数据保护')).toBeInTheDocument();
    expect(screen.getByText('父节点结论')).toBeInTheDocument();
    expect(screen.getAllByText('导出逻辑还缺异常处理').length).toBeGreaterThan(1);
    expect(screen.getAllByText('原始任务提示词')).toHaveLength(2);
    expect(screen.getAllByText('当前节点提示词')).toHaveLength(2);
    expect(screen.getAllByText('不满意结论')).toHaveLength(2);
    expect(screen.getAllByText('当前结论')).toHaveLength(2);
    expect(screen.getAllByText('最近建议提示词')).toHaveLength(2);
    expect(screen.getAllByText('请修复当前代码中的问题').length).toBeGreaterThan(0);
    expect(screen.getByText('优先检查导出流程和异常提示')).toBeInTheDocument();
    expect(screen.getByText('确认空结果集和导出按钮禁用逻辑')).toBeInTheDocument();
    expect(screen.getAllByText('未关联模型').length).toBeGreaterThan(0);
    expect(screen.getAllByText('01874-代码生成').length).toBeGreaterThan(0);
    expect(screen.queryByText(/"isCompleted":true/)).not.toBeInTheDocument();
    expect(screen.getAllByText('是否完成：是').length).toBeGreaterThan(0);
    expect(screen.getAllByText('是否满意：否').length).toBeGreaterThan(0);
    expect(screen.getAllByText('是否满意：是').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Web前端').length).toBeGreaterThan(0);
    expect(screen.getAllByText('跨模块多文件').length).toBeGreaterThan(0);
    expect(screen.getAllByText('单文件').length).toBeGreaterThan(0);
    expect(screen.getAllByText('frontend-user/src/App.jsx:212', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('frontend-user/src/components/ControlPanel.jsx:276', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('不满意点评')).toHaveLength(1);
    expect(screen.getAllByText('下一轮提示词')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '复制节点 1 当前结论' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制节点 1 原始任务提示词' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制节点 2 最近建议提示词' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '复制 01874-代码生成 不满意点评' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '复制 01874-代码生成 下一轮提示词' })).toHaveLength(1);
  });

  it('saves node edits before rerunning ai review', async () => {
    useAppStore.setState({ aiReviewVisible: true });
    const onSaveAiReviewNode = vi.fn().mockResolvedValue(undefined);
    const onAiReviewNode = vi.fn().mockResolvedValue(undefined);

    renderTaskDetailDrawer({
      activeDrawerTab: 'ai-review',
      selectedAiReviewNodes: [createAiReviewNode({
        id: 'node-1',
        title: '导出失败提示缺失',
        promptText: '补齐导出失败 toast',
        reviewNotes: '失败时没有明确提示',
      })],
      onSaveAiReviewNode,
      onAiReviewNode,
    });

    fireEvent.change(screen.getByDisplayValue('导出失败提示缺失'), {
      target: { value: '导出失败提示与空数据保护' },
    });
    fireEvent.change(screen.getByDisplayValue('补齐导出失败 toast'), {
      target: { value: '同时校验空数据保护和失败 toast' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复核' }));
    });

    expect(onSaveAiReviewNode).toHaveBeenCalledWith({
      id: 'node-1',
      title: '导出失败提示与空数据保护',
      issueType: 'Bug修复',
      promptText: '同时校验空数据保护和失败 toast',
      reviewNotes: '失败时没有明确提示',
    });
    expect(onAiReviewNode).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'node-1',
        title: '导出失败提示缺失',
      }),
    );
  });

  it('supports deleting a finished ai review record from the dedicated tab', async () => {
    useAppStore.setState({ aiReviewVisible: true });
    useAppStore.setState({
      backgroundJobs: [createBackgroundJob()],
    });
    const onDeleteAiReviewRecord = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderTaskDetailDrawer({
      activeDrawerTab: 'ai-review',
      selectedModelRuns: [createModelRun({ reviewStatus: 'warning', reviewRound: 2 })],
      onDeleteAiReviewRecord,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除 model-a 复审记录' }));
    });

    expect(onDeleteAiReviewRecord).toHaveBeenCalledWith('job-1');
  });
});
