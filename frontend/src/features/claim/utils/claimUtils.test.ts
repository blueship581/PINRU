import { describe, expect, it } from 'vitest';
import {
  buildProjectBasePath,
  buildProjectRef,
  buildProjectSourcePath,
  formatClaimProjectId,
  formatProjectName,
  getResultStatusMeta,
  parseProjectIds,
  partitionClaimsByProjectLimit,
  pickSourceModel,
} from './claimUtils';
import type { ModelEntry } from '../types';

describe('claimUtils', () => {
  it('parses project ids with dedupe and invalid-token filtering', () => {
    expect(parseProjectIds('1849 1850, 1849\nabc；1851')).toEqual(['1849', '1850', '1851']);
  });

  it('formats gitlab project refs and managed task paths', () => {
    expect(formatProjectName('1849')).toBe('label-01849');
    expect(buildProjectRef('1849')).toBe('prompt2repo/label-01849');
    expect(buildProjectBasePath('label-01849', 'Bug修复', '/tmp/workspace/')).toBe(
      '/tmp/workspace/label-01849-bug修复',
    );
    expect(buildProjectBasePath('label-01849', 'Bug修复', '/tmp/workspace/', 2)).toBe(
      '/tmp/workspace/label-01849-bug修复-2',
    );
    expect(
      buildProjectSourcePath('1872', '未归类', '/tmp/workspace/label-01872-未归类'),
    ).toBe('/tmp/workspace/label-01872-未归类/01872-未归类');
    expect(
      buildProjectSourcePath('1872', '未归类', '/tmp/workspace/label-01872-未归类-2', 2),
    ).toBe('/tmp/workspace/label-01872-未归类-2/01872-未归类-2');
    expect(formatClaimProjectId('1849', 0)).toBe('1849');
    expect(formatClaimProjectId('1849', 3)).toBe('1849-3');
  });

  it('picks preferred source model before falling back to ORIGIN and first item', () => {
    const models: ModelEntry[] = [
      { id: 'ORIGIN', name: 'ORIGIN', checked: true, status: 'pending' },
      { id: 'cotv21-pro', name: 'cotv21-pro', checked: true, status: 'pending' },
    ];

    expect(pickSourceModel(models, 'cotv21-pro').id).toBe('cotv21-pro');
    expect(pickSourceModel(models, 'missing').id).toBe('ORIGIN');
    expect(
      pickSourceModel(
        [{ id: 'model-a', name: 'model-a', checked: true, status: 'pending' }],
        'missing',
      ).id,
    ).toBe('model-a');
  });

  it('partitions planned claims by per-project upper limit before execution', () => {
    const claims = [
      { projectId: '1849', sequence: 1 },
      { projectId: '1849', sequence: 2 },
      { projectId: '1849', sequence: 3 },
      { projectId: '1850', sequence: 1 },
    ];

    const result = partitionClaimsByProjectLimit(
      claims,
      (claim) => claim.projectId,
      new Map([
        ['1849', 1],
        ['1850', 0],
      ]),
      2,
    );

    expect(result.executableClaims).toEqual([
      { projectId: '1849', sequence: 1 },
      { projectId: '1850', sequence: 1 },
    ]);
    expect(result.exceededClaims).toEqual([
      { projectId: '1849', sequence: 2 },
      { projectId: '1849', sequence: 3 },
    ]);
  });

  it('maps result status to stable ui labels', () => {
    expect(getResultStatusMeta('running').label).toBe('处理中');
    expect(getResultStatusMeta('partial').label).toBe('部分完成');
    expect(getResultStatusMeta('error').label).toBe('失败');
  });
});
