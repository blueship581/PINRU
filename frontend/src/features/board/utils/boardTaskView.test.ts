import { describe, expect, it } from 'vitest';
import type { Task } from '../../../store';
import {
  filterBoardTasks,
  getAvailableExecutionRounds,
  groupBoardTasks,
  sortBoardTasks,
} from './boardTaskView';

function createTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    projectId: '1001',
    projectName: 'Alpha',
    status: 'Claimed',
    taskType: 'Bug修复',
    sessionList: [],
    promptGenerationStatus: 'idle',
    promptGenerationError: null,
    createdAt: 1,
    executionRounds: 1,
    aiReviewRounds: 0,
    aiReviewStatus: 'none',
    progress: 0,
    totalModels: 0,
    runningModels: 0,
    ...overrides,
  };
}

describe('boardTaskView helpers', () => {
  it('filters tasks by search, type, stage, and round', () => {
    const tasks = [
      createTask({ id: 'task-a', projectId: '1001', projectName: 'Alpha', taskType: 'bugfix' }),
      createTask({ id: 'task-b', projectId: '1002', projectName: 'Beta', status: 'Submitted', executionRounds: 2 }),
    ];

    expect(
      filterBoardTasks(tasks, {
        search: '1001',
        activeTypes: new Set(['Bug修复']),
        activeStages: new Set(['Claimed']),
        activeRounds: new Set([1]),
      }).map((task) => task.id),
    ).toEqual(['task-a']);
  });

  it('sorts and groups tasks by normalized task type', () => {
    const tasks = [
      createTask({ id: 'task-b', projectName: 'Beta 2', createdAt: 2, executionRounds: 2, taskType: 'Feature迭代' }),
      createTask({ id: 'task-a', projectName: 'Alpha 10', createdAt: 3, executionRounds: 1, taskType: 'bugfix' }),
      createTask({ id: 'task-c', projectName: 'Alpha 2', createdAt: 3, executionRounds: 1, taskType: 'Bug修复' }),
    ];

    const sorted = sortBoardTasks(tasks, 'created-desc');
    expect(sorted.map((task) => task.id)).toEqual(['task-c', 'task-a', 'task-b']);

    expect(groupBoardTasks(['Bug修复', 'Feature迭代'], sorted)).toEqual([
      { taskType: 'Bug修复', tasks: [sorted[0], sorted[1]] },
      { taskType: 'Feature迭代', tasks: [sorted[2]] },
    ]);
    expect(getAvailableExecutionRounds(tasks)).toEqual([1, 2]);
  });
});
