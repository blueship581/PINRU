import { Fragment } from 'react';
import { getTaskTypePresentation } from '../lib/taskTypes';
import { type TaskTypeOverviewSummary } from '../lib/taskTypeOverview';

function TaskTypeOverviewBarCard({
  summary,
}: {
  summary: TaskTypeOverviewSummary;
}) {
  const presentation = getTaskTypePresentation(summary.taskType);
  const total = summary.totalTaskCount;
  const submitted = summary.submittedSessionCount;
  const progress = total > 0 ? Math.min((submitted / total) * 100, 100) : 0;

  return (
    <article className="min-w-[220px] flex-1 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white/90 dark:bg-stone-900/80 px-4 py-3.5 shadow-sm shadow-stone-950/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${presentation.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
            <span className="truncate">{presentation.label}</span>
          </span>
        </div>
        {summary.remainingToCompleteCount !== null && (
          <span className="shrink-0 text-[11px] font-semibold text-stone-500 dark:text-stone-400 tabular-nums">
            待完成 {summary.remainingToCompleteCount}
          </span>
        )}
      </div>

      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
          <span className="font-semibold text-stone-700 dark:text-stone-200 tabular-nums">
            已提交 {submitted} / 总计 {total}
          </span>
          <span className="text-stone-400 dark:text-stone-500 tabular-nums">
            {Math.round(progress)}%
          </span>
        </div>
      </div>
    </article>
  );
}

export default function TaskTypeOverviewBar({
  summaries,
}: {
  summaries: TaskTypeOverviewSummary[];
}) {
  return (
    <section className="px-8 pt-4">
      <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-full gap-3">
          {summaries.map((summary) => (
            <Fragment key={summary.taskType}>
              <TaskTypeOverviewBarCard summary={summary} />
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
