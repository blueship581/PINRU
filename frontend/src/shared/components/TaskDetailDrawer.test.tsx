import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaskDetailDrawer from './TaskDetailDrawer';
import type { Task } from '../../store';
import type { PromptGenerationStatus, TaskFromDB } from '../../api/task';
import { createSessionDraft } from '../lib/sessionUtils';

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
      projectQuotas={{}}
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
        Submitted: { label: '已提交', dotCls: 'bg-emerald-500', badgeCls: '' },
        Error: { label: '错误', dotCls: 'bg-red-500', badgeCls: '' },
      }}
      statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error']}
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

describe('TaskDetailDrawer session copy affordance', () => {
  it('copies the active session id from the Session ID tile icon', () => {
    const { draft, onCopySessionId } = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: '复制 Session ID' }));

    expect(onCopySessionId).toHaveBeenCalledWith(draft.localId, draft.sessionId);
    expect(screen.getByText('快捷复制：⌘/Ctrl + Shift + C')).toBeInTheDocument();
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
});
