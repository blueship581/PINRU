import { beforeEach, describe, expect, it, vi } from 'vitest';

const byNameMock = vi.fn();

vi.mock('@wailsio/runtime', () => ({
  Call: {
    ByName: (...args: unknown[]) => byNameMock(...args),
  },
}));

describe('callService', () => {
  beforeEach(() => {
    vi.resetModules();
    byNameMock.mockReset();
  });

  it('prefers the refactored backend package path before trying legacy main bindings', async () => {
    byNameMock.mockResolvedValueOnce([{ id: 'project-1' }]);

    const { callService } = await import('./wails');
    const result = await callService('ConfigService', 'ListProjects');

    expect(result).toEqual([{ id: 'project-1' }]);
    expect(byNameMock).toHaveBeenCalledTimes(1);
    expect(byNameMock).toHaveBeenNthCalledWith(
      1,
      'github.com/blueship581/pinru/app/config.ConfigService.ListProjects',
    );
  });

  it('falls back to the legacy main binding when the package path binding is missing', async () => {
    byNameMock
      .mockRejectedValueOnce(new Error("Binding call failed: unknown bound method name 'github.com/blueship581/pinru/app/config.ConfigService.ListProjects'"))
      .mockResolvedValueOnce([{ id: 'project-1' }]);

    const { callService } = await import('./wails');
    const result = await callService('ConfigService', 'ListProjects');

    expect(result).toEqual([{ id: 'project-1' }]);
    expect(byNameMock).toHaveBeenNthCalledWith(
      1,
      'github.com/blueship581/pinru/app/config.ConfigService.ListProjects',
    );
    expect(byNameMock).toHaveBeenNthCalledWith(
      2,
      'main.ConfigService.ListProjects',
    );
  });

  it('reuses the successful binding prefix for subsequent calls', async () => {
    byNameMock
      .mockResolvedValueOnce([{ id: 'project-1' }])
      .mockResolvedValueOnce([{ id: 'project-2' }]);

    const { callService } = await import('./wails');
    await callService('ConfigService', 'ListProjects');
    const result = await callService('ConfigService', 'ListProjects');

    expect(result).toEqual([{ id: 'project-2' }]);
    expect(byNameMock).toHaveBeenNthCalledWith(
      1,
      'github.com/blueship581/pinru/app/config.ConfigService.ListProjects',
    );
    expect(byNameMock).toHaveBeenNthCalledWith(
      2,
      'github.com/blueship581/pinru/app/config.ConfigService.ListProjects',
    );
  });
});
