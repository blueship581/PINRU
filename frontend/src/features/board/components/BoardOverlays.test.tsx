import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../store';
import { TaskCardContextMenu } from './BoardOverlays';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    projectId: overrides.projectId ?? '1849',
    projectName: overrides.projectName ?? 'label-01849',
    status: overrides.status ?? 'Claimed',
    taskType: overrides.taskType ?? 'Bug修复',
    sessionList: overrides.sessionList ?? [],
    promptGenerationStatus: overrides.promptGenerationStatus ?? 'idle',
    promptGenerationError: overrides.promptGenerationError ?? null,
    createdAt: overrides.createdAt ?? 1,
    executionRounds: overrides.executionRounds ?? 1,
    progress: overrides.progress ?? 0,
    totalModels: overrides.totalModels ?? 0,
    runningModels: overrides.runningModels ?? 0,
  };
}

describe('TaskCardContextMenu', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the status submenu after hover delay', () => {
    vi.useFakeTimers();

    render(
      <TaskCardContextMenu
        menuRef={createRef<HTMLDivElement>()}
        task={createTask()}
        position={{ x: 32, y: 32 }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error']}
        availableTaskTypes={['Bug修复', 'Feature迭代']}
        statusChanging={false}
        taskTypeChanging={false}
        localFolderOpening={false}
        localFolderError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
      />,
    );

    const statusTrigger = screen.getByText('任务状态').closest('button');
    expect(statusTrigger).not.toBeNull();
    expect(screen.queryByText('切换任务状态')).not.toBeInTheDocument();

    fireEvent.mouseEnter(statusTrigger!);

    act(() => {
      vi.advanceTimersByTime(170);
    });

    expect(screen.getByText('切换任务状态')).toBeInTheDocument();
  });

  it('renders and triggers the open local folder action', () => {
    const onOpenLocalFolder = vi.fn();

    render(
      <TaskCardContextMenu
        menuRef={createRef<HTMLDivElement>()}
        task={createTask()}
        position={{ x: 32, y: 32 }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error']}
        availableTaskTypes={['Bug修复', 'Feature迭代']}
        statusChanging={false}
        taskTypeChanging={false}
        localFolderOpening={false}
        localFolderError=""
        onOpenLocalFolder={onOpenLocalFolder}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('在本地文件夹中打开'));

    expect(onOpenLocalFolder).toHaveBeenCalledTimes(1);
  });
});
