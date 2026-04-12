import { describe, expect, it } from 'vitest';
import type { Task } from '../../../store';
import { buildTaskTypeOverviewSummaries } from '../taskTypeOverview';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2)}`,
    projectId: overrides.projectId ?? 'project-1',
    projectName: overrides.projectName ?? '示例项目',
    status: overrides.status ?? 'Claimed',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [
      {
        sessionId: '',
        taskType: overrides.taskType ?? 'Bug修复',
        consumeQuota: true,
        isCompleted: null,
        isSatisfied: null,
        evaluation: '',
        userConversation: '',
      },
    ],
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'idle',
    promptGenerationError: overrides.promptGenerationError ?? null,
    createdAt: overrides.createdAt ?? 1,
    executionRounds: overrides.executionRounds ?? 1,
    progress: overrides.progress ?? 0,
    totalModels: overrides.totalModels ?? 0,
    runningModels: overrides.runningModels ?? 0,
  };
}

describe('taskTypeOverview helpers', () => {
  it('keeps total anchored to the configured quota baseline for the task type', () => {
    const summaries = buildTaskTypeOverviewSummaries(
      ['Bug修复'],
      [
        createTask({
          status: 'Claimed',
          taskType: 'Bug修复',
          sessionList: [
            {
              sessionId: '',
              taskType: 'Bug修复',
              consumeQuota: true,
              isCompleted: null,
              isSatisfied: null,
              evaluation: '',
              userConversation: '',
            },
          ],
        }),
      ],
      { Bug修复: 9 },
      { Bug修复: 15 },
    );

    expect(summaries[0]).toEqual(expect.objectContaining({
      taskType: 'Bug修复',
      allocatedSessionCount: 1,
      remainingQuota: 9,
      remainingToCompleteCount: 15,
      totalTaskCount: 15,
    }));
  });

  it('derives remaining work from submitted sessions when the allocation quota is depleted', () => {
    const submittedTasks = Array.from({ length: 7 }, (_, index) =>
      createTask({
        id: `submitted-${index + 1}`,
        status: 'Submitted',
        taskType: 'Bug修复',
        sessionList: [
          {
            sessionId: `sess-${index + 1}`,
            taskType: 'Bug修复',
            consumeQuota: true,
            isCompleted: true,
            isSatisfied: true,
            evaluation: '',
            userConversation: '',
          },
        ],
      }),
    );

    const summaries = buildTaskTypeOverviewSummaries(
      ['Bug修复'],
      submittedTasks,
      { Bug修复: 0 },
      { Bug修复: 15 },
    );

    expect(summaries[0]).toEqual(expect.objectContaining({
      remainingQuota: 0,
      remainingToCompleteCount: 8,
      submittedSessionCount: 7,
      totalTaskCount: 15,
    }));
  });

  it('does not let secondary session labels change the configured total', () => {
    const summaries = buildTaskTypeOverviewSummaries(
      ['Bug修复', 'Feature迭代'],
      [
        createTask({
          id: 'bug-primary',
          status: 'Claimed',
          taskType: 'Bug修复',
          sessionList: [
            {
              sessionId: '',
              taskType: 'Bug修复',
              consumeQuota: true,
              isCompleted: null,
              isSatisfied: null,
              evaluation: '',
              userConversation: '',
            },
            {
              sessionId: 'sess-feature',
              taskType: 'Feature迭代',
              consumeQuota: true,
              isCompleted: null,
              isSatisfied: null,
              evaluation: '',
              userConversation: '',
            },
          ],
        }),
      ],
      { Bug修复: 14, Feature迭代: 6 },
      { Bug修复: 15, Feature迭代: 8 },
    );

    const bugSummary = summaries.find((summary) => summary.taskType === 'Bug修复');
    const featureSummary = summaries.find((summary) => summary.taskType === 'Feature迭代');

    expect(bugSummary).toEqual(expect.objectContaining({
      allocatedSessionCount: 1,
      remainingToCompleteCount: 15,
      totalTaskCount: 15,
    }));
    expect(featureSummary).toEqual(expect.objectContaining({
      allocatedSessionCount: 1,
      remainingToCompleteCount: 8,
      totalTaskCount: 8,
    }));
  });
});
