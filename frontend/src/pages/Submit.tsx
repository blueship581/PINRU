import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Rocket, ExternalLink, Check, X, Github, AlertCircle } from 'lucide-react';
import {
  getGitHubAccounts,
  normalizeProjectModels,
  type GitHubAccountConfig,
} from '../services/config';
import { listModelRuns, type ModelRunFromDB } from '../services/task';
import { submitAll } from '../services/submit';
import { useAppStore } from '../store';
import { getPathBase } from '../lib/sourceFolders';

const selectCls =
  'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow';

export default function Submit() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tasks = useAppStore((s) => s.tasks);
  const loadTasks = useAppStore((s) => s.loadTasks);
  const activeProject = useAppStore((s) => s.activeProject);
  const loadActiveProject = useAppStore((s) => s.loadActiveProject);

  const [accounts, setAccounts] = useState<GitHubAccountConfig[]>([]);
  const [taskId, setTaskId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [modelRuns, setModelRuns] = useState<ModelRunFromDB[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

  const requestedTaskId = searchParams.get('taskId') ?? '';
  const task = tasks.find((t) => t.id === taskId) ?? null;
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const sourceModelName = useMemo(
    () => activeProject?.sourceModelFolder?.trim() || 'ORIGIN',
    [activeProject],
  );

  const projectPrModelNames = useMemo(() => {
    if (!activeProject?.models) return [];
    return normalizeProjectModels(activeProject.models).filter(
      (m) => {
        const upper = m.trim().toUpperCase();
        return upper !== 'ORIGIN' && upper !== sourceModelName.toUpperCase();
      },
    );
  }, [activeProject, sourceModelName]);

  const sourceRun = useMemo(
    () =>
      modelRuns.find((r) => r.modelName.trim().toUpperCase() === sourceModelName.toUpperCase()) ?? null,
    [modelRuns, sourceModelName],
  );
  const sourceDirectoryName = useMemo(
    () => getPathBase(sourceRun?.localPath) || sourceRun?.modelName || '',
    [sourceRun],
  );

  const repo = useMemo(() => {
    if (!task) return '';
    if (activeProject?.defaultSubmitRepo?.trim()) {
      return activeProject.defaultSubmitRepo.trim();
    }
    if (!account) return '';
    const projectName = activeProject?.name ?? task.projectName;
    return `${account.username}/${slugify(projectName)}-${taskId}`;
  }, [account, task, taskId, activeProject]);

  // Results stored in DB: origin_url from sourceRun, pr_url / submit_error from other runs
  const hasResults = useMemo(() =>
    modelRuns.some((r) => r.status === 'done' || r.status === 'error'),
  [modelRuns]);

  useEffect(() => {
    (async () => {
      await loadActiveProject();
      await loadTasks();
      const accs = await getGitHubAccounts();
      setAccounts(normalizeAccounts(accs));
    })();
  }, [loadTasks, loadActiveProject]);

  useEffect(() => {
    if (!tasks.length) {
      setTaskId('');
      return;
    }
    if (requestedTaskId && tasks.some((t) => t.id === requestedTaskId)) {
      if (taskId !== requestedTaskId) {
        setTaskId(requestedTaskId);
      }
      return;
    }
    if (!tasks.some((t) => t.id === taskId)) {
      setTaskId(tasks[0].id);
    }
  }, [requestedTaskId, taskId, tasks]);

  useEffect(() => {
    if (!taskId || requestedTaskId === taskId) return;
    const next = new URLSearchParams(searchParams);
    next.set('taskId', taskId);
    setSearchParams(next, { replace: true });
  }, [requestedTaskId, searchParams, setSearchParams, taskId]);

  useEffect(() => {
    if (!accounts.length) { setAccountId(''); return; }
    if (!accounts.some((a) => a.id === accountId)) {
      setAccountId((accounts.find((a) => a.isDefault) ?? accounts[0]).id);
    }
  }, [accounts, accountId]);

  useEffect(() => {
    if (!taskId) { setModelRuns([]); return; }
    let off = false;
    listModelRuns(taskId).then((r) => { if (!off) setModelRuns(r); });
    return () => { off = true; };
  }, [taskId]);

  useEffect(() => {
    setSelectedModels(new Set(projectPrModelNames));
  }, [projectPrModelNames]);

  const handleSubmit = async () => {
    if (!task || !account || !repo || !sourceRun) return;
    setBusy(true);
    setError('');
    try {
      await submitAll({
        taskId,
        models: [...selectedModels],
        targetRepo: repo,
        sourceModelName,
        githubUsername: account.username,
        githubToken: account.token,
      });
      // Reload results from DB
      const fresh = await listModelRuns(taskId);
      setModelRuns(fresh);
      await loadTasks();
    } catch (e) {
      setError(errStr(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = !!task && !!account && !!repo && !!sourceRun && !busy;

  return (
    <div className="h-full flex flex-col p-8 bg-stone-50 dark:bg-[#161615]">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50 tracking-tight">提交</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto space-y-5">

          {/* 任务选择 */}
          <label className="block">
            <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">任务</span>
            {!tasks.length ? (
              <button onClick={() => navigate('/claim')} className="text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors">
                暂无任务，去领题 &rarr;
              </button>
            ) : (
              <select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                disabled={busy}
                className={selectCls}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.projectName} &middot; {t.id}</option>
                ))}
              </select>
            )}
          </label>

          {/* 已有提交结果 */}
          {taskId && hasResults && (
            <ResultsPanel
              modelRuns={modelRuns}
              projectPrModelNames={projectPrModelNames}
              sourceModelName={sourceModelName}
            />
          )}

          {/* 原始代码 */}
          {taskId && (
            <div>
              <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">源码目录</span>
              {sourceRun ? (
                <div className="flex items-center gap-2 bg-stone-100 dark:bg-[#1E2128] border border-stone-200/60 dark:border-[#2A2F3A] rounded-2xl px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm text-stone-800 dark:text-stone-200 truncate">
                    {sourceDirectoryName}
                  </span>
                  <span className="text-xs bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 px-2 py-0.5 rounded-lg">
                    模型 {sourceRun.modelName}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  缺少源码目录（模型 {sourceModelName}），请先在领题页下载项目
                </p>
              )}
            </div>
          )}

          {/* GitHub 账号 */}
          <label className="block">
            <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">GitHub 账号</span>
            {!accounts.length ? (
              <button onClick={() => navigate('/settings')} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors">
                <Github className="w-3.5 h-3.5" /> 去设置 &rarr;
              </button>
            ) : (
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={busy} className={selectCls}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}</option>
                ))}
              </select>
            )}
          </label>

          {/* 模型 PR 多选 */}
          {taskId && projectPrModelNames.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-stone-500 dark:text-stone-400">模型 PR</span>
                <div className="flex gap-2 text-xs text-stone-400 dark:text-stone-500">
                  <button type="button" onClick={() => setSelectedModels(new Set(projectPrModelNames))} className="hover:text-stone-700 dark:hover:text-stone-300 transition-colors cursor-default">全选</button>
                  <span>/</span>
                  <button type="button" onClick={() => setSelectedModels(new Set())} className="hover:text-stone-700 dark:hover:text-stone-300 transition-colors cursor-default">取消</button>
                </div>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-[#232834] overflow-hidden divide-y divide-stone-100 dark:divide-stone-800">
                {projectPrModelNames.map((modelName) => (
                  <label key={modelName} className="flex items-center gap-3 px-4 py-2.5 bg-stone-50 dark:bg-[#171B22] hover:bg-stone-100 dark:hover:bg-[#1E2128] transition-colors cursor-default">
                    <input
                      type="checkbox"
                      checked={selectedModels.has(modelName)}
                      onChange={(e) =>
                        setSelectedModels((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(modelName) : next.delete(modelName);
                          return next;
                        })
                      }
                      disabled={busy}
                      className="w-4 h-4 rounded accent-slate-700 dark:accent-slate-300 cursor-default"
                    />
                    <span className="flex-1 font-mono text-sm text-stone-700 dark:text-stone-300 truncate">{modelName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 目标仓库 */}
          {repo && (
            <div>
              <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">目标仓库</span>
              <p className="font-mono text-sm text-stone-800 dark:text-stone-200 bg-stone-100 dark:bg-[#1E2128] rounded-xl px-4 py-2.5 border border-stone-200/60 dark:border-[#2A2F3A]">
                {repo}
              </p>
              <p className="text-xs text-stone-400 mt-1.5">
                自动创建{selectedModels.size > 0 ? <> &middot; 源码 &rarr; main &middot; {selectedModels.size} 个模型 &rarr; PR</> : <> &middot; 仅上传源码到 main</>}
              </p>
            </div>
          )}

          {/* 提交按钮 */}
          <button
            onClick={handleSubmit}
            disabled={!ready}
            className="w-full py-3 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors disabled:opacity-35 flex items-center justify-center gap-2 cursor-default"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> 提交中...</> : <><Rocket className="w-4 h-4" /> 开始提交</>}
          </button>

          {error && (
            <pre className="rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 px-4 py-3 text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">
              {error}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 提交结果面板（从 DB 读取，持久显示）──
function ResultsPanel({ modelRuns, projectPrModelNames, sourceModelName }: {
  modelRuns: ModelRunFromDB[];
  projectPrModelNames: string[];
  sourceModelName: string;
}) {
  const sourceRun = modelRuns.find(
    (r) => r.modelName.trim().toUpperCase() === sourceModelName.trim().toUpperCase(),
  );
  // Show results for project models + any extras already in DB
  const prRunNames = new Set([
    ...projectPrModelNames,
    ...modelRuns
      .filter((r) => {
        const upper = r.modelName.trim().toUpperCase();
        return upper !== 'ORIGIN' && upper !== sourceModelName.trim().toUpperCase();
      })
      .map((r) => r.modelName),
  ]);
  const prResults = [...prRunNames].map((name) =>
    modelRuns.find((r) => r.modelName === name) ?? { modelName: name, status: 'pending', prUrl: null, submitError: null } as ModelRunFromDB
  );

  if (!sourceRun && prResults.length === 0) return null;

  return (
    <div>
      <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">提交结果</span>
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden divide-y divide-stone-100 dark:divide-stone-800">
        {/* Source row */}
        {sourceRun && (
          <ResultRow
            label={`源码 · ${getPathBase(sourceRun.localPath) || sourceRun.modelName}`}
            status={sourceRun.status}
            link={sourceRun.originUrl ?? undefined}
            errMsg={sourceRun.submitError ?? undefined}
          />
        )}
        {/* Model rows */}
        {prResults.map((r) => (
          <ResultRow
            key={r.modelName}
            label={r.modelName}
            status={r.status}
            link={r.prUrl ?? undefined}
            errMsg={r.submitError ?? undefined}
          />
        ))}
      </div>
    </div>
  );
}

const ResultRow: React.FC<{
  label: string;
  status: string;
  link?: string;
  errMsg?: string;
}> = ({ label, status, link, errMsg }) => (
  <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-stone-900">
    <ResultIcon status={status} />
    <span className="flex-1 text-sm font-mono text-stone-700 dark:text-stone-300 truncate">{label}</span>
    {status === 'done' && link && (
      <a href={link} target="_blank" rel="noreferrer" className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors">
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    )}
    {status === 'error' && errMsg && (
      <span className="text-xs text-red-500 truncate max-w-[220px]" title={errMsg}>{errMsg}</span>
    )}
  </div>
);

function ResultIcon({ status }: { status: string }) {
  if (status === 'done') return <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
  if (status === 'running') return <Loader2 className="w-4 h-4 text-stone-400 animate-spin flex-shrink-0" />;
  return <div className="w-4 h-4 flex items-center justify-center flex-shrink-0"><div className="w-1.5 h-1.5 rounded-full bg-stone-300 dark:bg-stone-600" /></div>;
}

function normalizeAccounts(accs: GitHubAccountConfig[]) {
  if (!accs.length) return [];
  const hasDef = accs.some((a) => a.isDefault);
  return accs.map((a, i) => ({ ...a, isDefault: hasDef ? a.isDefault : i === 0 }));
}

function slugify(name: string) {
  return name.trim()
    .replace(/[^\x00-\x7F]+/g, '')     // remove non-ASCII (中文等)
    .replace(/[^a-zA-Z0-9._-]/g, '-')  // replace remaining non-allowed with -
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]|[-.]$/g, '')
    || 'project';
}

function errStr(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error && e.message.trim()) return e.message;
  if (e && typeof e === 'object') {
    const m = (e as Record<string, unknown>).message;
    if (typeof m === 'string' && m.trim()) return m;
    try { return JSON.stringify(e); } catch { /* ignore */ }
  }
  return '未知错误';
}
