import { describe, expect, it } from 'vitest';
import {
  buildTaskWorkspaceOptions,
  formatWorkspaceOptionLabel,
  getAssistantDisplayContent,
  resolvePromptTaskTypeSelection,
} from './promptUtils';
import type { ModelRunFromDB, TaskFromDB } from '../../../api/task';

function buildTask(overrides: Partial<TaskFromDB>): TaskFromDB {
  return {
    id: overrides.id ?? 'task-1',
    gitlabProjectId: overrides.gitlabProjectId ?? 1849,
    projectName: overrides.projectName ?? 'label-01849',
    status: overrides.status ?? 'Claimed',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [],
    localPath: overrides.localPath ?? null,
    promptText: overrides.promptText ?? null,
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'idle',
    promptGenerationError: overrides.promptGenerationError ?? null,
    promptGenerationStartedAt: overrides.promptGenerationStartedAt ?? null,
    promptGenerationFinishedAt: overrides.promptGenerationFinishedAt ?? null,
    createdAt: overrides.createdAt ?? 1712550000,
    updatedAt: overrides.updatedAt ?? 1712550300,
    notes: overrides.notes ?? null,
    projectConfigId: overrides.projectConfigId ?? null,
  };
}

function buildRun(overrides: Partial<ModelRunFromDB>): ModelRunFromDB {
  return {
    id: overrides.id ?? 'run-1',
    taskId: overrides.taskId ?? 'task-1',
    modelName: overrides.modelName ?? 'model-a',
    branchName: overrides.branchName ?? null,
    localPath: overrides.localPath ?? null,
    prUrl: overrides.prUrl ?? null,
    originUrl: overrides.originUrl ?? null,
    gsbScore: overrides.gsbScore ?? null,
    status: overrides.status ?? 'pending',
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

describe('promptUtils', () => {
  it('extracts prompt text from assistant json payloads', () => {
    expect(
      getAssistantDisplayContent(
        JSON.stringify({ prompt: '请修复任务列表刷新闪烁问题' }),
      ),
    ).toBe('请修复任务列表刷新闪烁问题');
    expect(getAssistantDisplayContent('plain text response')).toBe('plain text response');
  });

  it('builds workspace options with source model first and dedupes ids', () => {
    const options = buildTaskWorkspaceOptions(
      buildTask({ localPath: '/repo/base' }),
      [
        buildRun({ modelName: 'cotv21-pro', localPath: '/repo/cotv21-pro' }),
        buildRun({ id: 'run-2', modelName: 'ORIGIN', localPath: '/repo/origin' }),
        buildRun({ id: 'run-3', modelName: 'cotv21-pro', localPath: '/repo/duplicate' }),
      ],
      'ORIGIN',
    );

    expect(options).toEqual([
      {
        id: 'model:ORIGIN',
        label: 'ORIGIN',
        path: '/repo/origin',
        isSource: true,
      },
      {
        id: 'model:cotv21-pro',
        label: 'cotv21-pro',
        path: '/repo/cotv21-pro',
        isSource: false,
      },
    ]);
  });

  it('falls back to task base path when no model workspace exists', () => {
    expect(
      buildTaskWorkspaceOptions(
        buildTask({ localPath: '/repo/base' }),
        [],
        'ORIGIN',
      ),
    ).toEqual([
      {
        id: 'task:base',
        label: '默认目录',
        path: '/repo/base',
        isSource: true,
      },
    ]);
  });

  it('formats workspace option labels with path base and source marker', () => {
    expect(
      formatWorkspaceOptionLabel({
        id: 'model:ORIGIN',
        label: 'ORIGIN',
        path: '/repo/projects/label-01849-origin',
        isSource: true,
      }),
    ).toBe('ORIGIN · label-01849-origin · 源码');
  });

  it('defaults prompt task type to the task type when no manual selection exists', () => {
    expect(
      resolvePromptTaskTypeSelection('Bug修复', '', [
        { value: '未归类' },
        { value: 'Bug修复' },
        { value: 'Feature迭代' },
      ]),
    ).toBe('Bug修复');
  });

  it('keeps a valid manual prompt task type selection', () => {
    expect(
      resolvePromptTaskTypeSelection('Bug修复', 'Feature迭代', [
        { value: '未归类' },
        { value: 'Bug修复' },
        { value: 'Feature迭代' },
      ]),
    ).toBe('Feature迭代');
  });

  it('falls back to the task type when the current prompt task type selection becomes invalid', () => {
    expect(
      resolvePromptTaskTypeSelection('Bug修复', '工程化', [
        { value: '未归类' },
        { value: 'Bug修复' },
        { value: 'Feature迭代' },
      ]),
    ).toBe('Bug修复');
  });
});
