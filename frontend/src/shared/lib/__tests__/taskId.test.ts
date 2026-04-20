import { describe, expect, it } from 'vitest';
import { extractTaskClaimSequence, formatTaskDisplayId } from '../taskId';

describe('taskId helpers', () => {
  it('extracts claim sequence from long project-scoped task ids', () => {
    expect(extractTaskClaimSequence('pproject-1710000000001__bug__label-01849-2')).toBe(2);
    expect(extractTaskClaimSequence('pproject-1710000000001__bug__label-8123456789012345-2')).toBe(2);
  });

  it('builds a concise display id for claimed tasks', () => {
    expect(
      formatTaskDisplayId({
        id: 'pproject-1710000000001__bug__label-01849-2',
        projectId: '1849',
        taskType: 'Bug修复',
      }),
    ).toBe('1849-Bug修复-2');
  });

  it('falls back to project id plus task type when no claim sequence exists', () => {
    expect(
      formatTaskDisplayId({
        id: 'pproject-1710000000001__bug__label-01849',
        projectId: '1849',
        taskType: 'Bug修复',
      }),
    ).toBe('1849-Bug修复');
  });

  it('uses project name plus sequence for local synthetic tasks', () => {
    expect(
      formatTaskDisplayId({
        id: 'pproject-1710000000001__bug__label-8123456789012345-1',
        projectId: '8123456789012345',
        projectName: 'B-715',
        taskType: '代码生成',
      }),
    ).toBe('B-715-1');
  });
});
