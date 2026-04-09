import { describe, expect, it } from 'vitest';
import {
  buildProjectTaskTypes,
  getTaskTypeQuotaValue,
  normalizeTaskTypeName,
  serializeTaskTypeQuotas,
} from '../taskTypes';

describe('taskTypes helpers', () => {
  it('normalizes common aliases to canonical task types', () => {
    expect(normalizeTaskTypeName('bugfix')).toBe('Bug修复');
    expect(normalizeTaskTypeName('feature')).toBe('Feature迭代');
    expect(normalizeTaskTypeName('test')).toBe('代码测试');
  });

  it('builds project task types with dedupe and fallback merge', () => {
    expect(
      buildProjectTaskTypes(
        {
          taskTypes: 'Bug修复\nfeature\n代码测试',
          taskTypeQuotas: '{"Feature迭代":2,"Bug修复":1}',
        },
        ['代码测试', '代码理解'],
      ),
    ).toEqual(['Bug修复', 'Feature迭代', '代码测试', '代码理解']);
  });

  it('serializes quotas only for allowed normalized task types', () => {
    expect(
      serializeTaskTypeQuotas(
        {
          bugfix: 2,
          'Feature迭代': 3,
          未知类型: 5,
        },
        ['Bug修复', 'Feature迭代'],
      ),
    ).toBe('{"Bug修复":2,"Feature迭代":3}');
  });

  it('returns null for missing quotas and normalized values for matches', () => {
    expect(getTaskTypeQuotaValue({ Bug修复: 2 }, 'bugfix')).toBe(2);
    expect(getTaskTypeQuotaValue({ Bug修复: 2 }, '代码测试')).toBeNull();
  });
});
