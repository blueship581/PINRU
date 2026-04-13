import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Folder,
  GitFork,
  Loader2,
  Plus,
  Rocket,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store';
import {
  checkPathsExist,
  fetchConfiguredGitLabProjects,
  type GitLabProject,
  planManagedClaimPaths,
  type ManagedClaimPathPlan,
} from '../../api/git';
import {
  getJob,
  submitJob,
  type BackgroundJob,
  type GitClonePayload,
  type GitCloneResult,
} from '../../api/job';
import { createTask } from '../../api/task';
import {
  DEFAULT_TASK_TYPE,
  getActiveProjectId,
  getGitLabSettings,
  getConfig,
  getProjectTaskSettings,
  getProjects,
  getTaskTypePresentation,
  getTaskTypeQuotaValue,
  normalizeTaskTypeName,
  normalizeProjectModels,
  type ProjectConfig,
  type TaskType,
  type TaskTypeQuotas,
} from '../../api/config';
import { countCountedSessionsByTaskType } from '../../shared/lib/sessionUtils';
import { getTaskTypeRemainingToCompleteCount } from '../../shared/lib/taskTypeOverview';
import { DoneSummary, RunningRow } from './components/ClaimPrimitives';
import type {
  ClaimResult,
  ClonePlanResult,
  ModelEntry,
  Phase,
  ProjectLookup,
} from './types';
import {
  buildProjectRef,
  formatClaimProjectId,
  getResultStatusMeta,
  isOriginModel,
  parseProjectIds,
  partitionClaimsByProjectLimit,
  pickSourceModel,
  toErrorMessage,
} from './utils/claimUtils';
import { runWithConcurrency } from './utils/asyncPool';

/* ─── Component ─── */

type PlannedClaim = {
  lookup: ProjectLookup;
  plan: ManagedClaimPathPlan;
  claimKey: string;
  displayProjectId: string;
};

export default function Claim() {
  const navigate = useNavigate();
  const tasks = useAppStore((state) => state.tasks);
  const loadTasks = useAppStore((state) => state.loadTasks);
  const storeCloneModels = useAppStore((state) => state.cloneModels);
  const loadCloneModels = useAppStore((state) => state.loadCloneModels);

  const [phase, setPhase] = useState<Phase>('input');
  const [rawInput, setRawInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [lookups, setLookups] = useState<ProjectLookup[]>([]);
  const [claimResults, setClaimResults] = useState<ClaimResult[]>([]);
  const [cloneProgressMsg, setCloneProgressMsg] = useState('');

  const [defaultCloneRoot, setDefaultCloneRoot] = useState('~/repositories/gitlab/评审项目/project/generate');
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectConfig | null>(null);
  const [quotas, setQuotas] = useState<TaskTypeQuotas>({});
  const [selectedTaskType, setSelectedTaskType] = useState<TaskType | null>(null);
  const [claimSetCount, setClaimSetCount] = useState(1);

  const [models, setModels] = useState<ModelEntry[]>(
    storeCloneModels.map((m) => ({ ...m, checked: m.isDefault, status: 'pending' as const })),
  );
  const [addingModel, setAddingModel] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');

  useEffect(() => {
    setModels(storeCloneModels.map((m) => ({ ...m, checked: m.isDefault, status: 'pending' as const })));
  }, [storeCloneModels]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadCloneModels(), loadTasks()]);
      const [activeProjectId, projects] = await Promise.all([getActiveProjectId(), getProjects()]);
      const proj = projects.find((p) => p.id === activeProjectId) ?? projects[0];
      if (proj) {
        const taskSettings = getProjectTaskSettings(proj);
        setActiveConfigId(proj.id);
        setActiveProject(proj);
        setDefaultCloneRoot(proj.cloneBasePath);
        setQuotas(taskSettings.quotas);
        const modelNames = normalizeProjectModels(proj.models);
        setModels(
          modelNames.map((name) => ({
            id: name,
            name,
            checked: true,
            status: 'pending' as const,
          })),
        );
        return;
      }
      const configuredRoot = await getConfig('default_clone_path');
      if (configuredRoot?.trim()) setDefaultCloneRoot(configuredRoot.trim());
    })();
  }, [loadCloneModels, loadTasks]);

  const projectTaskSettings = useMemo(
    () => getProjectTaskSettings(activeProject, selectedTaskType ? [selectedTaskType] : []),
    [activeProject, selectedTaskType],
  );
  const availableTaskTypes = projectTaskSettings.taskTypes;
  const projectTotals = projectTaskSettings.totals;
  const submittedSessionsByTaskType = useMemo(
    () =>
      countCountedSessionsByTaskType(tasks, {
        status: 'Submitted',
        requireSessionId: true,
      }),
    [tasks],
  );
  const getTaskTypeRemaining = (taskType: TaskType): number | null =>
    getTaskTypeRemainingToCompleteCount(
      taskType,
      quotas,
      projectTotals,
      submittedSessionsByTaskType[taskType] ?? 0,
    );
  const defaultTaskType = useMemo(
    () =>
      availableTaskTypes.find((taskType) => {
        const remaining = getTaskTypeRemaining(taskType);
        return remaining === null || remaining > 0;
      }) ?? availableTaskTypes[0] ?? DEFAULT_TASK_TYPE,
    [availableTaskTypes, projectTotals, quotas, submittedSessionsByTaskType],
  );
  const claimTaskType = selectedTaskType ?? defaultTaskType;
  const claimTaskTypeRemaining = getTaskTypeRemaining(claimTaskType);
  const preferredSourceModelName = activeProject?.sourceModelFolder?.trim() || 'ORIGIN';

  useEffect(() => {
    if (selectedTaskType && !availableTaskTypes.includes(selectedTaskType)) {
      setSelectedTaskType(null);
    }
  }, [availableTaskTypes, selectedTaskType]);

  const selectedModels = models.filter((m) => m.checked);
  const selectedModelNames = selectedModels.map((m) => m.name);

  /* ─── Core clone logic ─── */

  const waitForJobCompletion = async (
    jobId: string,
    onUpdate?: (job: BackgroundJob) => void,
    timeoutMs = 900_000,
  ): Promise<BackgroundJob> => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const job = await getJob(jobId);
      if (job) {
        onUpdate?.(job);
        if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
          return job;
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 800));
    }

    throw new Error('等待拉取任务完成超时');
  };

  const runClonePlan = async (
    currentProject: GitLabProject,
    basePath: string,
    sourcePath: string,
    checkedModels: ModelEntry[],
    onStatusChange?: (modelId: string, status: ModelEntry['status']) => void,
  ): Promise<ClonePlanResult> => {
    const normalizedBasePath = basePath.replace(/\/+$/, '');
    const sourceModel = pickSourceModel(checkedModels, preferredSourceModelName);
    const normalizedSourcePath = sourcePath.replace(/\/+$/, '');

    const allTargetPaths = checkedModels.map((model) =>
      model.id === sourceModel.id
        ? normalizedSourcePath
        : `${normalizedBasePath}/${model.id}`,
    );
    const existingPaths = (await checkPathsExist(allTargetPaths)) ?? [];
    if (existingPaths.length > 0) {
      const names = existingPaths.map((p) => p.split('/').pop() || p).join(', ');
      throw new Error(`目录冲突：以下目录已存在: ${names}，请先删除或更换路径`);
    }

    const cloneUrl = currentProject.http_url_to_repo;
    if (!cloneUrl) throw new Error('该项目缺少 clone 地址 (http_url_to_repo)');

    setCloneProgressMsg('');
    onStatusChange?.(sourceModel.id, 'cloning');
    const copyTargets = checkedModels
      .filter((model) => model.id !== sourceModel.id)
      .map((model) => ({
        modelId: model.id,
        path: `${normalizedBasePath}/${model.id}`,
      }));

    const payload: GitClonePayload = {
      cloneUrl,
      sourcePath: normalizedSourcePath,
      sourceModelId: sourceModel.id,
      copyTargets,
    };

    const job = await submitJob({
      jobType: 'git_clone',
      taskId: '',
      inputPayload: JSON.stringify(payload),
      timeoutSeconds: 900,
    });
    void useAppStore.getState().loadBackgroundJobs();

    const finalJob = await waitForJobCompletion(job.id, (runningJob) => {
      setCloneProgressMsg(runningJob.progressMessage ?? '');
      if (runningJob.status !== 'running' && runningJob.status !== 'pending') {
        return;
      }

      const inCopyPhase = runningJob.progress >= 50;
      onStatusChange?.(sourceModel.id, inCopyPhase ? 'done' : 'cloning');
      for (const model of checkedModels) {
        if (model.id === sourceModel.id) continue;
        onStatusChange?.(model.id, inCopyPhase ? 'copying' : 'pending');
      }
    });

    setCloneProgressMsg('');
    void useAppStore.getState().loadBackgroundJobs();

    if (finalJob.status === 'error') {
      onStatusChange?.(sourceModel.id, 'error');
      throw new Error(finalJob.errorMessage || `${sourceModel.id}: 拉取失败`);
    }
    if (finalJob.status === 'cancelled') {
      onStatusChange?.(sourceModel.id, 'error');
      throw new Error('拉取任务已取消');
    }

    let result: GitCloneResult = {
      sourcePath: normalizedSourcePath,
      successfulModels: checkedModels.map((model) => model.id),
      failedModels: [],
    };

    if (finalJob.outputPayload) {
      try {
        result = JSON.parse(finalJob.outputPayload) as GitCloneResult;
      } catch (error) {
        throw new Error(`解析拉取结果失败: ${toErrorMessage(error)}`);
      }
    }

    for (const model of checkedModels) {
      const failed = result.failedModels.find((item) => item.modelId === model.id);
      if (failed) {
        onStatusChange?.(model.id, 'error');
        continue;
      }
      if (result.successfulModels.includes(model.id)) {
        onStatusChange?.(model.id, 'done');
      }
    }

    return {
      successfulModels: result.successfulModels,
      failedModels: result.failedModels,
    };
  };

  /* ─── Actions ─── */

  const handleSearch = async () => {
    const ids = parseProjectIds(rawInput);
    if (!ids.length) {
      setSearchError('请输入至少一个纯数字项目编号');
      return;
    }

    setIsSearching(true);
    setSearchError('');

    try {
      const gitLabSettings = await getGitLabSettings();
      if (!gitLabSettings.url || !gitLabSettings.hasToken) {
        setSearchError('请先在设置页面配置 GitLab URL 和 Token');
        return;
      }

      const results = await fetchConfiguredGitLabProjects(
        ids.map((id) => buildProjectRef(id)),
      );

      const resultMap = new Map(results.map((r) => [r.projectRef, r]));
      const mapped: ProjectLookup[] = ids.map((id) => {
        const lookup = resultMap.get(buildProjectRef(id));
        return {
          id,
          project: lookup?.project ?? undefined,
          error: lookup?.project ? undefined : (lookup?.error ?? '未找到项目'),
        };
      });

      setLookups(mapped);
      setPhase('review');
    } catch (error) {
      setSearchError(`查询失败: ${toErrorMessage(error)}`);
    } finally {
      setIsSearching(false);
    }
  };

  const validProjects = lookups.filter((l) => l.project);
  const requestedClaimCount = validProjects.length * claimSetCount;
  const maxClaimSetCount =
    claimTaskTypeRemaining !== null
      ? Math.max(1, Math.floor(claimTaskTypeRemaining / Math.max(1, validProjects.length)))
      : undefined;

  useEffect(() => {
    if (maxClaimSetCount !== undefined && claimSetCount > maxClaimSetCount) {
      setClaimSetCount(maxClaimSetCount);
    }
  }, [maxClaimSetCount]);

  // 超出配额的条目数：超出部分仍可提交，执行时逐条检查并告警跳过
  const overQuotaCount =
    claimTaskTypeRemaining !== null
      ? Math.max(0, requestedClaimCount - claimTaskTypeRemaining)
      : 0;
  const withinQuotaCount = requestedClaimCount - overQuotaCount;

  // 为 review 列表中的每个项目计算配额状态
  // projects 按顺序消耗配额，超出的打上 over_quota 标记
  const projectQuotaStatus = (() => {
    if (claimTaskTypeRemaining === null) return new Map<string, 'ok' | 'over_quota'>();
    let budget = claimTaskTypeRemaining;
    const map = new Map<string, 'ok' | 'over_quota'>();
    for (const proj of validProjects) {
      if (budget <= 0) {
        map.set(proj.id, 'over_quota');
      } else {
        map.set(proj.id, budget >= claimSetCount ? 'ok' : 'over_quota');
        budget -= claimSetCount;
      }
    }
    return map;
  })();

  const buildPlannedClaims = async (): Promise<PlannedClaim[]> => {
    const plannedGroups = await Promise.all(
      validProjects.map(async (lookup) => ({
        lookup,
        plans: await planManagedClaimPaths(
          defaultCloneRoot,
          lookup.project!.name,
          Number.parseInt(lookup.id, 10),
          claimTaskType,
          claimSetCount,
          activeConfigId ?? '',
        ),
      })),
    );

    return plannedGroups.flatMap(({ lookup, plans }) =>
      plans.map((plan) => ({
        lookup,
        plan,
        claimKey: `${lookup.id}:${plan.sequence}`,
        displayProjectId: formatClaimProjectId(lookup.id, plan.sequence),
      })),
    );
  };

  const handleClaim = async () => {
    if (!validProjects.length || !selectedModels.length) return;
    if (withinQuotaCount <= 0) return;

    setSearchError('');
    let startedRun = false;
    try {
      const gitLabSettings = await getGitLabSettings();
      if (!gitLabSettings.url || !gitLabSettings.hasToken) {
        throw new Error('请先在设置页面配置 GitLab URL 和 Token');
      }

      const allPlannedClaims = await buildPlannedClaims();

      // 在执行前按配额快照预切分，超出部分不会进入执行循环，从根本上防止误下载
      const budget = claimTaskTypeRemaining;
      const budgetExecutableClaims =
        budget !== null ? allPlannedClaims.slice(0, budget) : allPlannedClaims;
      const quotaExceededClaims =
        budget !== null ? allPlannedClaims.slice(budget) : [];
      const perProjectLimit = getTaskTypeQuotaValue(quotas, claimTaskType);
      const normalizedClaimTaskType = normalizeTaskTypeName(claimTaskType);
      const existingCounts = new Map<string, number>();

      for (const task of tasks) {
        if (normalizeTaskTypeName(task.taskType) !== normalizedClaimTaskType) continue;
        existingCounts.set(task.projectId, (existingCounts.get(task.projectId) ?? 0) + 1);
      }

      const { executableClaims, exceededClaims: taskTypeLimitExceededClaims } =
        partitionClaimsByProjectLimit(
          budgetExecutableClaims,
          (claim) => claim.lookup.id,
          existingCounts,
          perProjectLimit,
        );

      const sourceModelId = pickSourceModel(selectedModels, preferredSourceModelName).id;

      const makeResult = (
        { lookup, plan, claimKey, displayProjectId }: PlannedClaim,
        status: ClaimResult['status'],
        message: string,
      ): ClaimResult => ({
        claimKey,
        projectId: lookup.id,
        displayProjectId,
        projectName: lookup.project!.name,
        claimSequence: plan.sequence,
        localPath: plan.taskPath,
        status,
        message,
        modelStatuses: new Map(selectedModels.map((m) => [m.id, 'pending' as const])),
      });

      const initialResults: ClaimResult[] = [
        ...executableClaims.map((c) => makeResult(c, 'pending', '等待中')),
        ...taskTypeLimitExceededClaims.map((c) =>
          makeResult(c, 'quota_exceeded', '单题上限已达，跳过'),
        ),
        ...quotaExceededClaims.map((c) => makeResult(c, 'quota_exceeded', '配额已满，跳过')),
      ];

      setPhase('running');
      setClaimResults(initialResults);
      startedRun = true;

      let createdCount = 0;

      await runWithConcurrency(executableClaims, 3, async ({ lookup, plan, claimKey }) => {
        const project = lookup.project!;

        setClaimResults((prev) =>
          prev.map((r) =>
            r.claimKey === claimKey
              ? { ...r, status: 'running', message: '正在 clone 并初始化...' }
              : r,
          ),
        );

        try {
          const result = await runClonePlan(
            project,
            plan.taskPath,
            plan.sourcePath,
            selectedModels,
            (modelId, status) => {
              setClaimResults((prev) =>
                prev.map((r) => {
                  if (r.claimKey !== claimKey) return r;
                  const updated = new Map(r.modelStatuses);
                  updated.set(modelId, status);
                  return { ...r, modelStatuses: updated };
                }),
              );
            },
          );

          await createTask({
            gitlabProjectId: Number.parseInt(lookup.id, 10),
            projectName: project.name,
            taskType: claimTaskType,
            claimSequence: plan.sequence,
            localPath: plan.taskPath,
            sourceModelName: sourceModelId,
            sourceLocalPath: plan.sourcePath,
            models: result.successfulModels,
            projectConfigId: activeConfigId,
          });

          createdCount += 1;
          const isPartial = result.failedModels.length > 0;
          setClaimResults((prev) =>
            prev.map((r) =>
              r.claimKey === claimKey
                ? {
                    ...r,
                    status: isPartial ? 'partial' : 'done',
                    message: isPartial
                      ? `${result.successfulModels.length}/${selectedModels.length} 成功，失败：${result.failedModels.map((f) => f.modelId).join('，')}`
                      : `${result.successfulModels.length} 个副本已创建`,
                  }
                : r,
            ),
          );
        } catch (error) {
          setClaimResults((prev) =>
            prev.map((r) =>
              r.claimKey === claimKey
                ? { ...r, status: 'error', message: toErrorMessage(error) }
                : r,
            ),
          );
        }
      });

      if (createdCount > 0) await loadTasks();
    } catch (error) {
      if (!startedRun) {
        setSearchError(toErrorMessage(error));
        return;
      }
      setClaimResults((prev) =>
        prev.map((r) =>
          r.status === 'pending' ? { ...r, status: 'error', message: toErrorMessage(error) } : r,
        ),
      );
    }

    setPhase('done');
  };

  const handleDeleteModel = (id: string) => {
    if (isOriginModel(id)) return;
    setModels((prev) => prev.filter((m) => m.id !== id));
  };

  const handleAddModel = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed || models.some((m) => m.id === trimmed)) return;
    setModels((prev) => [...prev, { id: trimmed, name: trimmed, checked: true, status: 'pending' }]);
    setNewModelInput('');
    setAddingModel(false);
  };

  const resetForm = () => {
    setPhase('input');
    setRawInput('');
    setSearchError('');
    setLookups([]);
    setClaimResults([]);
    setCloneProgressMsg('');
    setAddingModel(false);
    setNewModelInput('');
    setClaimSetCount(1);
    setSelectedTaskType(null);
    setModels(
      storeCloneModels.map((m) => ({ ...m, checked: m.isDefault, status: 'pending' as const })),
    );
    // Re-fetch latest quotas
    if (activeProject) {
      getProjects().then((projects) => {
        const updated = projects.find((p) => p.id === activeProject.id);
        if (updated) setQuotas(getProjectTaskSettings(updated).quotas);
      }).catch(() => {});
    }
  };

  const getQuotaRemaining = (type: TaskType): number | null => {
    return getTaskTypeRemaining(type);
  };

  const hasAnyQuotaConfigured = availableTaskTypes.some(
    (taskType) => getTaskTypeQuotaValue(quotas, taskType) !== null,
  );

  /* ─── Styles ─── */

  const inputCls =
    'w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400 dark:placeholder:text-stone-600';
  const cardCls =
    'bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl p-6';
  const btnPrimary =
    'px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 cursor-default';
  const btnSecondary =
    'px-5 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors cursor-default';

  /* ─── Render ─── */

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50 tracking-tight">
          拉取项目
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
          输入一个或多个项目编号，从 GitLab 拉取并克隆到本地
        </p>
      </div>

      {/* ── Phase: Input ── */}
      {phase === 'input' && (
        <div className="space-y-5 animate-in fade-in duration-150">
          <section className={cardCls}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <label className="block text-sm font-semibold text-stone-700 dark:text-stone-300">
                项目编号
              </label>
              <button
                onClick={handleSearch}
                disabled={!rawInput.trim() || isSearching}
                className={btnPrimary}
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                查询
              </button>
            </div>

            <textarea
              rows={3}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSearch();
              }}
              placeholder={'输入项目编号，支持空格、逗号或换行分隔\n例如：1849 1850 1851'}
              className={`${inputCls} resize-none font-mono`}
            />

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-400 dark:text-stone-500">
              <span>
                根目录 <code className="font-mono text-stone-500 dark:text-stone-400">{defaultCloneRoot}</code>
              </span>
              <span className="flex items-center gap-1.5">
                模型
                {selectedModelNames.length > 0 ? (
                  selectedModelNames.map((name) => (
                    <span
                      key={name}
                      className="inline-block bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 px-2 py-0.5 rounded-lg font-mono text-[11px]"
                    >
                      {name}
                    </span>
                  ))
                ) : (
                  <span className="text-stone-400">暂无</span>
                )}
              </span>
            </div>

            {searchError && (
              <p className="mt-3 text-sm text-red-500 font-medium flex items-center gap-1.5">
                <X className="w-3.5 h-3.5 flex-shrink-0" />
                {searchError}
              </p>
            )}
          </section>

          {/* Task type selector */}
          <section className={cardCls}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
                任务类型
                <span className="ml-1.5 text-xs font-normal text-stone-400 dark:text-stone-500">
                  可选，默认使用首个可用类型
                </span>
              </h2>
              {selectedTaskType && (
                <button
                  onClick={() => setSelectedTaskType(null)}
                  className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-default"
                >
                  清除
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {availableTaskTypes.map((taskType) => {
                const presentation = getTaskTypePresentation(taskType);
                const remaining = getQuotaRemaining(presentation.value);
                const isSelected = selectedTaskType === presentation.value;
                const isDepleted = remaining !== null && remaining === 0;
                return (
                  <button
                    key={presentation.value}
                    onClick={() => setSelectedTaskType(isSelected ? null : presentation.value)}
                    disabled={isDepleted}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-default
                      ${isSelected
                        ? presentation.soft
                        : isDepleted
                          ? 'bg-stone-50 dark:bg-stone-800/30 text-stone-300 dark:text-stone-600 border-stone-200 dark:border-stone-700/50 opacity-50'
                          : 'bg-stone-50 dark:bg-stone-800/50 text-stone-600 dark:text-stone-400 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                      }`}
                  >
                    {presentation.label}
                    {remaining !== null && (
                      <span className={`text-[10px] font-bold ml-0.5 ${isSelected ? 'opacity-80' : 'text-stone-400 dark:text-stone-500'}`}>
                        ×{remaining}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {!hasAnyQuotaConfigured && (
              <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                项目未配置任务配额，可自由选择类型。
              </p>
            )}
            {hasAnyQuotaConfigured && (
              <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                留空表示不限；数字按总计减已提交计算，显示为 0 表示该类型已经完成。
              </p>
            )}
          </section>
        </div>
      )}

      {/* ── Phase: Review & Configure ── */}
      {phase === 'review' && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {/* Project lookup results — compact list */}
          <section className={cardCls}>
            <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">
              查询结果
              <span className="ml-2 text-stone-400 font-normal">
                {validProjects.length} 个可用 / {lookups.length} 个总计
              </span>
            </h2>
            <div className="max-h-64 overflow-y-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <tbody>
                  {lookups.map((lookup) => {
                    const quotaStatus = projectQuotaStatus.get(lookup.id);
                    const isOverQuota = lookup.project && quotaStatus === 'over_quota';
                    return (
                      <tr
                        key={lookup.id}
                        className={`border-b border-stone-100 dark:border-stone-800 last:border-b-0 ${
                          lookup.error ? 'text-red-500 dark:text-red-400' : ''
                        }`}
                      >
                        <td className="py-2 pr-3 font-mono text-xs text-stone-400 w-12 tabular-nums">
                          {lookup.id}
                        </td>
                        <td className="py-2 pr-3 truncate max-w-0">
                          {lookup.project ? (
                            <span className={`font-medium ${isOverQuota ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-200'}`}>
                              {lookup.project.name}
                            </span>
                          ) : (
                            <span className="text-red-500 dark:text-red-400 text-xs">{lookup.error}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs text-stone-400 dark:text-stone-500 hidden sm:table-cell w-24">
                          {lookup.project && (
                            <span className="flex items-center gap-1">
                              <GitFork className="w-3 h-3 flex-shrink-0" />
                              {lookup.project.default_branch || 'N/A'}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right w-20">
                          {lookup.project ? (
                            isOverQuota ? (
                              <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400">
                                配额不足
                              </span>
                            ) : (
                              <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                                可用
                              </span>
                            )
                          ) : (
                            <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                              失败
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Clone configuration */}
          {validProjects.length > 0 && (
            <section className={cardCls}>
              <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 mb-4">
                Clone 配置
              </h2>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px] mb-5">
                <div>
                  <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                    根目录
                  </label>
                  <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-stone-700/50">
                    <Folder className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                    <code className="text-sm font-mono text-stone-700 dark:text-stone-300 truncate">
                      {defaultCloneRoot}
                    </code>
                  </div>
                  <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                    每个项目会在根目录下创建 <code className="font-mono">label-xxxxx-任务类型/</code>，源码目录默认命名为 <code className="font-mono">题号-任务类型</code>；多套或同名已存在时会自动追加 <code className="font-mono">-1/-2/...</code>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                    领题套数
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={maxClaimSetCount}
                    step={1}
                    value={claimSetCount}
                    onChange={(event) => {
                      const nextValue = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(nextValue) || nextValue < 1) {
                        setClaimSetCount(1);
                        return;
                      }
                      setClaimSetCount(
                        maxClaimSetCount !== undefined
                          ? Math.min(nextValue, maxClaimSetCount)
                          : nextValue,
                      );
                    }}
                    className={`${inputCls} font-mono`}
                  />
                  <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                    每个项目会按这个数量连续领题。
                  </p>
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1.5">
                  本次预计创建
                </label>
                <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-stone-700/50 text-sm text-stone-700 dark:text-stone-300">
                  <span className="font-semibold">{validProjects.length}</span>
                  <span>个项目</span>
                  <span className="text-stone-300 dark:text-stone-600">×</span>
                  <span className="font-semibold">{claimSetCount}</span>
                  <span>套</span>
                  <span className="text-stone-300 dark:text-stone-600">=</span>
                  <span className="font-semibold">{requestedClaimCount}</span>
                  <span>个领题任务</span>
                  {overQuotaCount > 0 && (
                    <span className="ml-1 text-orange-500 dark:text-orange-400 font-semibold">
                      （超出 {overQuotaCount} 套）
                    </span>
                  )}
                </div>
                {overQuotaCount > 0 && (
                  <p className="mt-2 text-xs text-orange-500 dark:text-orange-400 flex items-start gap-1.5">
                    <span className="flex-shrink-0">⚠</span>
                    <span>
                      配额剩余 {claimTaskTypeRemaining} 套，超出的 {overQuotaCount} 套将被跳过，不会下载文件。
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">
                  Clone 副本
                </label>
                <div className="space-y-1.5">
                  {models.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 group"
                    >
                      <input
                        type="checkbox"
                        checked={model.checked}
                        onChange={(e) =>
                          setModels((prev) =>
                            prev.map((m) =>
                              m.id === model.id ? { ...m, checked: e.target.checked } : m,
                            ),
                          )
                        }
                        disabled={isOriginModel(model.id)}
                        className="w-4 h-4 rounded border-stone-300 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
                      />
                      <Terminal className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                      <span className="font-mono text-sm flex-1 text-stone-700 dark:text-stone-300">
                        {model.name}
                      </span>
                      <button
                        onClick={() => handleDeleteModel(model.id)}
                        disabled={isOriginModel(model.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-stone-400 hover:text-red-500 transition-all disabled:opacity-0 cursor-default"
                        aria-label={`删除 ${model.name}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {addingModel ? (
                    <div className="flex items-center gap-2 px-1 pt-1">
                      <input
                        type="text"
                        value={newModelInput}
                        onChange={(e) => setNewModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddModel();
                          if (e.key === 'Escape') {
                            setAddingModel(false);
                            setNewModelInput('');
                          }
                        }}
                        placeholder="模型名，例如：cotv22-pro"
                        autoFocus
                        className={`${inputCls} flex-1 font-mono`}
                      />
                      <button
                        onClick={handleAddModel}
                        className="px-3 py-2 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] text-sm rounded-full font-semibold transition-colors cursor-default"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => {
                          setAddingModel(false);
                          setNewModelInput('');
                        }}
                        className="px-3 py-2 text-sm text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 rounded-xl transition-colors cursor-default"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingModel(true)}
                      className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 px-1 py-1.5 transition-colors cursor-default"
                    >
                      <Plus className="w-4 h-4" />
                      添加模型副本
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-5 mt-5 border-t border-stone-100 dark:border-stone-800">
                <div className="mb-3 text-xs text-stone-500 dark:text-stone-400">
                  当前将按
                  <span className="mx-1 font-semibold text-stone-700 dark:text-stone-300">
                    {getTaskTypePresentation(claimTaskType).label}
                  </span>
                  领题
                  {claimTaskTypeRemaining !== null && (
                    <span className="ml-1 text-stone-400 dark:text-stone-500">
                      · 待完成 {claimTaskTypeRemaining} 套
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      setPhase('input');
                      setLookups([]);
                      setSearchError('');
                    }}
                    className={btnSecondary}
                  >
                    返回修改
                  </button>
                  <button
                    onClick={handleClaim}
                    disabled={selectedModels.length === 0 || withinQuotaCount <= 0}
                    className={btnPrimary}
                  >
                    <Rocket className="w-4 h-4" />
                    开始领题
                    {withinQuotaCount > 0 && (
                      <span className="bg-white/20 dark:bg-black/20 px-1.5 py-0.5 rounded-md text-xs">
                        {withinQuotaCount}
                      </span>
                    )}
                  </button>
                </div>
                {withinQuotaCount <= 0 && claimTaskTypeRemaining !== null && (
                  <p className="mt-3 text-xs text-orange-500 dark:text-orange-400">
                    ⚠ 配额已耗尽，请返回选择其他任务类型。
                  </p>
                )}
                {searchError && (
                  <p className="mt-3 text-xs text-red-500 dark:text-red-400">{searchError}</p>
                )}
              </div>
            </section>
          )}

          {/* All lookups failed */}
          {validProjects.length === 0 && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => {
                  setPhase('input');
                  setLookups([]);
                  setSearchError('');
                }}
                className={btnSecondary}
              >
                返回修改
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Phase: Running ── */}
      {phase === 'running' && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className={cardCls}>
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">
              <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              {(() => {
                const executing = claimResults.filter((r) => r.status !== 'quota_exceeded').length;
                const skipped = claimResults.filter((r) => r.status === 'quota_exceeded').length;
                return skipped > 0
                  ? `正在执行 ${executing} 套，${skipped} 套因配额跳过...`
                  : `正在执行 ${executing} 套...`;
              })()}
            </div>
            {cloneProgressMsg && (
              <p className="text-xs font-mono text-stone-500 dark:text-stone-400 truncate mb-3" title={cloneProgressMsg}>
                {cloneProgressMsg}
              </p>
            )}
            <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-1">
              {claimResults.map((result) => (
                <RunningRow key={result.claimKey} result={result} selectedModels={selectedModels} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Phase: Done ── */}
      {phase === 'done' && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <DoneSummary results={claimResults} />

          {claimResults.length > 0 && (
            <div className={cardCls}>
              <div className="max-h-64 overflow-y-auto -mx-1 px-1">
                <table className="w-full text-sm">
                  <tbody>
                    {claimResults.map((r) => {
                      const meta = getResultStatusMeta(r.status);
                      return (
                        <tr key={r.claimKey} className="border-b border-stone-100 dark:border-stone-800 last:border-b-0">
                          <td className="py-2 pr-3 font-mono text-xs text-stone-400 w-20 tabular-nums">
                            {r.displayProjectId}
                          </td>
                          <td className="py-2 pr-3 font-medium text-stone-800 dark:text-stone-200 truncate max-w-0">
                            {r.projectName}
                          </td>
                          <td className="py-2 pr-3 text-xs text-stone-500 dark:text-stone-400 hidden sm:table-cell">
                            {r.message}
                          </td>
                          <td className="py-2 text-right w-16">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${meta.className}`}>
                              {meta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-center gap-3 pt-2">
            <button onClick={() => navigate('/')} className={btnSecondary}>
              返回看板
            </button>
            <button onClick={resetForm} className={btnPrimary}>
              继续领题 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
