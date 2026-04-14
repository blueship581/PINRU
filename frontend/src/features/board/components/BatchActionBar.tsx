import { useState } from 'react';
import { CheckSquare, ChevronDown, Trash2, X } from 'lucide-react';
import { batchDeleteTasks, batchUpdateTasks } from '../../../api/task';
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
  onAfterDelete,
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
  onAfterDelete?: (taskIds: string[]) => void | Promise<void>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = async () => {
    if (loading) return;
    setLoading(true);
    setResultMsg('');
    const taskIds = Array.from(selectedTaskIds);
    try {
      const result = await batchDeleteTasks(taskIds);
      if (result.failed.length > 0) {
        setResultMsg(`${result.succeeded} 成功，${result.failed.length} 失败`);
        setConfirmingDelete(false);
      } else {
        await onAfterDelete?.(taskIds);
        setResultMsg(`${result.succeeded} 个已删除`);
        setTimeout(() => { onDone(); }, 800);
      }
    } catch (err) {
      setResultMsg(err instanceof Error ? err.message : '删除失败');
      setConfirmingDelete(false);
    } finally {
      setLoading(false);
    }
  };

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

  if (confirmingDelete) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-white dark:bg-stone-900 border border-red-200 dark:border-red-800 rounded-2xl shadow-lg px-4 py-2.5">
        <Trash2 className="w-4 h-4 text-red-500 flex-shrink-0" />
        <span className="text-sm text-stone-700 dark:text-stone-300">
          确认删除 <span className="font-semibold text-red-500">{selectedCount}</span> 个题卡？
        </span>
        <button
          onClick={() => void handleDelete()}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors cursor-default disabled:opacity-50"
        >
          {loading ? '删除中…' : '确认删除'}
        </button>
        <button
          onClick={() => setConfirmingDelete(false)}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors cursor-default disabled:opacity-50"
        >
          取消
        </button>
        {resultMsg && (
          <span className="text-xs text-stone-500 dark:text-stone-400">{resultMsg}</span>
        )}
      </div>
    );
  }

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

      {/* Delete button */}
      <button
        onClick={() => setConfirmingDelete(true)}
        disabled={loading}
        className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-100 dark:bg-stone-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-default disabled:opacity-50"
      >
        <Trash2 className="w-3 h-3" />
        删除
      </button>

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
