import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store';
import { listTasks, type TaskFromDB } from '../../api/task';
import { buildOverviewAggregates } from './utils/aggregation';
import RepoDistributionTable from './components/RepoDistributionTable';
import RepoPromptList from './components/RepoPromptList';

type TabKey = 'distribution' | 'prompt';

export default function Overview() {
  const activeProject = useAppStore((s) => s.activeProject);
  const [tasks, setTasks] = useState<TaskFromDB[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('distribution');

  useEffect(() => {
    if (!activeProject) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listTasks(activeProject.id)
      .then((list) => {
        if (!cancelled) setTasks(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  const aggregates = useMemo(() => buildOverviewAggregates(tasks), [tasks]);

  const handleTaskPromptSaved = useCallback((taskId: string, promptText: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, promptText } : t)),
    );
  }, []);

  if (!activeProject) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-12">
        <p className="rounded-2xl bg-stone-100/60 dark:bg-stone-800/30 px-4 py-6 text-sm text-stone-500">
          请先在左侧切换或创建项目。
        </p>
      </div>
    );
  }

  const { rows, taskTypes, promptGroups, totals } = aggregates;
  const promptPercent = totals.tasks === 0 ? 0 : Math.round((totals.promptsFilled / totals.tasks) * 100);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
          项目查看
        </h1>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {activeProject.name}
          <span className="mx-1.5 text-stone-300">·</span>
          {totals.repos} 个仓库
          <span className="mx-1.5 text-stone-300">·</span>
          {totals.tasks} 个任务
          <span className="mx-1.5 text-stone-300">·</span>
          {totals.taskTypes} 种类型
        </p>
      </header>

      {loading ? (
        <p className="rounded-2xl bg-stone-100/60 dark:bg-stone-800/30 px-4 py-6 text-sm text-stone-500">
          加载中…
        </p>
      ) : error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          加载失败：{error}
        </p>
      ) : totals.tasks === 0 ? (
        <p className="rounded-2xl bg-stone-100/60 dark:bg-stone-800/30 px-4 py-6 text-sm text-stone-500">
          当前项目暂无任务数据。
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <StatCard label="仓库" value={totals.repos} />
            <StatCard label="任务" value={totals.tasks} />
            <StatCard label="任务类型" value={totals.taskTypes} />
            <StatCard
              label="提示词"
              value={`${totals.promptsFilled}/${totals.tasks}`}
              hint={`${promptPercent}% 已填写`}
            />
          </section>

          <div className="border-b border-stone-200 dark:border-stone-800">
            <div className="flex items-center gap-1">
              <TabButton
                active={activeTab === 'distribution'}
                onClick={() => setActiveTab('distribution')}
                label="仓库任务分布"
                count={totals.repos}
              />
              <TabButton
                active={activeTab === 'prompt'}
                onClick={() => setActiveTab('prompt')}
                label="任务提示词"
                count={totals.tasks}
              />
            </div>
          </div>

          {activeTab === 'distribution' ? (
            <RepoDistributionTable rows={rows} taskTypes={taskTypes} />
          ) : (
            <RepoPromptList groups={promptGroups} onTaskPromptSaved={handleTaskPromptSaved} />
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#1A1A19] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">{hint}</div>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? 'text-stone-900 dark:text-stone-50'
          : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        <span
          className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums ${
            active
              ? 'bg-stone-800 text-stone-50 dark:bg-stone-100 dark:text-stone-900'
              : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
          }`}
        >
          {count}
        </span>
      </span>
      {active && (
        <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-stone-900 dark:bg-stone-100 rounded-full" />
      )}
    </button>
  );
}
