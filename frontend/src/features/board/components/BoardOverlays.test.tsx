import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../store';
import { TaskCardContextMenu } from './BoardOverlays';
import type { TaskChildDirectory } from '../../../api/task';

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
    aiReviewRounds: overrides.aiReviewRounds ?? 0,
    aiReviewStatus: overrides.aiReviewStatus ?? 'none',
    progress: overrides.progress ?? 0,
    totalModels: overrides.totalModels ?? 0,
    runningModels: overrides.runningModels ?? 0,
  };
}

function createChildDirectory(overrides: Partial<TaskChildDirectory> = {}): TaskChildDirectory {
  return {
    name: overrides.name ?? 'cotv21-pro',
    path: overrides.path ?? '/tmp/task-1/cotv21-pro',
    modelRunId: overrides.modelRunId ?? 'run-1',
    modelName: overrides.modelName ?? 'cotv21-pro',
    reviewStatus: overrides.reviewStatus ?? 'none',
    reviewRound: overrides.reviewRound ?? 0,
    reviewNotes: overrides.reviewNotes ?? null,
    isSource: overrides.isSource ?? false,
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
        childDirectories={[]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
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
        childDirectories={[]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={onStatusChange}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
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
        childDirectories={[]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={onOpenLocalFolder}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
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
        childDirectories={[]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={onTaskTypeChange}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('任务类型'));
    fireEvent.click(screen.getByText('Feature 迭代'));

    expect(onTaskTypeChange).toHaveBeenCalledWith('Feature迭代');
  });

  it('shows prompt generation tips in the flyout', () => {
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
        childDirectories={[]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('生成提示词'));

    expect(screen.getByText('小贴士')).toBeInTheDocument();
    expect(screen.getByText('1. Bug修复类型建议自己确认是否准确。')).toBeInTheDocument();
    expect(screen.getByText('2. 生成多套提示词时，记得确认是否与之前雷同。')).toBeInTheDocument();
  });

  it('shows action errors near the menu header', () => {
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
        childDirectories={[]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError="不能切换到目标任务类型"
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
      />,
    );

    expect(screen.getByText('操作未完成')).toBeInTheDocument();
    expect(screen.getByText('不能切换到目标任务类型')).toBeInTheDocument();
  });

  it('triggers quick AI review from the quick execute panel', () => {
    const onQuickAiReview = vi.fn();

    render(
      <TaskCardContextMenu
        menuRef={createRef<HTMLDivElement>()}
        task={createTask({ taskType: '代码测试' })}
        position={{ x: 32, y: 32 }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error']}
        availableTaskTypes={['Bug修复', 'Feature迭代']}
        statusChanging={false}
        taskTypeChanging={false}
        localFolderOpening={false}
        childDirectories={[createChildDirectory()]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={onQuickAiReview}
      />,
    );

    fireEvent.click(screen.getByText('快捷执行'));
    fireEvent.click(screen.getByText('cotv21-pro'));

    expect(onQuickAiReview).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/task-1/cotv21-pro', modelName: 'cotv21-pro' }),
    );
  });

  it('shows child directories in quick execute with source metadata', () => {
    render(
      <TaskCardContextMenu
        menuRef={createRef<HTMLDivElement>()}
        task={createTask({ taskType: '代码理解' })}
        position={{ x: 32, y: 32 }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error']}
        availableTaskTypes={['Bug修复', 'Feature迭代']}
        statusChanging={false}
        taskTypeChanging={false}
        localFolderOpening={false}
        childDirectories={[createChildDirectory({
          name: '01849-bug修复',
          path: '/tmp/task-1/01849-bug修复',
          modelRunId: 'run-origin',
          modelName: 'ORIGIN',
          isSource: true,
        })]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('快捷执行'));

    expect(screen.getByText('01849-bug修复')).toBeInTheDocument();
    expect(screen.getByText('源码目录')).toBeInTheDocument();
  });

  it('shows an empty state when no child directories are available', () => {
    render(
      <TaskCardContextMenu
        menuRef={createRef<HTMLDivElement>()}
        task={createTask({ taskType: '工程化' })}
        position={{ x: 32, y: 32 }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error']}
        availableTaskTypes={['Bug修复', 'Feature迭代']}
        statusChanging={false}
        taskTypeChanging={false}
        localFolderOpening={false}
        childDirectories={[]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('快捷执行'));

    expect(screen.getByText('当前题卡目录下没有可用子文件夹。先完成领题 Clone，或检查任务目录是否存在。')).toBeInTheDocument();
  });

  it('hides quick AI review for unsupported task types', () => {
    render(
      <TaskCardContextMenu
        menuRef={createRef<HTMLDivElement>()}
        task={createTask({ taskType: 'Bug修复' })}
        position={{ x: 32, y: 32 }}
        statusOptions={['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error']}
        availableTaskTypes={['Bug修复', 'Feature迭代']}
        statusChanging={false}
        taskTypeChanging={false}
        localFolderOpening={false}
        childDirectories={[createChildDirectory()]}
        childDirectoriesLoading={false}
        quickActionLoadingPath={null}
        actionError=""
        onOpenLocalFolder={() => {}}
        onStatusChange={() => {}}
        onTaskTypeChange={() => {}}
        onGeneratePrompt={() => {}}
        onQuickAiReview={() => {}}
      />,
    );

    expect(screen.queryByText('快捷执行')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 复审 ·/)).not.toBeInTheDocument();
  });
});
