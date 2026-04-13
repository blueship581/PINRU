import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TaskTypeOverviewBar from '../shared/components/TaskTypeOverviewBar';
import type { Task } from '../store';
import type { TaskTypeOverviewSummary } from '../shared/lib/taskTypeOverview';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2)}`,
    projectId: overrides.projectId ?? 'project-1',
    projectName: overrides.projectName ?? '示例项目',
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

describe('TaskTypeOverviewBar', () => {
  it('renders submitted session progress against the configured total', () => {
    const summary: TaskTypeOverviewSummary = {
      taskType: 'Bug修复',
      remainingQuota: 4,
      remainingToCompleteCount: 7,
      waitingTasks: [],
      processingTasks: [createTask({ id: 'processing-1', status: 'PromptReady' })],
      submittedTasks: [createTask({ id: 'submitted-1', status: 'Submitted' })],
      errorTasks: [],
      submittedSessionCount: 3,
      allocatedSessionCount: 5,
      totalTaskCount: 10,
    };

    render(<TaskTypeOverviewBar summaries={[summary]} />);

    expect(screen.getByText('待完成 7')).toBeInTheDocument();
    expect(screen.getByText('已提交 3 / 总计 10')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });
});
