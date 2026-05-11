import { describe, expect, it } from 'vitest';
import { buildDefaultSubmitRepo, formatRepoDate, slugifyRepoName } from '../submitRepoName';

describe('submitRepoName', () => {
  it('builds default repo names from project name and local date', () => {
    const date = new Date(2026, 4, 9);

    expect(buildDefaultSubmitRepo('blueship581', 'A-1993-1', date)).toBe(
      'blueship581/A-1993-1-20260509',
    );
    expect(buildDefaultSubmitRepo('blueship581', 'B-46', date)).toBe(
      'blueship581/B-46-20260509',
    );
  });

  it('formats dates as yyyyMMdd', () => {
    expect(formatRepoDate(new Date(2026, 0, 5))).toBe('20260105');
  });

  it('keeps repo-safe project names', () => {
    expect(slugifyRepoName('  A 1993 / 1  ')).toBe('A-1993-1');
    expect(slugifyRepoName('中文项目')).toBe('project');
  });
});
