import { useEffect, useState, type FC } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, MinusCircle, XCircle } from 'lucide-react';
import {
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

  const Icon = allSuccess ? Check : errorCount > 0 ? XCircle : AlertCircle;
  const accent = allSuccess
    ? 'text-emerald-600 dark:text-emerald-400'
    : errorCount > 0
      ? 'text-red-500'
      : 'text-amber-500';
  const title = allSuccess ? '全部完成' : errorCount > 0 ? '部分失败' : '执行完成';

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <Icon className={`h-3.5 w-3.5 ${accent}`} />
      <span className={`font-semibold ${accent}`}>{title}</span>
      <span className="text-stone-300 dark:text-stone-600">·</span>
      <span className="text-stone-600 dark:text-stone-300">
        创建 <b className="font-semibold text-stone-900 dark:text-stone-100">{doneCount}</b>
      </span>
      {errorCount > 0 && (
        <>
          <span className="text-stone-300 dark:text-stone-600">·</span>
          <span className="text-red-500">失败 {errorCount}</span>
        </>
      )}
      {skippedCount > 0 && (
        <>
          <span className="text-stone-300 dark:text-stone-600">·</span>
          <span className="text-orange-500">跳过 {skippedCount}</span>
        </>
      )}
    </div>
  );
};

function statusDotClass(status: ModelEntry['status']) {
  switch (status) {
    case 'done':
      return 'bg-emerald-500';
    case 'cloning':
    case 'copying':
      return 'bg-amber-400 animate-pulse';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-stone-300 dark:bg-stone-600';
  }
}

export const RunningRow: FC<{
  result: ClaimResult;
  selectedModels: ModelEntry[];
}> = ({ result, selectedModels }) => {
  const meta = getResultStatusMeta(result.status);
  const isRunning = result.status === 'running';
  const isSkipped = result.status === 'quota_exceeded';
  const isError = result.status === 'error';
  const [expanded, setExpanded] = useState(isRunning || isError);

  useEffect(() => {
    if (isRunning || isError) setExpanded(true);
  }, [isRunning, isError]);

  const LeadingIcon = isRunning
    ? Loader2
    : isSkipped
      ? MinusCircle
      : isError
        ? XCircle
        : result.status === 'done' || result.status === 'partial'
          ? Check
          : ChevronRight;

  const leadingClass = isRunning
    ? 'h-3.5 w-3.5 animate-spin text-amber-500 flex-shrink-0'
    : isError
      ? 'h-3.5 w-3.5 text-red-500 flex-shrink-0'
      : isSkipped
        ? 'h-3.5 w-3.5 text-orange-400 flex-shrink-0'
        : result.status === 'done' || result.status === 'partial'
          ? 'h-3.5 w-3.5 text-emerald-500 flex-shrink-0'
          : 'h-3.5 w-3.5 text-stone-400 flex-shrink-0';

  const toggleExpanded = () => setExpanded((value) => !value);

  return (
    <div>
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center gap-2.5 py-1.5 text-left cursor-default"
      >
        <LeadingIcon className={leadingClass} />
        <span className="font-mono text-[11px] text-stone-400 tabular-nums flex-shrink-0">
          {result.displayProjectId}
        </span>
        <span className="flex-1 truncate text-[13px] text-stone-800 dark:text-stone-200">
          {result.projectName}
        </span>
        <div className="flex flex-shrink-0 items-center gap-1">
          {selectedModels.map((model) => {
            const status = result.modelStatuses.get(model.id) ?? 'pending';
            return (
              <span
                key={model.id}
                title={`${model.id} · ${getModelStatusLabel(status)}`}
                className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`}
              />
            );
          })}
        </div>
        <span
          className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
        >
          {meta.label}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0 text-stone-400" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-stone-400" />
        )}
      </button>

      {expanded && (
        <div className="mb-1 ml-6 space-y-1 border-l border-stone-100 pl-3 dark:border-stone-800">
          {selectedModels.map((model) => {
            const status = result.modelStatuses.get(model.id) ?? 'pending';
            return (
              <div key={model.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`}
                />
                <span className="font-mono text-stone-500 dark:text-stone-400">
                  {model.id}
                </span>
                <span className={getModelStatusClassName(status)}>
                  {getModelStatusLabel(status)}
                </span>
              </div>
            );
          })}
          {result.message && (
            <p className="pt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
              {result.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
