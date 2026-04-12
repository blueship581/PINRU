import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BackgroundJobPanel from './BackgroundJobPanel';
import { useAppStore } from '../../store';

const eventsOnMock = vi.fn((_eventName: string, _handler: unknown) => vi.fn());
const listJobsMock = vi.fn(async () => []);
const retryJobMock = vi.fn();
const cancelJobMock = vi.fn();

vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: (eventName: string, handler: unknown) => eventsOnMock(eventName, handler),
  },
}));

vi.mock('../../api/job', () => ({
  listJobs: () => listJobsMock(),
  retryJob: (id: string) => retryJobMock(id),
  cancelJob: (id: string) => cancelJobMock(id),
}));

describe('BackgroundJobPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ backgroundJobs: [] });
    listJobsMock.mockResolvedValue([]);
  });

  it('closes when clicking outside the panel', async () => {
    render(
      <MemoryRouter>
        <BackgroundJobPanel />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(listJobsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '查看后台任务' }));
    expect(screen.getByText('后台任务')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText('后台任务')).not.toBeInTheDocument();
    });
  });
});
