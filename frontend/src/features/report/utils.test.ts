import { describe, expect, it } from 'vitest';
import type { TaskFromDB, ModelRunFromDB, AiReviewRoundFromDB } from '../../api/task';
import { assembleReportRows, resolveReportRepoId } from './utils';

function createTask(overrides: Partial<TaskFromDB> = {}): TaskFromDB {
  return {
    id: 'task-1',
    gitlabProjectId: 1849,
    projectName: 'label-01849',
    status: 'Claimed',
    taskType: '未归类',
    sessionList: [],
    localPath: null,
    promptText: null,
    promptGenerationStatus: 'idle',
    promptGenerationError: null,
    promptGenerationStartedAt: null,
    promptGenerationFinishedAt: null,
    createdAt: 1,
    updatedAt: 1,
    notes: null,
    projectConfigId: 'project-1',
    projectType: '',
    changeScope: '',
    ...overrides,
  };
}

function createModelRun(overrides: Partial<ModelRunFromDB> = {}): ModelRunFromDB {
  return {
    id: 'run-1',
    taskId: 'task-1',
    modelName: 'cotv21-pro',
    branchName: null,
    localPath: null,
    prUrl: null,
    originUrl: null,
    gsbScore: null,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    sessionId: null,
    conversationRounds: 0,
    conversationDate: null,
    submitError: null,
    sessionList: [],
    reviewStatus: 'none',
    reviewRound: 0,
    reviewNotes: null,
    ...overrides,
  };
}

describe('report utils', () => {
  it('uses readable project names for local imported tasks', () => {
    expect(
      resolveReportRepoId(
        createTask({
          id: 'pproject-1__bug__label-8123456789012345-1',
          gitlabProjectId: 8_123_456_789_012_345,
          projectName: 'B-198',
        }),
      ),
    ).toBe('B-198-1');
  });

  it('keeps numeric repo ids for regular gitlab tasks', () => {
    expect(resolveReportRepoId(createTask({ gitlabProjectId: 1849 }))).toBe('1849');
  });

  it('sorts rows by displayed repo id with natural order', () => {
    const tasks = [
      createTask({
        id: 'pproject-1__bug__label-8123456789012346-2',
        gitlabProjectId: 8_123_456_789_012_346,
        projectName: 'B-10',
      }),
      createTask({
        id: 'pproject-1__bug__label-8123456789012345-1',
        gitlabProjectId: 8_123_456_789_012_345,
        projectName: 'B-2',
      }),
    ];

    const modelRunsByTask = new Map<string, ModelRunFromDB[]>(
      tasks.map((task) => [
        task.id,
        [
          createModelRun({
            id: `run-${task.id}`,
            taskId: task.id,
            sessionList: [
              {
                sessionId: `${task.id}-session`,
                taskType: '未归类',
                consumeQuota: true,
              },
            ],
          }),
        ],
      ]),
    );

    const rows = assembleReportRows(
      tasks,
      modelRunsByTask,
      new Map<string, AiReviewRoundFromDB[]>(),
    );

    expect(rows.map((row) => row.repoId)).toEqual(['B-2-1', 'B-10-2']);
  });
});
