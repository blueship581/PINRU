import { describe, expect, it } from 'vitest';
import { buildOverviewAggregates } from './aggregation';
import type { TaskFromDB } from '../../../api/task';

function makeTask(partial: Partial<TaskFromDB> & Pick<TaskFromDB, 'id' | 'gitlabProjectId'>): TaskFromDB {
  return {
    id: partial.id,
    gitlabProjectId: partial.gitlabProjectId,
    projectName: partial.projectName ?? `repo-${partial.gitlabProjectId}`,
    status: partial.status ?? 'Claimed',
    taskType: partial.taskType ?? '未归类',
    sessionList: [],
    localPath: null,
    promptText: partial.promptText ?? null,
    promptGenerationStatus: partial.promptGenerationStatus ?? 'idle',
    promptGenerationError: null,
    promptGenerationStartedAt: null,
    promptGenerationFinishedAt: null,
    createdAt: partial.createdAt ?? 0,
    updatedAt: partial.createdAt ?? 0,
    notes: null,
    projectConfigId: null,
    projectType: '',
    changeScope: '',
  };
}

describe('buildOverviewAggregates', () => {
  it('tolerates null/undefined input without crashing', () => {
    expect(buildOverviewAggregates(null).totals.tasks).toBe(0);
    expect(buildOverviewAggregates(undefined).totals.tasks).toBe(0);
  });

  it('returns empty aggregates for no tasks', () => {
    const result = buildOverviewAggregates([]);
    expect(result.rows).toEqual([]);
    expect(result.taskTypes).toEqual([]);
    expect(result.promptGroups).toEqual([]);
    expect(result.totals).toEqual({
      repos: 0,
      tasks: 0,
      taskTypes: 0,
      promptsFilled: 0,
      promptsEmpty: 0,
    });
  });

  it('groups by gitlabProjectId and counts taskType per repo', () => {
    const tasks = [
      makeTask({ id: '1', gitlabProjectId: 42, taskType: 'Bug修复', createdAt: 100 }),
      makeTask({ id: '2', gitlabProjectId: 42, taskType: 'Bug修复', createdAt: 200 }),
      makeTask({ id: '3', gitlabProjectId: 42, taskType: '代码生成', createdAt: 150 }),
      makeTask({ id: '4', gitlabProjectId: 77, taskType: 'Feature迭代', createdAt: 50 }),
    ];
    const { rows } = buildOverviewAggregates(tasks);
    expect(rows).toHaveLength(2);
    expect(rows[0].repoId).toBe('42');
    expect(rows[0].total).toBe(3);
    expect(rows[0].taskCounts).toEqual({ 'Bug修复': 2, '代码生成': 1 });
    expect(rows[1].repoId).toBe('77');
  });

  it('picks repoName from task with largest createdAt', () => {
    const tasks = [
      makeTask({ id: '1', gitlabProjectId: 42, projectName: 'old', createdAt: 100 }),
      makeTask({ id: '2', gitlabProjectId: 42, projectName: 'new', createdAt: 500 }),
      makeTask({ id: '3', gitlabProjectId: 42, projectName: 'mid', createdAt: 200 }),
    ];
    const { rows } = buildOverviewAggregates(tasks);
    expect(rows[0].repoName).toBe('new');
  });

  it('taskTypes sorted by total count desc', () => {
    const tasks = [
      makeTask({ id: '1', gitlabProjectId: 42, taskType: 'Bug修复' }),
      makeTask({ id: '2', gitlabProjectId: 42, taskType: 'Bug修复' }),
      makeTask({ id: '3', gitlabProjectId: 77, taskType: '代码生成' }),
      makeTask({ id: '4', gitlabProjectId: 77, taskType: '代码生成' }),
      makeTask({ id: '5', gitlabProjectId: 77, taskType: '代码生成' }),
      makeTask({ id: '6', gitlabProjectId: 88, taskType: 'Feature迭代' }),
    ];
    const { taskTypes } = buildOverviewAggregates(tasks);
    expect(taskTypes).toEqual(['代码生成', 'Bug修复', 'Feature迭代']);
  });

  it('promptGroups list entries per repo sorted by createdAt desc and labelled by createdAt asc', () => {
    const tasks = [
      makeTask({ id: 'old', gitlabProjectId: 42, projectName: 'label-00042', promptText: '旧提示词', createdAt: 100 }),
      makeTask({ id: 'new', gitlabProjectId: 42, projectName: 'label-00042', promptText: '新提示词', createdAt: 500 }),
      makeTask({ id: 'empty', gitlabProjectId: 42, projectName: 'label-00042', promptText: null, createdAt: 300 }),
    ];
    const { promptGroups } = buildOverviewAggregates(tasks);
    expect(promptGroups).toHaveLength(1);
    expect(promptGroups[0].entries.map((e) => e.taskId)).toEqual(['new', 'empty', 'old']);
    expect(promptGroups[0].entries.map((e) => e.taskLabel)).toEqual([
      'label-00042-3',
      'label-00042-2',
      'label-00042-1',
    ]);
    expect(promptGroups[0].entries[0].promptText).toBe('新提示词');
    expect(promptGroups[0].entries[1].promptText).toBe('');
  });

  it('totals counts prompts filled vs empty', () => {
    const tasks = [
      makeTask({ id: '1', gitlabProjectId: 42, promptText: 'a' }),
      makeTask({ id: '2', gitlabProjectId: 42, promptText: '   ' }),
      makeTask({ id: '3', gitlabProjectId: 42, promptText: null }),
      makeTask({ id: '4', gitlabProjectId: 77, promptText: 'b' }),
    ];
    const { totals } = buildOverviewAggregates(tasks);
    expect(totals.promptsFilled).toBe(2);
    expect(totals.promptsEmpty).toBe(2);
    expect(totals.repos).toBe(2);
    expect(totals.tasks).toBe(4);
  });

  it('normalizes taskType aliases', () => {
    const tasks = [
      makeTask({ id: '1', gitlabProjectId: 42, taskType: 'bugfix' }),
      makeTask({ id: '2', gitlabProjectId: 42, taskType: 'Bug修复' }),
    ];
    const { rows } = buildOverviewAggregates(tasks);
    expect(rows[0].taskCounts).toEqual({ 'Bug修复': 2 });
  });
});
