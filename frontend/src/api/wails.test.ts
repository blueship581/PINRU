import { beforeEach, describe, expect, it, vi } from 'vitest';

const byNameMock = vi.fn();

vi.mock('@wailsio/runtime', () => ({
  Call: {
    ByName: (...args: unknown[]) => byNameMock(...args),
  },
}));

describe('callService', () => {
  beforeEach(() => {
    byNameMock.mockReset();
  });

  it('falls back to the refactored backend package path when legacy main binding is missing', async () => {
    byNameMock
      .mockRejectedValueOnce(new Error("Binding call failed: unknown bound method name 'main.ConfigService.ListProjects'"))
      .mockResolvedValueOnce([{ id: 'project-1' }]);

    const { callService } = await import('./wails');
    const result = await callService('ConfigService', 'ListProjects');

    expect(result).toEqual([{ id: 'project-1' }]);
    expect(byNameMock).toHaveBeenNthCalledWith(
      1,
      'main.ConfigService.ListProjects',
    );
    expect(byNameMock).toHaveBeenNthCalledWith(
      2,
      'github.com/blueship581/pinru/app/config.ConfigService.ListProjects',
    );
  });
});
