import { useMemo, useState } from 'react';
import type { RepoDistributionRow } from '../utils/aggregation';
import { getTaskTypeChartColor } from '../utils/chartColor';
import { getTaskTypeDisplayLabel } from '../../../shared/lib/taskTypes';

interface RepoDistributionTableProps {
  rows: RepoDistributionRow[];
  taskTypes: string[];
  pageSize?: number;
}

export default function RepoDistributionTable({
  rows,
  taskTypes,
  pageSize = 20,
}: RepoDistributionTableProps) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => rows.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [rows, safePage, pageSize],
  );

  const columnTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of rows) {
      for (const taskType of taskTypes) {
        totals[taskType] = (totals[taskType] ?? 0) + (row.taskCounts[taskType] ?? 0);
      }
    }
    return totals;
  }, [rows, taskTypes]);

  const grandTotal = rows.reduce((acc, row) => acc + row.total, 0);

  if (rows.length === 0 || taskTypes.length === 0) {
    return (
      <p className="rounded-2xl bg-stone-100/60 dark:bg-stone-800/30 px-4 py-6 text-sm text-stone-500">
        暂无分布数据。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#1A1A19] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-stone-400 bg-stone-50/60 dark:bg-stone-900/40 border-b border-stone-100 dark:border-stone-800">
                <th className="py-2.5 pl-4 pr-6 font-semibold sticky left-0 bg-stone-50/60 dark:bg-stone-900/40">
                  repoId
                </th>
                <th className="py-2.5 pr-6 font-semibold">项目名</th>
                {taskTypes.map((taskType) => (
                  <th key={taskType} className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: getTaskTypeChartColor(taskType) }}
                      />
                      {getTaskTypeDisplayLabel(taskType)}
                    </span>
                  </th>
                ))}
                <th className="py-2.5 pl-3 pr-4 font-semibold text-right">合计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {pageRows.map((row) => (
                <tr key={row.repoId} className="hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors">
                  <td
                    className="py-2.5 pl-4 pr-6 tabular-nums text-stone-500 sticky left-0 bg-white dark:bg-[#1A1A19]"
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                  >
                    {row.repoId}
                  </td>
                  <td className="py-2.5 pr-6 text-stone-800 dark:text-stone-100 font-medium">
                    {row.repoName}
                  </td>
                  {taskTypes.map((taskType) => {
                    const count = row.taskCounts[taskType] ?? 0;
                    return (
                      <td
                        key={taskType}
                        className={
                          count === 0
                            ? 'py-2.5 px-3 text-right text-stone-300 dark:text-stone-700 tabular-nums'
                            : 'py-2.5 px-3 text-right text-stone-800 dark:text-stone-100 tabular-nums'
                        }
                      >
                        {count === 0 ? '·' : count}
                      </td>
                    );
                  })}
                  <td className="py-2.5 pl-3 pr-4 text-right tabular-nums text-stone-800 dark:text-stone-100 font-semibold">
                    {row.total}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-100 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-900/40">
                <td
                  className="py-2.5 pl-4 pr-6 text-[11px] uppercase tracking-wider text-stone-500 font-semibold sticky left-0 bg-stone-50/60 dark:bg-stone-900/40"
                  colSpan={2}
                >
                  全部仓库合计
                </td>
                {taskTypes.map((taskType) => (
                  <td
                    key={taskType}
                    className="py-2.5 px-3 text-right tabular-nums text-stone-500"
                  >
                    {columnTotals[taskType] ?? 0}
                  </td>
                ))}
                <td className="py-2.5 pl-3 pr-4 text-right tabular-nums text-stone-800 dark:text-stone-100 font-semibold">
                  {grandTotal}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-stone-500">
          <span>
            第 {safePage * pageSize + 1}-{Math.min((safePage + 1) * pageSize, rows.length)} / {rows.length} 个仓库
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-xl px-3 py-1.5 text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <span className="px-2 tabular-nums text-stone-500">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded-xl px-3 py-1.5 text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
