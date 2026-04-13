import { useState } from 'react';
import { CheckSquare, ChevronDown, X } from 'lucide-react';
import { batchUpdateTasks } from '../../../api/task';
import type { TaskStatus } from '../../../store';

const STATUS_OPTIONS: TaskStatus[] = [
  'Claimed',
  'Downloaded',
  'PromptReady',
  'ExecutionCompleted',
  'Submitted',
  'Error',
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  Claimed: '已领题',
  Downloading: '下载中',
  Downloaded: '已下载',
  PromptReady: '提示词就绪',
  ExecutionCompleted: '执行完成',
  Submitted: '已提交',
  Error: '错误',
};

export function BatchActionBar({
  selectedCount,
  selectedTaskIds,
  availableTaskTypes,
  onAfterApply,
  onDone,
  onCancel,
}: {
  selectedCount: number;
  selectedTaskIds: Set<string>;
  availableTaskTypes: string[];
  onAfterApply?: (
    field: 'status' | 'taskType',
    value: string,
    taskIds: string[],
  ) => void | Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');

  const apply = async (field: 'status' | 'taskType', value: string) => {
    setStatusOpen(false);
    setTypeOpen(false);
    if (loading) return;
    setLoading(true);
    setResultMsg('');
    const taskIds = Array.from(selectedTaskIds);
    try {
      const result = await batchUpdateTasks({
        taskIds,
        field,
        value,
      });
      if (result.failed.length > 0) {
        setResultMsg(`${result.succeeded} 成功，${result.failed.length} 失败`);
      } else {
        await onAfterApply?.(field, value, taskIds);
        setResultMsg(`${result.succeeded} 个已更新`);
        setTimeout(() => { onDone(); }, 800);
      }
    } catch (err) {
      setResultMsg(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl shadow-lg px-4 py-2.5">
      <CheckSquare className="w-4 h-4 text-indigo-500 flex-shrink-0" />
      <span className="text-sm font-semibold text-stone-700 dark:text-stone-300 mr-1">
        已选 {selectedCount} 项
      </span>

      {/* Status dropdown */}
      <div className="relative">
        <button
          onClick={() => { setStatusOpen((v) => !v); setTypeOpen(false); }}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors cursor-default disabled:opacity-50"
        >
          更新状态 <ChevronDown className="w-3 h-3" />
        </button>
        {statusOpen && (
          <div className="absolute bottom-full mb-2 left-0 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-lg py-1 min-w-[120px]">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void apply('status', s)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 cursor-default"
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Task type dropdown */}
      {availableTaskTypes.length > 0 && (
        <div className="relative">
          <button
            onClick={() => { setTypeOpen((v) => !v); setStatusOpen(false); }}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors cursor-default disabled:opacity-50"
          >
            更新类型 <ChevronDown className="w-3 h-3" />
          </button>
          {typeOpen && (
            <div className="absolute bottom-full mb-2 left-0 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-lg py-1 min-w-[120px]">
              {availableTaskTypes.map((t) => (
                <button
                  key={t}
                  onClick={() => void apply('taskType', t)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 cursor-default"
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {resultMsg && (
        <span className="text-xs text-stone-500 dark:text-stone-400">{resultMsg}</span>
      )}

      <button
        onClick={onCancel}
        className="ml-1 p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors cursor-default"
        title="取消选择 (ESC)"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
