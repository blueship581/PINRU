import { Fragment, type MouseEvent } from 'react';
import {
  AlignJustify,
  Grid2X2,
  LayoutGrid,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import TaskGroupSection from '../../../shared/components/TaskGroupSection';
import TaskTypeOverviewBar from '../../../shared/components/TaskTypeOverviewBar';
import type { Task, TaskStatus, TaskType } from '../../../store';
import { getTaskTypePresentation } from '../../../api/config';
import type { TaskTypeOverviewSummary } from '../../../shared/lib/taskTypeOverview';
import { type CardSize, STATUS, TaskCard } from './BoardPresentation';
import type { BoardSortOption } from '../utils/boardTaskView';

const CARD_SIZE_OPTIONS: Array<{
  size: CardSize;
  icon: typeof AlignJustify;
  title: string;
}> = [
  { size: 'sm', icon: AlignJustify, title: '紧凑' },
  { size: 'md', icon: Grid2X2, title: '标准' },
  { size: 'lg', icon: LayoutGrid, title: '宽松' },
];

export function BoardMainContent({
  search,
  sortBy,
  totalTaskCount,
  availableTaskTypes,
  activeTypes,
  activeStages,
  activeRounds,
  cardSize,
  hasFilters,
  availableExecutionRounds,
  tasks,
  sortedTasks,
  groupedTasks,
  visibleProjectTaskSummaries,
  gridClass,
  collapsedGroups,
  onSearchChange,
  onClearSearch,
  onSortChange,
  onCardSizeChange,
  onOpenProjectPanel,
  onOpenProjectOverview,
  onToggleType,
  onToggleStage,
  onToggleRound,
  onClearFilters,
  onToggleGroupCollapse,
  onSelectTask,
  onOpenTaskContextMenu,
  onDeleteTask,
}: {
  search: string;
  sortBy: BoardSortOption;
  totalTaskCount: number;
  availableTaskTypes: string[];
  activeTypes: Set<TaskType>;
  activeStages: Set<TaskStatus>;
  activeRounds: Set<number>;
  cardSize: CardSize;
  hasFilters: boolean;
  availableExecutionRounds: number[];
  tasks: Task[];
  sortedTasks: Task[];
  groupedTasks: Array<{ taskType: string; tasks: Task[] }>;
  visibleProjectTaskSummaries: TaskTypeOverviewSummary[];
  gridClass: string;
  collapsedGroups: Set<string>;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onSortChange: (value: BoardSortOption) => void;
  onCardSizeChange: (value: CardSize) => void;
  onOpenProjectPanel: () => void;
  onOpenProjectOverview: () => void;
  onToggleType: (taskType: TaskType) => void;
  onToggleStage: (status: TaskStatus) => void;
  onToggleRound: (round: number) => void;
  onClearFilters: () => void;
  onToggleGroupCollapse: (taskType: string) => void;
  onSelectTask: (task: Task) => void;
  onOpenTaskContextMenu: (event: MouseEvent, task: Task) => void;
  onDeleteTask: (task: Task) => void;
}) {
  return (
    <>
      <div className="sticky top-0 z-10 bg-stone-50 dark:bg-[#161615] px-8 pt-6 pb-4 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="搜索项目名称或 ID…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-full pl-10 pr-8 py-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400 dark:placeholder:text-stone-600"
            />
            {search && (
              <button
                onClick={onClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-default"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-3">
            <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400">
              排序
            </span>
            <select
              value={sortBy}
              onChange={(event) => onSortChange(event.target.value as BoardSortOption)}
              className="bg-transparent py-2 text-sm font-medium text-stone-600 dark:text-stone-300 outline-none cursor-default"
            >
              <option value="created-desc">最新创建</option>
              <option value="created-asc">最早创建</option>
              <option value="round-desc">轮次从高到低</option>
              <option value="round-asc">轮次从低到高</option>
            </select>
          </div>

          <span className="text-sm text-stone-400 dark:text-stone-500 font-medium tabular-nums">
            {sortedTasks.length} / {totalTaskCount}
          </span>

          <div className="flex items-center gap-0.5 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl p-1">
            {CARD_SIZE_OPTIONS.map(({ size, icon: Icon, title }) => (
              <button
                key={size}
                title={title}
                onClick={() => onCardSizeChange(size)}
                className={`p-2 rounded-xl transition-all cursor-default ${
                  cardSize === size
                    ? 'bg-[#111827] dark:bg-[#E5EAF2] text-white dark:text-[#0D1117] shadow-sm'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800'
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>

          <button
            onClick={onOpenProjectPanel}
            className="p-2 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors cursor-default"
            title="项目配置"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenProjectOverview}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors shadow-sm cursor-default"
          >
            <LayoutGrid className="w-4 h-4" />
            查看项目概况
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 w-14 flex-shrink-0">
            类型
          </span>
          {availableTaskTypes.map((taskType) => {
            const presentation = getTaskTypePresentation(taskType);
            const active = activeTypes.has(presentation.value);
            return (
              <button
                key={presentation.value}
                onClick={() => onToggleType(presentation.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-default ${
                  active
                    ? `${presentation.badge} shadow-sm scale-[1.02]`
                    : 'bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    active ? presentation.dot : 'bg-stone-300 dark:bg-stone-600'
                  }`}
                />
                {presentation.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 w-14 flex-shrink-0">
            阶段
          </span>
          {(['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error'] as TaskStatus[]).map((status) => {
            const cfg = STATUS[status];
            const count = tasks.filter((task) => task.status === status).length;
            const active = activeStages.has(status);
            return (
              <button
                key={status}
                onClick={() => onToggleStage(status)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-default ${
                  active
                    ? `${cfg.badgeCls} shadow-sm scale-[1.02]`
                    : 'bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    active ? cfg.dotCls : 'bg-stone-300 dark:bg-stone-600'
                  }`}
                />
                {cfg.label}
                <span
                  className={`tabular-nums font-bold ${
                    active ? 'opacity-75' : 'text-stone-400 dark:text-stone-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
          {hasFilters && (
            <button
              onClick={onClearFilters}
              className="ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-all cursor-default"
            >
              <X className="w-3 h-3" />
              清除
            </button>
          )}
        </div>

        {availableExecutionRounds.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 w-14 flex-shrink-0">
              轮次
            </span>
            {availableExecutionRounds.map((round) => {
              const count = tasks.filter((task) => task.executionRounds === round).length;
              const active = activeRounds.has(round);

              return (
                <button
                  key={round}
                  onClick={() => onToggleRound(round)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-default ${
                    active
                      ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/20 shadow-sm scale-[1.02]'
                      : 'bg-white dark:bg-stone-900 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  第 {round} 轮
                  <span
                    className={`tabular-nums font-bold ${
                      active ? 'opacity-75' : 'text-stone-400 dark:text-stone-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {visibleProjectTaskSummaries.length > 0 && (
        <TaskTypeOverviewBar summaries={visibleProjectTaskSummaries} />
      )}

      <div className="flex-1 overflow-y-auto px-8 py-5">
        {sortedTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center mb-4">
              <Search className="w-5 h-5 text-stone-300 dark:text-stone-600" />
            </div>
            <p className="text-sm font-semibold text-stone-500 dark:text-stone-400 mb-1">
              没有匹配的任务
            </p>
            <p className="text-xs text-stone-400 dark:text-stone-500">试试调整筛选条件</p>
            {hasFilters && (
              <button
                onClick={onClearFilters}
                className="mt-4 px-4 py-2 text-xs font-semibold text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl transition-colors cursor-default"
              >
                清除所有筛选
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {groupedTasks.map(({ taskType, tasks: tasksInGroup }) => {
              const hideHeader = activeTypes.size > 0 && groupedTasks.length === 1;

              return (
                <Fragment key={taskType}>
                  <TaskGroupSection
                    taskType={taskType}
                    tasks={tasksInGroup}
                    isCollapsed={hideHeader ? false : collapsedGroups.has(taskType)}
                    onToggleCollapse={() => onToggleGroupCollapse(taskType)}
                    gridClass={gridClass}
                    hideHeader={hideHeader}
                    renderTaskCard={(task) => (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.15 }}
                      >
                        <TaskCard
                          task={task}
                          size={cardSize}
                          onClick={() => onSelectTask(task)}
                          onContextMenu={(event) => onOpenTaskContextMenu(event, task)}
                          onDelete={() => onDeleteTask(task)}
                        />
                      </motion.div>
                    )}
                  />
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export function DeleteTaskDialog({
  task,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  task: Task;
  deleting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => {
          if (deleting) return;
          onCancel();
        }}
        className="fixed inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
      >
        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
          <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">确认删除题卡</h2>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
            将删除「{task.projectName}」的题卡、关联模型记录，以及本地对比目录中的文件。此操作不可撤销。
          </p>
          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => {
                if (deleting) return;
                onCancel();
              }}
              className="px-4 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-700 dark:text-stone-300 cursor-default"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="px-4 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 cursor-default"
            >
              {deleting ? '删除中...' : '确认删除'}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
