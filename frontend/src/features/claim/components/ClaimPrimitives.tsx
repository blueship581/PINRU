import { useEffect, useState, type FC } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
  getModelStatusBarClassName,
  getModelStatusClassName,
  getModelStatusLabel,
  getResultStatusMeta,
} from '../utils/claimUtils';
import type { ClaimResult, ModelEntry } from '../types';

export const DoneSummary: FC<{ results: ClaimResult[] }> = ({ results }) => {
  const doneCount = results.filter(
    (r) => r.status === 'done' || r.status === 'partial',
  ).length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const skippedCount = results.filter((r) => r.status === 'quota_exceeded').length;
  const allSuccess = errorCount === 0 && skippedCount === 0;
  const hasIssue = errorCount > 0 || skippedCount > 0;

  const lines: string[] = [];
  if (doneCount > 0) lines.push(`${doneCount} 套已创建`);
  if (errorCount > 0) lines.push(`${errorCount} 套失败`);
  if (skippedCount > 0) lines.push(`${skippedCount} 套配额不足已跳过`);

  const title = allSuccess ? '全部完成' : errorCount > 0 ? '部分完成' : '执行完成';

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl p-6 text-center">
      <div
        className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 ${
          allSuccess
            ? 'bg-emerald-100 dark:bg-emerald-500/15'
            : 'bg-amber-100 dark:bg-amber-500/15'
        }`}
      >
        {allSuccess ? (
          <Check className="w-7 h-7 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
        ) : (
          <span className="text-xl font-bold text-amber-600 dark:text-amber-400">!</span>
        )}
      </div>
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50 mb-1.5 tracking-tight">
        {title}
      </h2>
      <p className="text-sm text-stone-500 dark:text-stone-400">{lines.join('，')}</p>
    </div>
  );
};

export const RunningRow: FC<{
  result: ClaimResult;
  selectedModels: ModelEntry[];
}> = ({ result, selectedModels }) => {
  const meta = getResultStatusMeta(result.status);
  const isRunning = result.status === 'running';
  const [expanded, setExpanded] = useState(isRunning);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  return (
    <div className="rounded-2xl border border-stone-100 dark:border-stone-700/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/30 transition-colors cursor-default"
      >
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 flex-shrink-0" />
        ) : expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        )}
        <span className="font-mono text-xs text-stone-400 tabular-nums">{result.displayProjectId}</span>
        <span className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate flex-1">
          {result.projectName}
        </span>
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider flex-shrink-0 ${meta.className}`}
        >
          {meta.label}
        </span>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3 pt-0 space-y-1.5 border-t border-stone-100 dark:border-stone-800">
          {selectedModels.map((model) => {
            const status = result.modelStatuses.get(model.id) ?? 'pending';
            return (
              <div key={model.id} className="flex items-center gap-2 py-0.5">
                <div className="h-1 flex-1 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getModelStatusBarClassName(
                      status,
                    )}`}
                  />
                </div>
                <span className="font-mono text-[11px] text-stone-400 w-20 text-right truncate">
                  {model.id}
                </span>
                <span
                  className={`text-[11px] w-20 text-right ${getModelStatusClassName(status)}`}
                >
                  {getModelStatusLabel(status)}
                </span>
              </div>
            );
          })}
          {result.status !== 'pending' && result.status !== 'running' && (
            <p className="text-xs text-stone-500 dark:text-stone-400 pt-1">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
};
