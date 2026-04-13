import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../store';
import { TaskCard } from './BoardPresentation';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    projectId: overrides.projectId ?? '1849',
    projectName: overrides.projectName ?? 'label-01849',
    status: overrides.status ?? 'PromptReady',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [],
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'done',
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

describe('TaskCard', () => {
  it('shows AI review warning rounds on the task card', () => {
    render(
      <TaskCard
        task={createTask({ aiReviewRounds: 3, aiReviewStatus: 'warning' })}
        size="md"
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('复审未过 · 第 3 轮')).toBeInTheDocument();
  });

  it('shows AI review pass rounds on the task card', () => {
    render(
      <TaskCard
        task={createTask({ aiReviewRounds: 2, aiReviewStatus: 'pass' })}
        size="md"
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('复审通过 · 第 2 轮')).toBeInTheDocument();
  });
});
