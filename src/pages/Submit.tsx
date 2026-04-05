import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Loader2, Rocket } from 'lucide-react';
import {
  getActiveProjectId,
  getGitHubAccounts,
  getProjects,
  type GitHubAccountConfig,
  type ProjectConfig,
} from '../services/config';
import {
  listModelRuns,
  updateTaskStatus,
  type ModelRunFromDB,
} from '../services/task';
import { publishSourceRepo, submitModelRun } from '../services/submit';
import { useAppStore } from '../store';

const TASK_STATUS_LABEL: Record<string, string> = {
  Claimed: '已领题',
  PromptReady: '提示词就绪',
  Running: '执行中',
  Submitted: '已提交',
  Scored: '已评分',
  Archived: '已归档',
};

const cardCls = 'bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl';
const inputCls = 'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400';
const btnPrimary = 'px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 cursor-default';
const btnSecondary = 'px-4 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-default disabled:opacity-50';

type SubmitEntryStatus = 'pending' | 'submitting' | 'done' | 'error';

type SubmitEntry = {
  id: string;
  modelName: string;
  localPath: string | null;
  branchName: string | null;
  prUrl: string | null;
  status: SubmitEntryStatus;
  message: string;
};

type SourcePublishState = {
  modelName: string;
  status: 'idle' | 'publishing' | 'done' | 'error';
  branchName: string | null;
  repoUrl: string | null;
  message: string;
};

export default function Submit() {
  const navigate = useNavigate();
  const allTasks = useAppStore((state) => state.tasks);
  const loadTasks = useAppStore((state) => state.loadTasks);
  const tasks = useMemo(() => allTasks, [allTasks]);

  const [githubAccounts, setGithubAccounts] = useState<GitHubAccountConfig[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectConfig | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [sourceModelInput, setSourceModelInput] = useState('ORIGIN');
  const [targetRepoInput, setTargetRepoInput] = useState('');
  const [modelRuns, setModelRuns] = useState<ModelRunFromDB[]>([]);
  const [submitEntries, setSubmitEntries] = useState<SubmitEntry[]>([]);
  const [sourcePublishState, setSourcePublishState] = useState<SourcePublishState>(
    createSourcePublishState('ORIGIN'),
  );
  const [loadingContext, setLoadingContext] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [copiedLogs, setCopiedLogs] = useState(false);

  const appendLog = (message: string) => {
    setDebugLogs((current) => [...current.slice(-199), `[${formatLogTime()}] ${message}`]);
  };

  useEffect(() => {
    (async () => {
      setLoadingContext(true);
      try {
        await loadTasks();
        const [accounts, activeProjectId, projects] = await Promise.all([
          getGitHubAccounts(),
          getActiveProjectId(),
          getProjects(),
        ]);

        const normalizedAccounts = normalizeGitHubAccounts(accounts);
        const selectedProject =
          projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;

        setGithubAccounts(normalizedAccounts);
        setActiveProject(selectedProject);
      } catch (error) {
        console.error(error);
        setLoadError(error instanceof Error ? error.message : '提交数据加载失败');
        appendLog(`初始化失败：${formatErrorMessage(error, '提交数据加载失败')}`);
      } finally {
        setLoadingContext(false);
      }
    })();
  }, [loadTasks]);

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId('');
      return;
    }

    if (!tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!githubAccounts.length) {
      setSelectedAccountId('');
      return;
    }

    if (!githubAccounts.some((account) => account.id === selectedAccountId)) {
      const defaultAccount = githubAccounts.find((account) => account.isDefault) ?? githubAccounts[0];
      setSelectedAccountId(defaultAccount.id);
    }
  }, [githubAccounts, selectedAccountId]);

  useEffect(() => {
    if (!selectedTaskId) {
      setModelRuns([]);
      return;
    }

    let cancelled = false;
    setLoadingContext(true);
    setLoadError('');

    (async () => {
      const runs = await listModelRuns(selectedTaskId);
      if (cancelled) return;
      setModelRuns(runs);
      setLoadingContext(false);
      appendLog(`任务 ${selectedTaskId} 已加载 ${runs.length} 个模型副本`);
    })().catch((error) => {
      if (cancelled) return;
      console.error(error);
      setLoadError(error instanceof Error ? error.message : '任务上下文加载失败');
      setLoadingContext(false);
      appendLog(`任务 ${selectedTaskId} 上下文加载失败：${formatErrorMessage(error, '任务上下文加载失败')}`);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  const selectedTaskMeta = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedAccount = githubAccounts.find((account) => account.id === selectedAccountId) ?? null;
  const sourceModelName = sourceModelInput.trim() || activeProject?.sourceModelFolder?.trim() || 'ORIGIN';
  const sourceModelRun = useMemo(
    () => modelRuns.find((run) => isSameModel(run.model_name, sourceModelName)) ?? null,
    [modelRuns, sourceModelName],
  );
  const activeModelRuns = useMemo(
    () => modelRuns.filter((run) => !isSubmissionExcludedModel(run.model_name, sourceModelName)),
    [modelRuns, sourceModelName],
  );
  const targetRepo = targetRepoInput.trim();

  useEffect(() => {
    if (isSubmitting) return;
    setSubmitEntries(activeModelRuns.map(createSubmitEntry));
  }, [activeModelRuns, isSubmitting]);

  useEffect(() => {
    if (isSubmitting) return;

    const preferredSource =
      modelRuns.find((run) => isSameModel(run.model_name, activeProject?.sourceModelFolder?.trim() || 'ORIGIN'))?.model_name
      || modelRuns.find((run) => isOriginModel(run.model_name))?.model_name
      || modelRuns[0]?.model_name
      || 'ORIGIN';

    setSourceModelInput(preferredSource);
  }, [selectedTaskId, modelRuns, activeProject?.sourceModelFolder, isSubmitting]);

  useEffect(() => {
    if (isSubmitting) return;

    const preferredRepo =
      activeProject?.defaultSubmitRepo?.trim()
      || selectedAccount?.defaultRepo?.trim()
      || (selectedTaskId ? `prompt2repo/${selectedTaskId}` : '');

    setTargetRepoInput(preferredRepo);
  }, [selectedTaskId, activeProject?.defaultSubmitRepo, selectedAccount?.defaultRepo, isSubmitting]);

  useEffect(() => {
    if (isSubmitting) return;
    setSourcePublishState(createSourcePublishState(sourceModelName));
  }, [selectedTaskId, sourceModelName]);

  useEffect(() => {
    setDebugLogs([]);
    setCopiedLogs(false);
  }, [selectedTaskId]);

  const handleSubmit = async () => {
    if (!selectedTaskId || !selectedTaskMeta) {
      appendLog('校验失败：未选择任务');
      setSubmitError('请先选择任务');
      return;
    }
    if (!selectedAccount) {
      appendLog('校验失败：未配置 GitHub 账号');
      setSubmitError('请先在设置里配置 GitHub 账号');
      return;
    }
    if (!targetRepo) {
      appendLog('校验失败：源码仓库为空');
      setSubmitError('请先在提交页填写源码仓库');
      return;
    }
    if (!isRepoPath(targetRepo)) {
      appendLog(`校验失败：源码仓库格式无效 -> ${targetRepo}`);
      setSubmitError('源码仓库格式应为 owner/repo');
      return;
    }
    if (!activeModelRuns.length) {
      appendLog('校验失败：没有可提交的模型副本');
      setSubmitError('当前任务没有可提交的模型副本');
      return;
    }
    if (!sourceModelRun) {
      appendLog(`校验失败：找不到源码文件夹 ${sourceModelName}`);
      setSubmitError(`当前任务缺少源码文件夹「${sourceModelName}」，请先在项目设置里确认源码文件夹配置`);
      return;
    }

    appendLog(`开始提交：task=${selectedTaskId} account=@${selectedAccount.username} source=${sourceModelName} repo=${targetRepo}`);
    appendLog(`待提交模型：${activeModelRuns.map((run) => run.model_name).join(', ') || '无'}`);
    setIsSubmitting(true);
    setSubmitError('');
    setSourcePublishState({
      ...createSourcePublishState(sourceModelName),
      status: 'idle',
    });
    setSubmitEntries(activeModelRuns.map((run) => ({
      ...createSubmitEntry(run),
      status: 'pending',
      message: '',
    })));

    try {
      await updateTaskStatus(selectedTaskId, 'Running');
      await loadTasks();
      appendLog(`任务状态已更新为 Running`);

      setSourcePublishState({
        modelName: sourceModelName,
        status: 'publishing',
        branchName: null,
        repoUrl: null,
        message: '',
      });

      try {
        appendLog(`开始上传源码：model=${sourceModelRun.model_name} repo=${targetRepo}`);
        const sourceResult = await publishSourceRepo({
          taskId: selectedTaskId,
          modelName: sourceModelRun.model_name,
          targetRepo: targetRepo.trim(),
          githubUsername: selectedAccount.username,
          githubToken: selectedAccount.token,
        });

        setSourcePublishState({
          modelName: sourceModelName,
          status: 'done',
          branchName: sourceResult.branchName,
          repoUrl: sourceResult.repoUrl,
          message: '',
        });
        appendLog(`源码上传成功：branch=${sourceResult.branchName} repo=${sourceResult.repoUrl}`);
      } catch (error) {
        const message = formatErrorMessage(error, '源码上传失败');
        setSourcePublishState({
          modelName: sourceModelName,
          status: 'error',
          branchName: null,
          repoUrl: null,
          message,
        });
        setSubmitError(`源码上传失败：${message}`);
        appendLog(`源码上传失败：${message}`);
        await updateTaskStatus(selectedTaskId, selectedTaskMeta.status);
        await loadTasks();
        appendLog(`任务状态已回滚为 ${selectedTaskMeta.status}`);
        return;
      }

      let successCount = 0;
      const failures: string[] = [];

      for (const run of activeModelRuns) {
        appendLog(`开始提交模型：model=${run.model_name} localPath=${run.local_path || 'N/A'}`);
        setSubmitEntries((current) =>
          current.map((entry) =>
            entry.modelName === run.model_name
              ? { ...entry, status: 'submitting', message: '' }
              : entry,
          ),
        );

        try {
          const result = await submitModelRun({
            taskId: selectedTaskId,
            modelName: run.model_name,
            targetRepo: targetRepo.trim(),
            githubUsername: selectedAccount.username,
            githubToken: selectedAccount.token,
          });

          successCount += 1;
          setSubmitEntries((current) =>
            current.map((entry) =>
              entry.modelName === run.model_name
                ? {
                    ...entry,
                    status: 'done',
                    branchName: result.branchName,
                    prUrl: result.prUrl,
                    message: '',
                  }
                : entry,
            ),
          );
          appendLog(`模型提交成功：model=${run.model_name} branch=${result.branchName} pr=${result.prUrl}`);
        } catch (error) {
          const message = formatErrorMessage(error, '提交流程执行失败');
          failures.push(`${run.model_name}: ${message}`);
          setSubmitEntries((current) =>
            current.map((entry) =>
              entry.modelName === run.model_name
                ? { ...entry, status: 'error', message }
                : entry,
            ),
          );
          appendLog(`模型提交失败：model=${run.model_name} error=${message}`);
        }
      }

      await updateTaskStatus(
        selectedTaskId,
        successCount === activeModelRuns.length ? 'Submitted' : 'Running',
      );
      setModelRuns(await listModelRuns(selectedTaskId));
      await loadTasks();
      appendLog(`提交流程结束：成功 ${successCount}/${activeModelRuns.length}，任务状态=${successCount === activeModelRuns.length ? 'Submitted' : 'Running'}`);

      if (failures.length) {
        setSubmitError(failures.join('\n'));
        appendLog(`失败汇总：${failures.join(' | ')}`);
      }
    } catch (error) {
      console.error(error);
      setSubmitError(formatErrorMessage(error, '提交流程执行失败'));
      appendLog(`流程异常中断：${formatErrorMessage(error, '提交流程执行失败')}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLogs = async () => {
    if (!debugLogs.length) return;

    await navigator.clipboard.writeText(debugLogs.join('\n'));
    setCopiedLogs(true);
    window.setTimeout(() => setCopiedLogs(false), 1600);
  };

  return (
    <div className="h-full flex flex-col p-8 bg-stone-50 dark:bg-[#161615]">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50 tracking-tight">提交中心</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
          先上传源码文件夹到源码仓库默认分支，再逐个模型推送分支并创建真实 PR
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className={`${cardCls} mx-auto max-w-2xl p-6`}>
          <SectionHead title="任务与账号" description="沿用下载页的逐项进度反馈，先上传源码，再按模型顺序执行提交" />

          {loadError && (
            <div className="mb-4 rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
              {loadError}
            </div>
          )}

          <div className="space-y-4">
            <Field label="任务">
              <select
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
                className={inputCls}
                disabled={loadingContext || isSubmitting}
              >
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.id} · {task.projectName} · {TASK_STATUS_LABEL[task.status] ?? task.status}
                  </option>
                ))}
                {!tasks.length && <option value="">暂无任务</option>}
              </select>
            </Field>

            <Field label="GitHub 账号">
              <select
                value={selectedAccountId}
                onChange={(event) => setSelectedAccountId(event.target.value)}
                className={inputCls}
                disabled={!githubAccounts.length || isSubmitting}
              >
                {githubAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · @{account.username}
                  </option>
                ))}
                {!githubAccounts.length && <option value="">请先在设置中配置 GitHub 账号</option>}
              </select>
            </Field>

            <Field label="源码文件夹" hint="提交时会先把这里指定的文件夹上传到源码仓库默认分支">
              <select
                value={sourceModelInput}
                onChange={(event) => setSourceModelInput(event.target.value)}
                className={inputCls}
                disabled={!modelRuns.length || isSubmitting}
              >
                {modelRuns.map((run) => (
                  <option key={run.id} value={run.model_name}>
                    {run.model_name}
                  </option>
                ))}
                {!modelRuns.length && <option value="">当前任务暂无模型副本</option>}
              </select>
            </Field>

            <Field label="源码仓库" hint="项目设置中的源码仓库会自动预填，这里可以直接改">
              <input
                type="text"
                value={targetRepoInput}
                onChange={(event) => setTargetRepoInput(event.target.value)}
                placeholder="例如：prompt2repo/label-01849"
                className={inputCls}
                disabled={isSubmitting}
              />
            </Field>

            {selectedTaskMeta && (
              <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3 space-y-2">
                <InfoRow label="项目名称">{selectedTaskMeta.projectName}</InfoRow>
                <InfoRow label="任务状态">{TASK_STATUS_LABEL[selectedTaskMeta.status] ?? selectedTaskMeta.status}</InfoRow>
                <InfoRow label="源码文件夹">{sourceModelName}</InfoRow>
                <InfoRow label="源码仓库">{targetRepo || '未设置'}</InfoRow>
                <InfoRow label="提交模型">{`${activeModelRuns.length || 0} 个副本`}</InfoRow>
              </div>
            )}

            <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">
              默认规则：先将源码文件夹上传到源码仓库默认分支，再为其余模型创建 PR；PR 标题使用当前模型名称，PR 说明留空。
            </p>

            {(sourcePublishState.modelName || submitEntries.length > 0) && (
              <div className="pt-5 border-t border-stone-100 dark:border-stone-800 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-300">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : <Rocket className="w-4 h-4 text-slate-500" />}
                  {isSubmitting ? '正在提交...' : '提交进度'}
                </div>

                {sourcePublishState.modelName && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium gap-3">
                      <span className="font-mono text-stone-500 dark:text-stone-400 truncate">
                        源码 · {sourcePublishState.modelName}
                      </span>
                      <span className={sourcePublishStatusClass(sourcePublishState.status)}>
                        {sourcePublishStatusText(sourcePublishState.status)}
                      </span>
                    </div>
                    <div className="h-1 w-full bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${sourcePublishBarClass(sourcePublishState.status)}`} />
                    </div>
                    {(sourcePublishState.branchName || sourcePublishState.repoUrl || sourcePublishState.message) && (
                      <div className="space-y-1 text-[12px] text-stone-500 dark:text-stone-400">
                        {sourcePublishState.branchName && <p className="font-mono break-all">默认分支：{sourcePublishState.branchName}</p>}
                        {sourcePublishState.repoUrl && (
                          <p className="break-all">
                            仓库：
                            <a
                              href={sourcePublishState.repoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1 text-slate-700 dark:text-slate-300 hover:underline"
                            >
                              {sourcePublishState.repoUrl}
                            </a>
                          </p>
                        )}
                        {sourcePublishState.message && <p className="text-red-500 dark:text-red-400">{sourcePublishState.message}</p>}
                      </div>
                    )}
                  </div>
                )}

                {submitEntries.map((entry) => (
                  <div key={entry.id} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-medium gap-3">
                      <span className="font-mono text-stone-500 dark:text-stone-400 truncate">{entry.modelName}</span>
                      <span className={submitEntryStatusClass(entry.status)}>
                        {submitEntryStatusText(entry.status)}
                      </span>
                    </div>
                    <div className="h-1 w-full bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${submitEntryBarClass(entry.status)}`} />
                    </div>
                    {(entry.branchName || (entry.status === 'done' && entry.prUrl) || entry.message) && (
                      <div className="space-y-1 text-[12px] text-stone-500 dark:text-stone-400">
                        {entry.branchName && <p className="font-mono break-all">分支：{entry.branchName}</p>}
                        {entry.status === 'done' && entry.prUrl && (
                          <p className="break-all">
                            PR：
                            <a
                              href={entry.prUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1 text-slate-700 dark:text-slate-300 hover:underline"
                            >
                              {entry.prUrl}
                            </a>
                          </p>
                        )}
                        {entry.message && <p className="text-red-500 dark:text-red-400">{entry.message}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {submitError && (
              <pre className="rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 whitespace-pre-wrap">
                {submitError}
              </pre>
            )}

            <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">调试日志</p>
                <button
                  onClick={handleCopyLogs}
                  disabled={!debugLogs.length}
                  className={btnSecondary}
                >
                  {copiedLogs ? '已复制' : '复制日志'}
                </button>
              </div>
              <pre className="max-h-56 overflow-auto rounded-2xl bg-white dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] px-4 py-3 text-[12px] leading-5 text-stone-600 dark:text-stone-300 whitespace-pre-wrap">
                {debugLogs.length ? debugLogs.join('\n') : '执行提交流程后，这里会显示逐步日志。'}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              {!githubAccounts.length ? (
                <button onClick={() => navigate('/settings')} className={btnSecondary}>
                  <Github className="w-4 h-4" />
                  前往配置 GitHub 账号
                </button>
              ) : (
                <span className="text-sm text-stone-400 dark:text-stone-500">
                  {activeProject?.name ? `默认配置来源：${activeProject.name}` : '未设置默认项目'}
                </span>
              )}

              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !selectedTaskId || !activeModelRuns.length || !githubAccounts.length || !sourceModelRun || !targetRepo}
                className={btnPrimary}
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                {isSubmitting ? '提交中...' : '执行提交流程'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight">{title}</h2>
      <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">{description}</p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-stone-700 dark:text-stone-300 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5">{hint}</p>}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-stone-400 dark:text-stone-500 flex-shrink-0">{label}</span>
      <span className="text-right text-stone-700 dark:text-stone-300 break-all">{children}</span>
    </div>
  );
}

function normalizeGitHubAccounts(accounts: GitHubAccountConfig[]) {
  if (!accounts.length) return [];

  const hasDefault = accounts.some((account) => account.isDefault);
  return accounts.map((account, index) => ({
    ...account,
    defaultRepo: account.defaultRepo?.trim() || null,
    isDefault: hasDefault ? account.isDefault : index === 0,
  }));
}

function isOriginModel(modelName: string) {
  return isSameModel(modelName, 'ORIGIN');
}

function isSameModel(left: string, right: string) {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function isSubmissionExcludedModel(modelName: string, sourceModelName: string) {
  return isOriginModel(modelName) || isSameModel(modelName, sourceModelName);
}

function isRepoPath(value: string) {
  return /^[^/\s]+\/[^/\s]+$/.test(value.trim());
}

function createSourcePublishState(modelName: string): SourcePublishState {
  return {
    modelName,
    status: 'idle',
    branchName: null,
    repoUrl: null,
    message: '',
  };
}

function createSubmitEntry(run: ModelRunFromDB): SubmitEntry {
  return {
    id: run.id,
    modelName: run.model_name,
    localPath: run.local_path,
    branchName: run.branch_name,
    prUrl: run.pr_url,
    status: mapModelRunStatus(run.status),
    message: '',
  };
}

function mapModelRunStatus(status: string): SubmitEntryStatus {
  if (status === 'done') return 'done';
  if (status === 'running') return 'submitting';
  if (status === 'error') return 'error';
  return 'pending';
}

function submitEntryStatusText(status: SubmitEntryStatus) {
  if (status === 'done') return '✓ 完成';
  if (status === 'submitting') return '提交中…';
  if (status === 'error') return '✗ 失败';
  return '等待';
}

function submitEntryStatusClass(status: SubmitEntryStatus) {
  if (status === 'done') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'submitting') return 'text-slate-700 dark:text-slate-300';
  if (status === 'error') return 'text-red-500';
  return 'text-stone-400';
}

function submitEntryBarClass(status: SubmitEntryStatus) {
  if (status === 'done') return 'w-full bg-emerald-500';
  if (status === 'submitting') return 'w-full bg-slate-500 animate-pulse';
  if (status === 'error') return 'w-full bg-red-400';
  return 'w-0';
}

function sourcePublishStatusText(status: SourcePublishState['status']) {
  if (status === 'done') return '✓ 已上传';
  if (status === 'publishing') return '上传中…';
  if (status === 'error') return '✗ 失败';
  return '等待';
}

function sourcePublishStatusClass(status: SourcePublishState['status']) {
  if (status === 'done') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'publishing') return 'text-slate-700 dark:text-slate-300';
  if (status === 'error') return 'text-red-500';
  return 'text-stone-400';
}

function sourcePublishBarClass(status: SourcePublishState['status']) {
  if (status === 'done') return 'w-full bg-emerald-500';
  if (status === 'publishing') return 'w-full bg-slate-500 animate-pulse';
  if (status === 'error') return 'w-full bg-red-400';
  return 'w-0';
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = Reflect.get(error, 'message');
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function formatLogTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
