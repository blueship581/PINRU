import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
  it('toggles the status panel on click', () => {

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
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
      />,
    );

    const statusTrigger = screen.getByText('任务状态').closest('button');
    expect(statusTrigger).not.toBeNull();
    expect(statusTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('切换任务状态')).not.toBeInTheDocument();

    fireEvent.click(statusTrigger!);

    expect(statusTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('切换任务状态')).toBeInTheDocument();

    fireEvent.click(statusTrigger!);

    expect(statusTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('triggers a status change from the expanded panel', () => {
    const onStatusChange = vi.fn();

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
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={onStatusChange}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('任务状态'));
    fireEvent.click(screen.getByText('下载中'));

    expect(onStatusChange).toHaveBeenCalledWith('Downloading');
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
        actionError=""
        onOpenLocalFolder={onOpenLocalFolder}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('在本地文件夹中打开'));

    expect(onOpenLocalFolder).toHaveBeenCalledTimes(1);
  });

  it('triggers a task type change from the expanded panel', () => {
    const onTaskTypeChange = vi.fn();

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
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={onTaskTypeChange}
        onGeneratePrompt={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('任务类型'));
    fireEvent.click(screen.getByText('Feature 迭代'));

    expect(onTaskTypeChange).toHaveBeenCalledWith('Feature迭代');
  });
});
