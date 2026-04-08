import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Rocket, ExternalLink, Check, X, Github } from 'lucide-react';
import {
  getGitHubAccounts,
  normalizeProjectModels,
  type GitHubAccountConfig,
} from '../services/config';
import {
  listModelRuns,
  updateTaskStatus,
  addModelRun,
  type ModelRunFromDB,
} from '../services/task';
import { publishSourceRepo, submitModelRun } from '../services/submit';
import { useAppStore } from '../store';

const selectCls =
  'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow';

export default function Submit() {
  const navigate = useNavigate();
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
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [sourceState, setSourceState] = useState({ status: 'idle' as 'idle' | 'pub' | 'ok' | 'err', url: '', msg: '' });
  const [modelState, setModelState] = useState<Record<string, { status: 'wait' | 'run' | 'ok' | 'err'; prUrl: string; msg: string }>>({});
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

  const task = tasks.find((t) => t.id === taskId) ?? null;
  const account = accounts.find((a) => a.id === accountId) ?? null;

  // Non-ORIGIN models from the project configuration
  const projectPrModelNames = useMemo(() => {
    if (!activeProject?.models) return [];
    return normalizeProjectModels(activeProject.models).filter(
      (m) => m.trim().toUpperCase() !== 'ORIGIN',
    );
  }, [activeProject]);

  const srcRun = useMemo(
    () => modelRuns.find((r) => r.modelName.trim().toUpperCase() === 'ORIGIN') ?? null,
    [modelRuns],
  );
  const srcName = srcRun?.modelName ?? 'ORIGIN';

  // prRuns still used for progress display (existing DB runs)
  const prRuns = useMemo(
    () => modelRuns.filter((r) => r.modelName.trim().toUpperCase() !== 'ORIGIN'),
    [modelRuns],
  );

  const repo = useMemo(() => {
    if (!account || !task) return '';
    const projectName = activeProject?.name ?? task.projectName;
    return `${account.username}/${slugify(projectName)}-${taskId}`;
  }, [account, task, taskId, activeProject]);

  useEffect(() => {
    (async () => {
      await loadActiveProject();
      await loadTasks();
      const accs = await getGitHubAccounts();
      setAccounts(normalizeAccounts(accs));
    })();
  }, [loadTasks, loadActiveProject]);

  useEffect(() => {
    if (!tasks.length) { setTaskId(''); return; }
    if (!tasks.some((t) => t.id === taskId)) setTaskId(tasks[0].id);
  }, [tasks, taskId]);

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

  // Default: select all project PR models
  useEffect(() => {
    setSelectedModels(new Set(projectPrModelNames));
  }, [projectPrModelNames]);

  useEffect(() => {
    if (busy) return;
    setPhase('idle');
    setSourceState({ status: 'idle', url: '', msg: '' });
    setModelState({});
    setError('');
  }, [taskId, busy]);

  // Derive a model's local path from the ORIGIN path (sibling folder)
  const deriveModelPath = (modelName: string): string | null => {
    if (!srcRun?.localPath) return null;
    const lastSlash = srcRun.localPath.lastIndexOf('/');
    if (lastSlash < 0) return null;
    return srcRun.localPath.substring(0, lastSlash) + '/' + modelName;
  };

  const handleSubmit = async () => {
    if (!task || !account || !repo || !srcRun) return;
    const selectedList = [...selectedModels];

    setBusy(true);
    setError('');
    setPhase('running');
    setSourceState({ status: 'idle', url: '', msg: '' });
    setModelState(Object.fromEntries(selectedList.map((m) => [m, { status: 'wait' as const, prUrl: '', msg: '' }])));

    try {
      // Ensure model_run records exist for all selected models
      for (const modelName of selectedList) {
        const exists = modelRuns.some((r) => r.modelName === modelName);
        if (!exists) {
          await addModelRun({ taskId, modelName, localPath: deriveModelPath(modelName) });
        }
      }
      const freshRuns = await listModelRuns(taskId);
      setModelRuns(freshRuns);

      setSourceState({ status: 'pub', url: '', msg: '' });
      try {
        const res = await publishSourceRepo({
          taskId,
          modelName: srcRun.modelName,
          targetRepo: repo,
          githubUsername: account.username,
          githubToken: account.token,
        });
        setSourceState({ status: 'ok', url: res.repoUrl, msg: '' });
      } catch (e) {
        setSourceState({ status: 'err', url: '', msg: errStr(e) });
        setError(`源码上传失败: ${errStr(e)}`);
        await updateTaskStatus(taskId, task.status);
        await loadTasks();
        setPhase('done');
        return;
      }

      if (selectedList.length) {
        let ok = 0;
        const fails: string[] = [];
        for (const modelName of selectedList) {
          setModelState((p) => ({ ...p, [modelName]: { status: 'run', prUrl: '', msg: '' } }));
          try {
            const res = await submitModelRun({
              taskId,
              modelName,
              targetRepo: repo,
              githubUsername: account.username,
              githubToken: account.token,
            });
            ok++;
            setModelState((p) => ({ ...p, [modelName]: { status: 'ok', prUrl: res.prUrl, msg: '' } }));
          } catch (e) {
            fails.push(`${modelName}: ${errStr(e)}`);
            setModelState((p) => ({ ...p, [modelName]: { status: 'err', prUrl: '', msg: errStr(e) } }));
          }
        }

        await updateTaskStatus(taskId, ok === selectedList.length ? 'Submitted' : 'Error');
        setModelRuns(await listModelRuns(taskId));
        await loadTasks();
        if (fails.length) setError(fails.join('\n'));
      } else {
        await updateTaskStatus(taskId, 'Submitted');
        await loadTasks();
      }
      setPhase('done');
    } catch (e) {
      setError(errStr(e));
      setPhase('done');
    } finally {
      setBusy(false);
    }
  };

  const ready = !!task && !!account && !!repo && !!srcRun && !busy;

  return (
    <div className="h-full flex flex-col p-8 bg-stone-50 dark:bg-[#161615]">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50 tracking-tight">提交</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto space-y-5">
          <label className="block">
            <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">任务</span>
            {!tasks.length ? (
              <button onClick={() => navigate('/claim')} className="text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors">
                暂无任务，去领题 &rarr;
              </button>
            ) : (
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={busy} className={selectCls}>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.projectName} &middot; {t.id}</option>
                ))}
              </select>
            )}
          </label>

          {taskId && (
            <div>
              <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">原始代码</span>
              {srcRun ? (
                <div className="flex items-center gap-2 bg-stone-100 dark:bg-[#1E2128] border border-stone-200/60 dark:border-[#2A2F3A] rounded-2xl px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm text-stone-800 dark:text-stone-200 truncate">
                    {srcRun.modelName}
                  </span>
                  <span className="text-xs bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400 px-2 py-0.5 rounded-lg">
                    必选
                  </span>
                </div>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  缺少 origin 文件夹，请先在领题页下载项目
                </p>
              )}
            </div>
          )}

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

          {taskId && projectPrModelNames.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-stone-500 dark:text-stone-400">模型 PR</span>
                <div className="flex gap-2 text-xs text-stone-400 dark:text-stone-500">
                  <button
                    type="button"
                    onClick={() => setSelectedModels(new Set(projectPrModelNames))}
                    className="hover:text-stone-700 dark:hover:text-stone-300 transition-colors cursor-default"
                  >
                    全选
                  </button>
                  <span>/</span>
                  <button
                    type="button"
                    onClick={() => setSelectedModels(new Set())}
                    className="hover:text-stone-700 dark:hover:text-stone-300 transition-colors cursor-default"
                  >
                    取消
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-[#232834] overflow-hidden divide-y divide-stone-100 dark:divide-stone-800">
                {projectPrModelNames.map((modelName) => (
                  <label
                    key={modelName}
                    className="flex items-center gap-3 px-4 py-2.5 bg-stone-50 dark:bg-[#171B22] hover:bg-stone-100 dark:hover:bg-[#1E2128] transition-colors cursor-default"
                  >
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
                    <span className="flex-1 font-mono text-sm text-stone-700 dark:text-stone-300 truncate">
                      {modelName}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {repo && (
            <div>
              <span className="block text-sm font-medium text-stone-500 dark:text-stone-400 mb-1.5">目标仓库</span>
              <p className="font-mono text-sm text-stone-800 dark:text-stone-200 bg-stone-100 dark:bg-[#1E2128] rounded-xl px-4 py-2.5 border border-stone-200/60 dark:border-[#2A2F3A]">
                {repo}
              </p>
              <p className="text-xs text-stone-400 mt-1.5">
                自动创建{selectedModels.size > 0 ? (
                  <> &middot; 源码 &rarr; main &middot; {selectedModels.size} 个模型 &rarr; PR</>
                ) : (
                  <> &middot; 仅上传源码到 main</>
                )}
              </p>
            </div>
          )}

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

          {phase !== 'idle' && (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 divide-y divide-stone-100 dark:divide-stone-800 overflow-hidden">
              <ProgressRow
                label={`源码 · ${srcName}`}
                status={sourceState.status === 'pub' ? 'run' : sourceState.status === 'ok' ? 'ok' : sourceState.status === 'err' ? 'err' : 'wait'}
                link={sourceState.url}
                msg={sourceState.msg}
              />
              {[...selectedModels].map((modelName) => {
                const s = modelState[modelName];
                return (
                  <ProgressRow
                    key={modelName}
                    label={modelName}
                    status={s?.status ?? 'wait'}
                    link={s?.prUrl}
                    msg={s?.msg}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressRow({ label, status, link, msg }: { key?: string; label: string; status: 'wait' | 'run' | 'ok' | 'err'; link?: string; msg?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-stone-900">
      <StatusIcon status={status} />
      <span className="flex-1 text-sm font-mono text-stone-700 dark:text-stone-300 truncate">{label}</span>
      {status === 'ok' && link && (
        <a href={link} target="_blank" rel="noreferrer" className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
      {status === 'err' && msg && (
        <span className="text-xs text-red-500 truncate max-w-[200px]" title={msg}>{msg}</span>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: 'wait' | 'run' | 'ok' | 'err' }) {
  if (status === 'ok') return <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  if (status === 'err') return <X className="w-4 h-4 text-red-400 flex-shrink-0" />;
  if (status === 'run') return <Loader2 className="w-4 h-4 text-stone-400 animate-spin flex-shrink-0" />;
  return <div className="w-4 h-4 flex items-center justify-center flex-shrink-0"><div className="w-1.5 h-1.5 rounded-full bg-stone-300 dark:bg-stone-600" /></div>;
}

function normalizeAccounts(accs: GitHubAccountConfig[]) {
  if (!accs.length) return [];
  const hasDef = accs.some((a) => a.isDefault);
  return accs.map((a, i) => ({ ...a, isDefault: hasDef ? a.isDefault : i === 0 }));
}

function slugify(name: string) {
  return name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, '').replace(/-{2,}/g, '-').replace(/^[-.]|[-.]$/g, '') || 'repo';
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
