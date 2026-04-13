import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  Check,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { Events } from '@wailsio/runtime';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '../../store';
import { retryJob, cancelJob, type JobProgressEvent } from '../../api/job';

const JOB_TYPE_LABELS: Record<string, string> = {
  prompt_generate: '提示词生成',
  session_sync: 'Session 同步',
  git_clone: '拉取代码',
  pr_submit: 'PR 提交',
  ai_review: 'AI 复审',
};

const STATUS_CONFIG: Record<string, {
  label: string;
  color: string;
  icon: typeof Check;
}> = {
  pending: { label: '排队中', color: 'text-zinc-400', icon: Loader2 },
  running: { label: '执行中', color: 'text-amber-400', icon: Loader2 },
  done: { label: '已完成', color: 'text-emerald-400', icon: Check },
  error: { label: '失败', color: 'text-red-400', icon: AlertCircle },
  cancelled: { label: '已取消', color: 'text-zinc-500', icon: XCircle },
};

export default function BackgroundJobPanel() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const backgroundJobs = useAppStore((s) => s.backgroundJobs);
  const loadBackgroundJobs = useAppStore((s) => s.loadBackgroundJobs);
  const updateBackgroundJob = useAppStore((s) => s.updateBackgroundJob);
  const tasks = useAppStore((s) => s.tasks);
  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]));

  useEffect(() => {
    void loadBackgroundJobs();
  }, [loadBackgroundJobs]);

  useEffect(() => {
    const cancel = Events.On('job:progress', (event: { data: JobProgressEvent }) => {
      const data = event.data;
      updateBackgroundJob({
        id: data.id,
        jobType: data.jobType,
        taskId: data.taskId,
        status: data.status as 'pending' | 'running' | 'done' | 'error' | 'cancelled',
        progress: data.progress,
        progressMessage: data.progressMessage,
        errorMessage: data.errorMessage,
      });
      if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
        void loadBackgroundJobs();
      }
    });
    return () => { cancel(); };
  }, [loadBackgroundJobs, updateBackgroundJob]);

  useEffect(() => {
    if (!open) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const activeCount = backgroundJobs.filter(
    (j) => j.status === 'running' || j.status === 'pending',
  ).length;
  const visibleJobs = backgroundJobs.slice(0, 7);

  const handleRetry = async (id: string) => {
    try {
      await retryJob(id);
      await loadBackgroundJobs();
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelJob(id);
      await loadBackgroundJobs();
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div ref={containerRef} className="fixed bottom-4 right-4 z-50">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-14 right-0 w-[380px] max-h-[480px] overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-900/95 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/70 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">后台任务</h3>
                <p className="mt-0.5 text-[10px] text-zinc-500">仅保留最近 7 条</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {visibleJobs.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-zinc-500">
                  暂无后台任务
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {visibleJobs.map((job) => {
                    const config = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
                    const Icon = config.icon;
                    const isRunning = job.status === 'running' || job.status === 'pending';

                    const taskName = job.taskId ? taskMap[job.taskId]?.projectName : null;

                    return (
                      <div key={job.id} className="px-4 py-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${config.color} ${isRunning ? 'animate-spin' : ''}`} />
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-zinc-200 truncate">
                                  {JOB_TYPE_LABELS[job.jobType] ?? job.jobType}
                                </span>
                                <span className={`text-[10px] font-medium ${config.color} flex-shrink-0`}>
                                  {config.label}
                                </span>
                              </div>
                              {taskName && (
                                <span className="text-[10px] text-zinc-500 truncate">{taskName}</span>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] text-zinc-500 flex-shrink-0">
                            {formatTime(job.startedAt ?? job.createdAt)}
                          </span>
                        </div>

                        {isRunning && (
                          <div className="space-y-1">
                            <div className="h-1.5 w-full rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                                style={{ width: `${Math.max(job.progress, 5)}%` }}
                              />
                            </div>
                            {job.progressMessage && (
                              <p className="text-[10px] text-zinc-500">{job.progressMessage}</p>
                            )}
                          </div>
                        )}

                        {job.status === 'error' && job.errorMessage && (
                          <p className="text-[10px] text-red-400 line-clamp-2">{job.errorMessage}</p>
                        )}

                        <div className="flex gap-2">
                          {job.status === 'error' && job.retryCount < job.maxRetries && (
                            <button
                              type="button"
                              onClick={() => void handleRetry(job.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/70 bg-zinc-800 px-2.5 py-1 text-[10px] font-medium text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                            >
                              <RefreshCw className="h-3 w-3" />
                              重试
                            </button>
                          )}
                          {isRunning && (
                            <button
                              type="button"
                              onClick={() => void handleCancel(job.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700/70 bg-zinc-800 px-2.5 py-1 text-[10px] font-medium text-zinc-400 hover:border-red-500/40 hover:text-red-400"
                            >
                              <XCircle className="h-3 w-3" />
                              取消
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="查看后台任务"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700/70 bg-zinc-900/90 shadow-lg backdrop-blur-sm transition hover:border-zinc-600 hover:bg-zinc-800"
      >
        <Activity className="h-4.5 w-4.5 text-zinc-400" />
        {activeCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[9px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>
    </div>
  );
}
