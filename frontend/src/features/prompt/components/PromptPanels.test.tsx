import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../store';
import { PromptSidebar } from './PromptPanels';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'pproject-1710000000001__bug__label-01849-2',
    projectId: overrides.projectId ?? '1849',
    projectName: overrides.projectName ?? 'label-01849',
    status: overrides.status ?? 'PromptReady',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [],
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'done',
    promptGenerationError: overrides.promptGenerationError ?? null,
    createdAt: overrides.createdAt ?? 1,
    executionRounds: overrides.executionRounds ?? 2,
    aiReviewRounds: overrides.aiReviewRounds ?? 0,
    aiReviewStatus: overrides.aiReviewStatus ?? 'none',
    progress: overrides.progress ?? 0,
    totalModels: overrides.totalModels ?? 0,
    runningModels: overrides.runningModels ?? 0,
  };
}

describe('PromptSidebar', () => {
  it('shows concise task ids in the picker and current selection', () => {
    const task = createTask();

    render(
      <PromptSidebar
        selectedTask={task}
        selectedTaskId={task.id}
        tasks={[task]}
        showTaskPicker
        sessions={[]}
        activeSessionId={null}
        renamingId={null}
        renameValue=""
        onToggleTaskPicker={vi.fn()}
        onSelectTask={vi.fn()}
        onNewSession={vi.fn()}
        onSelectSession={vi.fn()}
        onRenameStart={vi.fn()}
        onRenameValueChange={vi.fn()}
        onRenameCommit={vi.fn()}
        onDeleteSession={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getAllByText('1849-Bug修复-2')).toHaveLength(2);
  });
});
