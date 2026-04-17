import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';
import { useAppStore } from '../../store';
import {
  listTasks,
  listModelRuns,
  listAiReviewRounds,
  updateTaskType,
  updateTaskReportFields,
  updateTaskSessionList,
  type TaskFromDB,
  type ModelRunFromDB,
  type AiReviewRoundFromDB,
  type TaskSession,
} from '../../api/task';
import ReportTable from './components/ReportTable';
import { assembleReportRows } from './utils';
import { REPORT_TYPE_OPTIONS, type ReportRow } from './types';

export default function Report() {
  const activeProject = useAppStore((s) => s.activeProject);
  const [reportType, setReportType] = useState('solo');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tasksRef = useRef<TaskFromDB[]>([]);
  const modelRunsRef = useRef<Map<string, ModelRunFromDB[]>>(new Map());

  const loadData = useCallback(async () => {
    if (!activeProject?.id) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const tasks = await listTasks(activeProject.id);
      tasksRef.current = tasks;

      // Load model runs and AI review rounds in parallel per task
      const perTaskData = await Promise.allSettled(
        tasks.map(async (t) => {
          const [runs, rounds] = await Promise.all([
            listModelRuns(t.id).catch(() => [] as ModelRunFromDB[]),
            listAiReviewRounds(t.id).catch(() => [] as AiReviewRoundFromDB[]),
          ]);
          return { taskId: t.id, runs, rounds };
        }),
      );

      const runsMap = new Map<string, ModelRunFromDB[]>();
      const roundsMap = new Map<string, AiReviewRoundFromDB[]>();
      for (const entry of perTaskData) {
        if (entry.status === 'fulfilled') {
          runsMap.set(entry.value.taskId, entry.value.runs);
          roundsMap.set(entry.value.taskId, entry.value.rounds);
        }
      }
      modelRunsRef.current = runsMap;

      setRows(assembleReportRows(tasks, runsMap, roundsMap));
    } catch (err) {
      console.error('Failed to load report data:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [activeProject?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateLocalRows = useCallback((updater: (prev: ReportRow[]) => ReportRow[]) => {
    setRows(updater);
  }, []);

  const handleTaskTypeChange = useCallback(
    async (taskId: string, value: string) => {
      updateLocalRows((prev) =>
        prev.map((r) => (r.taskId === taskId ? { ...r, taskType: value } : r)),
      );
      try {
        await updateTaskType(taskId, value);
      } catch (err) {
        console.error('Failed to update task type:', err);
      }
    },
    [updateLocalRows],
  );

  const handleReportFieldsChange = useCallback(
    async (taskId: string, projectType: string, changeScope: string) => {
      updateLocalRows((prev) =>
        prev.map((r) =>
          r.taskId === taskId ? { ...r, projectType, changeScope } : r,
        ),
      );
      try {
        await updateTaskReportFields({ id: taskId, projectType, changeScope });
      } catch (err) {
        console.error('Failed to update report fields:', err);
      }
    },
    [updateLocalRows],
  );

  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleSessionFieldChange = useCallback(
    (
      taskId: string,
      sessionIndex: number,
      patch: {
        isCompleted?: boolean | null;
        isSatisfied?: boolean | null;
        evaluation?: string;
      },
    ) => {
      updateLocalRows((prev) =>
        prev.map((r) =>
          r.taskId === taskId && r.sessionIndex === sessionIndex
            ? {
                ...r,
                isCompleted: patch.isCompleted !== undefined ? patch.isCompleted : r.isCompleted,
                isSatisfied: patch.isSatisfied !== undefined ? patch.isSatisfied : r.isSatisfied,
                dissatisfactionReason:
                  patch.evaluation !== undefined ? patch.evaluation : r.dissatisfactionReason,
              }
            : r,
        ),
      );

      const key = `${taskId}:${sessionIndex}`;
      const existing = debounceTimers.current.get(key);
      if (existing) clearTimeout(existing);

      debounceTimers.current.set(
        key,
        setTimeout(async () => {
          debounceTimers.current.delete(key);
          try {
            const task = tasksRef.current.find((t) => t.id === taskId);
            if (!task) return;

            // Determine whether to update model-run-level or task-level session list
            const modelRuns = modelRunsRef.current.get(taskId) ?? [];
            const execRun = modelRuns.find(
              (r) => r.modelName.trim().toUpperCase() !== 'ORIGIN' && (r.sessionList?.length ?? 0) > 0,
            );

            if (execRun) {
              // Update model-run-level session list
              const sessionList: TaskSession[] = (execRun.sessionList ?? []).map(
                (s, idx) => {
                  const matchingRow = rows.find(
                    (r) => r.taskId === taskId && r.sessionIndex === idx,
                  );
                  if (!matchingRow) return s;
                  return {
                    ...s,
                    isCompleted: matchingRow.isCompleted,
                    isSatisfied: matchingRow.isSatisfied,
                    evaluation: matchingRow.dissatisfactionReason,
                  };
                },
              );
              await updateTaskSessionList({ id: taskId, modelRunId: execRun.id, sessionList });
            } else {
              // Fall back to task-level session list
              const sessionList: TaskSession[] = (task.sessionList ?? []).map(
                (s, idx) => {
                  const matchingRow = rows.find(
                    (r) => r.taskId === taskId && r.sessionIndex === idx,
                  );
                  if (!matchingRow) return s;
                  return {
                    ...s,
                    isCompleted: matchingRow.isCompleted,
                    isSatisfied: matchingRow.isSatisfied,
                    evaluation: matchingRow.dissatisfactionReason,
                  };
                },
              );
              await updateTaskSessionList({ id: taskId, sessionList });
            }
          } catch (err) {
            console.error('Failed to update session:', err);
          }
        }, 600),
      );
    },
    [updateLocalRows, rows],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-6 py-4 border-b border-stone-200 dark:border-[#232834] shrink-0">
        <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-100">
          报表
        </h1>
        <div className="relative">
          <select
            className="appearance-none bg-stone-100 dark:bg-[#1A1F29] border border-stone-200 dark:border-[#232834] rounded-lg px-3 py-1.5 pr-7 text-sm text-stone-700 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
          >
            {REPORT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" />
        </div>
        {activeProject && (
          <span className="text-xs text-stone-400 dark:text-stone-500">
            {activeProject.name}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
          <span className="ml-2 text-sm text-stone-400">加载中...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm text-red-500">{error}</span>
        </div>
      ) : (
        <ReportTable
          rows={rows}
          onTaskTypeChange={handleTaskTypeChange}
          onReportFieldsChange={handleReportFieldsChange}
          onSessionFieldChange={handleSessionFieldChange}
        />
      )}
    </div>
  );
}
