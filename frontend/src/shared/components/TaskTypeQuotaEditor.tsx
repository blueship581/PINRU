import { ListChecks, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  DEFAULT_TASK_TYPE,
  dedupeTaskTypes,
  getTaskTypeDisplayLabel,
  normalizeTaskTypeName,
  type QuotaPreset,
  type TaskTypeQuotas,
} from '../lib/taskTypes';

type TaskTypeQuotaEditorProps = {
  taskTypes: string[];
  quotas: TaskTypeQuotas;
  totals: TaskTypeQuotas;
  onTaskTypesChange: (taskTypes: string[]) => void;
  onQuotasChange?: (quotas: TaskTypeQuotas) => void;
  onTotalsChange: (totals: TaskTypeQuotas) => void;
  presets?: QuotaPreset[];
  addButtonLabel?: string;
  emptyStateText?: string;
  quotaFieldLabel?: string;
  quotaFieldReadOnly?: boolean;
};

export default function TaskTypeQuotaEditor({
  taskTypes,
  quotas,
  totals,
  onTaskTypesChange,
  onQuotasChange,
  onTotalsChange,
  presets,
  addButtonLabel = '添加任务类型',
  emptyStateText = '暂未配置任务类型，添加后才能给题卡分配类型。',
  quotaFieldLabel = '单题上限',
  quotaFieldReadOnly = false,
}: TaskTypeQuotaEditorProps) {
  const [addingTaskType, setAddingTaskType] = useState(false);
  const [newTaskTypeName, setNewTaskTypeName] = useState('');
  const [addError, setAddError] = useState('');

  const normalizedTaskTypes = useMemo(() => dedupeTaskTypes(taskTypes), [taskTypes]);

  const handleAddTaskType = () => {
    const nextTaskType = normalizeTaskTypeName(newTaskTypeName);
    if (!nextTaskType) {
      setAddError('任务类型不能为空');
      return;
    }
    if (normalizedTaskTypes.some((taskType) => taskType.toLowerCase() === nextTaskType.toLowerCase())) {
      setAddError('任务类型已存在');
      return;
    }

    onTaskTypesChange([...normalizedTaskTypes, nextTaskType]);
    setNewTaskTypeName('');
    setAddingTaskType(false);
    setAddError('');
  };

  const handleRemoveTaskType = (taskType: string) => {
    const normalizedType = normalizeTaskTypeName(taskType);
    const nextTaskTypes = normalizedTaskTypes.filter((currentTaskType) => currentTaskType !== normalizedType);
    const nextQuotas = { ...quotas };
    const nextTotals = { ...totals };
    delete nextQuotas[normalizedType];
    delete nextTotals[normalizedType];

    onTaskTypesChange(nextTaskTypes);
    onQuotasChange?.(nextQuotas);
    onTotalsChange(nextTotals);
  };

  const handleQuotaChange = (taskType: string, rawValue: string) => {
    const normalizedType = normalizeTaskTypeName(taskType);
    const nextQuotas = { ...quotas };

    if (!rawValue.trim()) {
      delete nextQuotas[normalizedType];
      onQuotasChange?.(nextQuotas);
      return;
    }

    nextQuotas[normalizedType] = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    onQuotasChange?.(nextQuotas);
  };

  const handleTotalChange = (taskType: string, rawValue: string) => {
    const normalizedType = normalizeTaskTypeName(taskType);
    const nextTotals = { ...totals };

    if (!rawValue.trim()) {
      delete nextTotals[normalizedType];
      onTotalsChange(nextTotals);
      return;
    }

    nextTotals[normalizedType] = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    onTotalsChange(nextTotals);
  };

  const handleApplyPreset = (preset: QuotaPreset) => {
    onTaskTypesChange(dedupeTaskTypes([DEFAULT_TASK_TYPE, ...preset.taskTypes]));
    onTotalsChange({ ...preset.totals });
  };

  const inputCls =
    'w-full rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-sm font-medium transition-shadow placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-slate-400/30 dark:border-[#232834] dark:bg-[#171B22] dark:placeholder:text-stone-600';

  return (
    <div className="space-y-2.5">
      {presets && presets.length > 0 && (
        <div className="space-y-1.5">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleApplyPreset(preset)}
              className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-stone-300 bg-stone-50/80 px-3.5 py-2.5 text-left transition-colors hover:border-stone-400 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800/30 dark:hover:border-stone-500 dark:hover:bg-stone-800/60"
            >
              <ListChecks className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                  {preset.label}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-stone-400 dark:text-stone-500">
                  {preset.description}
                </p>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                应用预设
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_80px_80px_28px] gap-2 px-1 text-[11px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        <span>任务类型</span>
        <span>任务总量</span>
        <span>{quotaFieldLabel}</span>
        <span />
      </div>

      {normalizedTaskTypes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-400 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-500">
          {emptyStateText}
        </div>
      ) : (
        normalizedTaskTypes.map((taskType) => (
          <div
            key={taskType}
            className="grid grid-cols-[minmax(0,1fr)_80px_80px_28px] items-center gap-2 rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-800/40"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-700 dark:text-stone-300">
                {getTaskTypeDisplayLabel(taskType)}
              </p>
            </div>
            <input
              type="number"
              min={0}
              value={totals[taskType] ?? ''}
              onChange={(event) => handleTotalChange(taskType, event.target.value)}
              placeholder="不限"
              className={inputCls}
            />
            <input
              type="number"
              min={0}
              value={quotas[taskType] ?? ''}
              onChange={
                quotaFieldReadOnly ? undefined : (event) => handleQuotaChange(taskType, event.target.value)
              }
              placeholder="不限"
              readOnly={quotaFieldReadOnly}
              aria-readonly={quotaFieldReadOnly}
              className={`${inputCls} ${quotaFieldReadOnly ? 'text-stone-500 dark:text-stone-400' : ''}`}
            />
            <button
              onClick={() => handleRemoveTaskType(taskType)}
              className="flex h-7 w-7 items-center justify-center rounded-xl text-stone-400 transition-colors hover:bg-stone-200 hover:text-red-500 dark:hover:bg-stone-700"
              aria-label={`删除 ${taskType}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))
      )}

      {addingTaskType ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/40">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTaskTypeName}
              onChange={(event) => {
                setNewTaskTypeName(event.target.value);
                if (addError) setAddError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAddTaskType();
                if (event.key === 'Escape') {
                  setAddingTaskType(false);
                  setNewTaskTypeName('');
                  setAddError('');
                }
              }}
              placeholder="例如：安全加固 / 文档补全"
              autoFocus
              className="flex-1 rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium transition-shadow placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-slate-400/30 dark:border-[#232834] dark:bg-[#171B22] dark:placeholder:text-stone-600"
            />
            <button
              onClick={handleAddTaskType}
              className="rounded-full bg-[#111827] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:text-[#0D1117] dark:hover:bg-[#F3F6FB]"
            >
              确认
            </button>
            <button
              onClick={() => {
                setAddingTaskType(false);
                setNewTaskTypeName('');
                setAddError('');
              }}
              className="rounded-xl px-3 py-2 text-sm text-stone-500 transition-colors hover:text-stone-700 dark:hover:text-stone-300"
            >
              取消
            </button>
          </div>
          {addError && <p className="mt-2 text-xs text-red-500">{addError}</p>}
        </div>
      ) : (
        <button
          onClick={() => setAddingTaskType(true)}
          className="flex items-center gap-2 px-1 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          <Plus className="h-4 w-4" />
          {addButtonLabel}
        </button>
      )}
    </div>
  );
}
