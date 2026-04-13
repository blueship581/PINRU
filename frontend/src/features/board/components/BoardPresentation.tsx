import { motion } from 'motion/react';
import {
  CheckCircle2,
  CircleDashed,
  Clock,
  GitBranch,
  PlayCircle,
  Trash2,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Task, TaskStatus } from '../../../store';
import { getTaskTypePresentation } from '../../../api/config';
import type { PromptGenerationStatus, ReviewStatus } from '../../../api/task';
import type { TaskTypeOverviewSummary } from '../../../shared/lib/taskTypeOverview';

export type CardSize = 'sm' | 'md' | 'lg';

/**
 * 生成任务的可读代号，格式为 `{项目ID}-{任务类型}[-{序号}]`
 * 例如：1990-代码生成-1
 */
function buildTaskDisplayCode(task: Task): string {
  const projectId = parseInt(task.projectId, 10);
  const typeName = task.taskType || '未归类';
  // 从 task ID 中提取 claim 序号，格式为 label-NNNNN-M（其中 M 是序号）
  const seqMatch = task.id.match(/label-\d{5}-(\d+)/);
  const sequence = seqMatch ? parseInt(seqMatch[1], 10) : 0;
  return sequence > 0 ? `${projectId}-${typeName}-${sequence}` : `${projectId}-${typeName}`;
}

export const STATUS: Record<
  TaskStatus,
  {
    label: string;
    dotCls: string;
    badgeCls: string;
  }
> = {
  Claimed: {
    label: '已领题',
    dotCls: 'bg-blue-500',
    badgeCls:
      'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
  },
  Downloading: {
    label: '下载中',
    dotCls: 'bg-amber-500 animate-pulse',
    badgeCls:
      'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  },
  Downloaded: {
    label: '已下载',
    dotCls: 'bg-slate-500',
    badgeCls:
      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  },
  PromptReady: {
    label: '提示词就绪',
    dotCls: 'bg-violet-500',
    badgeCls:
      'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/20',
  },
  ExecutionCompleted: {
    label: '执行完成',
    dotCls: 'bg-cyan-500',
    badgeCls:
      'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/20',
  },
  Submitted: {
    label: '已提交',
    dotCls: 'bg-emerald-500',
    badgeCls:
      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  },
  Error: {
    label: '错误',
    dotCls: 'bg-red-500',
    badgeCls:
      'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  },
};

export const PROMPT_GENERATION_STATUS: Record<
  PromptGenerationStatus,
  {
    label: string;
    badgeCls: string;
    panelCls: string;
  }
> = {
  idle: {
    label: '未生成',
    badgeCls: 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400',
    panelCls:
      'bg-stone-50 dark:bg-stone-900/40 border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400',
  },
  running: {
    label: '正在生成',
    badgeCls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    panelCls:
      'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/40 text-amber-700 dark:text-amber-400',
  },
  done: {
    label: '已写入任务',
    badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    panelCls:
      'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  },
  error: {
    label: '生成失败',
    badgeCls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    panelCls:
      'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/40 text-red-600 dark:text-red-400',
  },
};

export function normalizePromptGenerationStatus(
  status?: string | null,
): PromptGenerationStatus {
  if (status === 'running' || status === 'done' || status === 'error') {
    return status;
  }
  return 'idle';
}

export function TaskRoundBadge({
  rounds,
  compact = false,
}: {
  rounds: number;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-sky-200 bg-sky-50 font-semibold text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300 ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      }`}
    >
      第 {rounds} 轮
    </span>
  );
}

function TaskAiReviewBadge({
  rounds,
  status,
  compact = false,
}: {
  rounds: number;
  status: ReviewStatus;
  compact?: boolean;
}) {
  if (rounds <= 0 || status === 'none') {
    return null;
  }

  const toneClass =
    status === 'running'
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
      : status === 'warning'
        ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300';
  const label =
    status === 'running'
      ? `复审中 · 第 ${rounds} 轮`
      : status === 'warning'
        ? `复审未过 · 第 ${rounds} 轮`
        : `复审通过 · 第 ${rounds} 轮`;

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${toneClass} ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      }`}
    >
      {label}
    </span>
  );
}

export function TaskCard({
  task,
  size,
  onClick,
  onContextMenu,
  onDelete,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  task: Task;
  size: CardSize;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onDelete: () => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const cfg = STATUS[task.status];
  const typePresentation = getTaskTypePresentation(task.taskType);
  const promptGenerationStatus = normalizePromptGenerationStatus(task.promptGenerationStatus);
  const promptGenerationMeta = PROMPT_GENERATION_STATUS[promptGenerationStatus];
  const showPromptBadge =
    promptGenerationStatus === 'running' || promptGenerationStatus === 'error';

  if (size === 'sm') {
    return (
      <motion.div
        layout
        onClick={selectionMode ? onToggleSelect : onClick}
        onContextMenu={onContextMenu}
        className={`group bg-white dark:bg-stone-900 border rounded-2xl p-3.5 hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-sm transition-all cursor-default ${
          selectionMode && selected
            ? 'border-indigo-500 dark:border-indigo-500'
            : 'border-stone-200 dark:border-stone-800'
        }`}
      >
        <div className="flex items-start justify-between gap-2 mb-2.5">
          {selectionMode ? (
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 h-3.5 w-3.5 rounded accent-indigo-500 cursor-default flex-shrink-0"
            />
          ) : (
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${cfg.dotCls}`} />
          )}
          <div className="flex items-center gap-1.5 ml-auto">
            {showPromptBadge && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-lg font-bold ${promptGenerationMeta.badgeCls}`}
              >
                {promptGenerationStatus === 'running' ? '出题中' : '出题失败'}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold border ${cfg.badgeCls}`}>
              {cfg.label}
            </span>
            {!selectionMode && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-default"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-50 leading-snug line-clamp-1 mb-0.5">
          {task.projectName}
        </p>
        <p className="font-mono text-[11px] text-stone-400 dark:text-stone-500 mb-1.5">
          #{task.projectId}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${typePresentation.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
            {typePresentation.label}
          </span>
          <TaskRoundBadge rounds={task.executionRounds} compact />
          <TaskAiReviewBadge rounds={task.aiReviewRounds} status={task.aiReviewStatus} compact />
        </div>
        {task.totalModels > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <div className="flex-1 h-1 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  task.progress === task.totalModels ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                style={{ width: `${(task.progress / task.totalModels) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-bold tabular-nums text-stone-400">
              {task.progress}/{task.totalModels}
            </span>
          </div>
        )}
      </motion.div>
    );
  }

  if (size === 'lg') {
    return (
      <motion.div
        layout
        onClick={selectionMode ? onToggleSelect : onClick}
        onContextMenu={onContextMenu}
        className={`group bg-white dark:bg-stone-900 border rounded-2xl p-5 hover:border-stone-300 dark:hover:border-stone-700 hover:shadow-sm transition-all cursor-default ${
          selectionMode && selected
            ? 'border-indigo-500 dark:border-indigo-500'
            : 'border-stone-200 dark:border-stone-800'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            {selectionMode ? (
              <input
                type="checkbox"
                checked={selected ?? false}
                onChange={onToggleSelect}
                onClick={(e) => e.stopPropagation()}
                className="h-4 w-4 rounded accent-indigo-500 cursor-default flex-shrink-0"
              />
            ) : (
              <div className={`w-2 h-2 rounded-full ${cfg.dotCls}`} />
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${cfg.badgeCls}`}>
              {cfg.label}
            </span>
            {showPromptBadge && (
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-bold ${promptGenerationMeta.badgeCls}`}
              >
                提示词{promptGenerationStatus === 'running' ? '生成中' : '失败'}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${typePresentation.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
              {typePresentation.label}
            </span>
            <TaskRoundBadge rounds={task.executionRounds} />
            <TaskAiReviewBadge rounds={task.aiReviewRounds} status={task.aiReviewStatus} />
          </div>
          {!selectionMode && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-default"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="font-semibold text-base text-stone-900 dark:text-stone-50 leading-snug line-clamp-2 mb-1">
          {task.projectName}
        </p>
        <p className="font-mono text-xs text-stone-400 dark:text-stone-500 mb-4">#{task.projectId}</p>
        <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{new Date(task.createdAt * 1000).toLocaleDateString('zh-CN')}</span>
          </div>
          {task.totalModels > 0 && (
            <div className="flex items-center gap-1 font-semibold tabular-nums">
              {task.progress === task.totalModels ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : task.runningModels > 0 ? (
                <PlayCircle className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <CircleDashed className="w-3.5 h-3.5" />
              )}
              {task.progress}/{task.totalModels} 执行副本
            </div>
          )}
        </div>
        {task.totalModels > 0 && (
          <div className="mt-3 h-1.5 w-full bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                task.progress === task.totalModels ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${(task.progress / task.totalModels) * 100}%` }}
            />
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      onClick={selectionMode ? onToggleSelect : onClick}
      onContextMenu={onContextMenu}
      className={`group bg-stone-50 dark:bg-stone-800/40 border rounded-2xl p-4 hover:bg-white dark:hover:bg-stone-800 hover:border-stone-300 dark:hover:border-stone-600 hover:shadow-sm transition-all cursor-default ${
        selectionMode && selected
          ? 'border-indigo-500 dark:border-indigo-500'
          : 'border-stone-200 dark:border-stone-700'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        {selectionMode ? (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded accent-indigo-500 cursor-default flex-shrink-0"
          />
        ) : (
          <div className={`w-1.5 h-1.5 rounded-full ${cfg.dotCls}`} />
        )}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400 dark:text-stone-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(task.createdAt * 1000).toLocaleDateString('zh-CN')}
          </span>
          {!selectionMode && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-default"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="font-semibold text-sm text-stone-900 dark:text-stone-50 mb-1 leading-snug line-clamp-2">
        {task.projectName}
      </p>
      <p className="font-mono text-xs text-stone-400 dark:text-stone-500 mb-2">#{task.projectId}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${typePresentation.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${typePresentation.dot}`} />
          {typePresentation.label}
        </span>
        <TaskRoundBadge rounds={task.executionRounds} />
        <TaskAiReviewBadge rounds={task.aiReviewRounds} status={task.aiReviewStatus} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <GitBranch className="w-3.5 h-3.5" />
          <span className="font-mono truncate max-w-[160px]">{buildTaskDisplayCode(task)}</span>
        </div>
        <div className="flex items-center gap-2">
          {showPromptBadge && (
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${promptGenerationMeta.badgeCls}`}
            >
              {promptGenerationStatus === 'running' ? '出题中' : '出题失败'}
            </span>
          )}
          {task.totalModels > 0 && (
            <div className="flex items-center gap-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
              {task.progress === task.totalModels ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : task.runningModels > 0 ? (
                <PlayCircle className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <CircleDashed className="w-3.5 h-3.5" />
              )}
              {task.progress}/{task.totalModels} 执行副本
            </div>
          )}
        </div>
      </div>
      {task.status === 'Downloading' && task.totalModels > 0 && (
        <div className="mt-3 h-1 w-full bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${(task.progress / task.totalModels) * 100}%` }}
          />
        </div>
      )}
    </motion.div>
  );
}

export function InfoCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {label}
      </p>
      <p
        className={`mt-2 text-sm text-stone-700 dark:text-stone-300 break-all ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function TaskTypeOverviewCard({
  summary,
  onSelectTask,
  onOpenTaskContextMenu,
}: {
  summary: TaskTypeOverviewSummary;
  onSelectTask: (task: Task) => void;
  onOpenTaskContextMenu: (event: MouseEvent, task: Task) => void;
}) {
  const presentation = getTaskTypePresentation(summary.taskType);
  const remainingLabel =
    summary.remainingToCompleteCount === null
      ? '不限额'
      : `待完成 ${summary.remainingToCompleteCount}`;

  return (
    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-950/40 px-4 py-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${presentation.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
            {presentation.label}
          </span>
        </div>
        <span className="rounded-full bg-white dark:bg-stone-900 px-2.5 py-1 text-[11px] font-medium text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-800">
          {remainingLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <OverviewMetric label="待处理" value={summary.waitingTasks.length} tone="stone" />
        <OverviewMetric label="处理中" value={summary.processingTasks.length} tone="amber" />
        <OverviewMetric label="已提交轮次" value={summary.submittedSessionCount} tone="emerald" />
        <OverviewMetric label="异常" value={summary.errorTasks.length} tone="red" />
      </div>

      <div className="space-y-3">
        <TaskGroupPreview
          label="处理中"
          tasks={summary.processingTasks}
          emptyText="当前没有执行中的题卡"
          onSelectTask={onSelectTask}
          onOpenTaskContextMenu={onOpenTaskContextMenu}
          tone="amber"
        />
        <TaskGroupPreview
          label="待处理"
          tasks={summary.waitingTasks}
          emptyText={summary.remainingToCompleteCount === 0 ? '这个分类已经完成' : '这个分类还没开始'}
          onSelectTask={onSelectTask}
          onOpenTaskContextMenu={onOpenTaskContextMenu}
          tone="stone"
        />
      </div>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'stone' | 'amber' | 'emerald' | 'red';
}) {
  const toneMap = {
    stone: 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400',
    amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    red: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
  } as const;

  return (
    <div className={`rounded-2xl px-3 py-2 ${toneMap[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TaskGroupPreview({
  label,
  tasks,
  emptyText,
  onSelectTask,
  onOpenTaskContextMenu,
  tone,
}: {
  label: string;
  tasks: Task[];
  emptyText: string;
  onSelectTask: (task: Task) => void;
  onOpenTaskContextMenu: (event: MouseEvent, task: Task) => void;
  tone: 'stone' | 'amber';
}) {
  const toneMap = {
    stone: 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700',
    amber:
      'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20',
  } as const;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
          {label}
        </span>
        <span className="text-[11px] text-stone-400 dark:text-stone-500 tabular-nums">
          {tasks.length}
        </span>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 px-3 py-2 text-xs text-stone-400 dark:text-stone-500">
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tasks.slice(0, 4).map((task) => (
            <button
              key={task.id}
              onClick={() => onSelectTask(task)}
              onContextMenu={(event) => onOpenTaskContextMenu(event, task)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:opacity-90 cursor-default ${toneMap[tone]}`}
            >
              {buildTaskDisplayCode(task)}
            </button>
          ))}
          {tasks.length > 4 && (
            <span className="rounded-full border border-stone-200 dark:border-stone-700 px-2.5 py-1 text-[11px] text-stone-400 dark:text-stone-500">
              +{tasks.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
