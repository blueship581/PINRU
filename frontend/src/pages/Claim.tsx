import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
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
import { useAppStore } from '../store';
import {
  copyProjectDirectory,
  cloneProject,
  checkPathsExist,
  onCloneProgress,
  fetchGitLabProjects,
  type GitLabProject,
} from '../services/git';
import { createTask } from '../services/task';
import {
  buildProjectTaskTypes,
  consumeProjectQuota,
  DEFAULT_TASK_TYPES,
  getActiveProjectId,
  getConfig,
  getProjects,
  getTaskTypePresentation,
  getTaskTypeQuotaValue,
  normalizeProjectModels,
  parseTaskTypeQuotas,
  type ProjectConfig,
  type TaskType,
  type TaskTypeQuotas,
} from '../services/config';
import { buildManagedSourceFolderPath } from '../lib/sourceFolders';

/* ─── Types ─── */

type ModelEntry = {
  id: string;
  name: string;
  checked: boolean;
  status: 'pending' | 'cloning' | 'copying' | 'done' | 'error';
};

type ProjectLookup = {
  id: string;
  project?: GitLabProject;
  error?: string;
};

type ClaimResult = {
  projectId: string;
  projectName: string;
  localPath: string;
  status: 'pending' | 'running' | 'done' | 'partial' | 'error';
  message: string;
  modelStatuses: Map<string, ModelEntry['status']>;
};

type ClonePlanResult = {
  successfulModels: string[];
  failedModels: Array<{ modelId: string; message: string }>;
};

type Phase = 'input' | 'review' | 'running' | 'done';

/* ─── Component ─── */

export default function Claim() {
  const navigate = useNavigate();
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
      await loadCloneModels();
      const [activeProjectId, projects] = await Promise.all([getActiveProjectId(), getProjects()]);
      const proj = projects.find((p) => p.id === activeProjectId) ?? projects[0];
      if (proj) {
        setActiveConfigId(proj.id);
        setActiveProject(proj);
        setDefaultCloneRoot(proj.cloneBasePath);
        setQuotas(parseTaskTypeQuotas(proj.taskTypeQuotas));
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
  }, [loadCloneModels]);

  const availableTaskTypes = useMemo(
    () => buildProjectTaskTypes(activeProject, selectedTaskType ? [selectedTaskType] : []),
    [activeProject, selectedTaskType],
  );
  const defaultTaskType = useMemo(
    () =>
      availableTaskTypes.find((taskType) => {
        const remaining = getTaskTypeQuotaValue(quotas, taskType);
        return remaining === null || remaining > 0;
      }) ?? availableTaskTypes[0] ?? DEFAULT_TASK_TYPES[0],
    [availableTaskTypes, quotas],
  );
  const claimTaskType = selectedTaskType ?? defaultTaskType;
  const claimTaskTypeRemaining = getTaskTypeQuotaValue(quotas, claimTaskType);
  const isClaimQuotaBlocked = claimTaskTypeRemaining !== null && claimTaskTypeRemaining <= 0;
  const preferredSourceModelName = activeProject?.sourceModelFolder?.trim() || 'ORIGIN';

  useEffect(() => {
    if (selectedTaskType && !availableTaskTypes.includes(selectedTaskType)) {
      setSelectedTaskType(null);
    }
  }, [availableTaskTypes, selectedTaskType]);

  const selectedModels = models.filter((m) => m.checked);
  const selectedModelNames = selectedModels.map((m) => m.name);

  /* ─── Helpers ─── */

  const formatProjectName = (v: string) => `label-${v.padStart(5, '0')}`;
  const buildProjectRef = (v: string) => `prompt2repo/${formatProjectName(v)}`;
  const buildProjectBasePath = (projectName: string, root = defaultCloneRoot) => {
    const norm = root.replace(/\/+$/, '');
    return norm ? `${norm}/${projectName}-comparison` : `${projectName}-comparison`;
  };

  /* ─── Core clone logic (unchanged) ─── */

  const runClonePlan = async (
    currentProject: GitLabProject,
    basePath: string,
    checkedModels: ModelEntry[],
    gitlabToken: string,
    onStatusChange?: (modelId: string, status: ModelEntry['status']) => void,
  ): Promise<ClonePlanResult> => {
    const normalizedBasePath = basePath.replace(/\/+$/, '');
    const sourceModel = pickSourceModel(checkedModels, preferredSourceModelName);
    const sourcePath = buildManagedSourceFolderPath(normalizedBasePath, currentProject.name);
    const successfulModels: string[] = [];
    const failedModels: Array<{ modelId: string; message: string }> = [];

    const allTargetPaths = checkedModels.map((model) =>
      model.id === sourceModel.id
        ? sourcePath
        : `${normalizedBasePath}/${model.id}`,
    );
    const existingPaths = (await checkPathsExist(allTargetPaths)) ?? [];
    if (existingPaths.length > 0) {
      const names = existingPaths.map((p) => p.split('/').pop() || p).join(', ');
      throw new Error(`目录冲突：以下目录已存在: ${names}，请先删除或更换路径`);
    }

    const cloneUrl = currentProject.http_url_to_repo;
    if (!cloneUrl) throw new Error('该项目缺少 clone 地址 (http_url_to_repo)');

    const gitlabUsername = (await getConfig('gitlab_username')) || 'oauth2';

    setCloneProgressMsg('');
    const unlisten = await onCloneProgress((msg) => setCloneProgressMsg(msg));

    onStatusChange?.(sourceModel.id, 'cloning');
    try {
      await cloneProject(cloneUrl, sourcePath, gitlabUsername, gitlabToken);
      successfulModels.push(sourceModel.id);
      onStatusChange?.(sourceModel.id, 'done');
    } catch (error) {
      onStatusChange?.(sourceModel.id, 'error');
      throw new Error(`${sourceModel.id}: ${toErrorMessage(error)}`);
    } finally {
      unlisten();
      setCloneProgressMsg('');
    }

    for (const model of checkedModels) {
      if (model.id === sourceModel.id) continue;
      onStatusChange?.(model.id, 'copying');
      try {
        await copyProjectDirectory(sourcePath, `${normalizedBasePath}/${model.id}`);
        successfulModels.push(model.id);
        onStatusChange?.(model.id, 'done');
      } catch (error) {
        onStatusChange?.(model.id, 'error');
        failedModels.push({ modelId: model.id, message: toErrorMessage(error) });
      }
    }

    return { successfulModels, failedModels };
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
      const [gitlabUrl, gitlabToken] = await Promise.all([
        getConfig('gitlab_url'),
        getConfig('gitlab_token'),
      ]);
      if (!gitlabUrl || !gitlabToken) {
        setSearchError('请先在设置页面配置 GitLab URL 和 Token');
        return;
      }

      const results = await fetchGitLabProjects(
        ids.map((id) => buildProjectRef(id)),
        gitlabUrl,
        gitlabToken,
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

  const handleClaim = async () => {
    if (!validProjects.length || !selectedModels.length) return;
    if (isClaimQuotaBlocked) return;

    setPhase('running');
    const initialResults: ClaimResult[] = validProjects.map((l) => ({
      projectId: l.id,
      projectName: l.project!.name,
      localPath: buildProjectBasePath(l.project!.name),
      status: 'pending',
      message: '等待中',
      modelStatuses: new Map(selectedModels.map((m) => [m.id, 'pending' as const])),
    }));
    setClaimResults(initialResults);

    try {
      const [gitlabUrl, gitlabToken] = await Promise.all([
        getConfig('gitlab_url'),
        getConfig('gitlab_token'),
      ]);
      if (!gitlabUrl || !gitlabToken) throw new Error('请先在设置页面配置 GitLab URL 和 Token');

      let createdCount = 0;

      for (const lookup of validProjects) {
        const project = lookup.project!;
        const basePath = buildProjectBasePath(project.name);

        setClaimResults((prev) =>
          prev.map((r) =>
            r.projectId === lookup.id
              ? { ...r, status: 'running', message: '正在 clone 源码并复制副本...' }
              : r,
          ),
        );

        try {
          const result = await runClonePlan(
            project,
            basePath,
            selectedModels,
            gitlabToken,
            (modelId, status) => {
              setClaimResults((prev) =>
                prev.map((r) => {
                  if (r.projectId !== lookup.id) return r;
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
            localPath: basePath,
            sourceModelName: pickSourceModel(selectedModels, preferredSourceModelName).id,
            sourceLocalPath: buildManagedSourceFolderPath(basePath, project.name),
            models: result.successfulModels,
            projectConfigId: activeConfigId,
          });

          // Consume quota if task type has a configured quota
          if (activeConfigId) {
            const currentQuota = getTaskTypeQuotaValue(quotas, claimTaskType);
            if (currentQuota !== null && currentQuota > 0) {
              try {
                await consumeProjectQuota(activeConfigId, claimTaskType);
                setQuotas((prev) => ({
                  ...prev,
                  [claimTaskType]: Math.max(0, (getTaskTypeQuotaValue(prev, claimTaskType) ?? 0) - 1),
                }));
              } catch {
                // Non-fatal: quota decrement failed, continue
              }
            }
          }

          createdCount += 1;
          const isPartial = result.failedModels.length > 0;
          setClaimResults((prev) =>
            prev.map((r) =>
              r.projectId === lookup.id
                ? {
                    ...r,
                    status: isPartial ? 'partial' : 'done',
                    message: isPartial
                      ? `成功 ${result.successfulModels.length}/${selectedModels.length}；失败：${result.failedModels.map((f) => f.modelId).join('，')}`
                      : `成功 ${result.successfulModels.length}/${selectedModels.length} 个副本`,
                  }
                : r,
            ),
          );
        } catch (error) {
          setClaimResults((prev) =>
            prev.map((r) =>
              r.projectId === lookup.id
                ? { ...r, status: 'error', message: toErrorMessage(error) }
                : r,
            ),
          );
        }
      }

      if (createdCount > 0) await loadTasks();
    } catch (error) {
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
    setSelectedTaskType(null);
    setModels(
      storeCloneModels.map((m) => ({ ...m, checked: m.isDefault, status: 'pending' as const })),
    );
    // Re-fetch latest quotas
    if (activeProject) {
      getProjects().then((projects) => {
        const updated = projects.find((p) => p.id === activeProject.id);
        if (updated) setQuotas(parseTaskTypeQuotas(updated.taskTypeQuotas));
      }).catch(() => {});
    }
  };

  const getQuotaRemaining = (type: TaskType): number | null => {
    return getTaskTypeQuotaValue(quotas, type);
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
                留空表示不限；显示为 0 的类型表示当前配额已用尽。
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
                  {lookups.map((lookup) => (
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
                          <span className="font-medium text-stone-800 dark:text-stone-200">
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
                      <td className="py-2 text-right w-14">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${
                            lookup.project
                              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                          }`}
                        >
                          {lookup.project ? '可用' : '失败'}
                        </span>
                      </td>
                    </tr>
                  ))}
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

              <div className="mb-5">
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
                  每个项目会在根目录下创建 <code className="font-mono">[项目名]-comparison/</code>，源码目录默认命名为对应 GitLab 项目名
                </p>
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
                <div className="mb-3 flex items-center justify-between gap-3 text-xs">
                  <span className="text-stone-500 dark:text-stone-400">
                    当前将按
                    <span className="mx-1 font-semibold text-stone-700 dark:text-stone-300">
                      {getTaskTypePresentation(claimTaskType).label}
                    </span>
                    领题
                    {claimTaskTypeRemaining !== null && (
                      <span className="ml-1 text-stone-400 dark:text-stone-500">
                        剩余 {claimTaskTypeRemaining}
                      </span>
                    )}
                  </span>
                  {isClaimQuotaBlocked && (
                    <span className="text-red-500 dark:text-red-400">
                      当前类型配额已用尽，请返回修改
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setPhase('input');
                    setLookups([]);
                  }}
                  className={btnSecondary}
                >
                  返回修改
                </button>
                <button
                  onClick={handleClaim}
                  disabled={selectedModels.length === 0 || isClaimQuotaBlocked}
                  className={btnPrimary}
                >
                  <Rocket className="w-4 h-4" />
                  开始领题
                  {validProjects.length > 1 && (
                    <span className="bg-white/20 dark:bg-black/20 px-1.5 py-0.5 rounded-md text-xs">
                      {validProjects.length}
                    </span>
                  )}
                </button>
                </div>
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
              正在处理 {claimResults.length} 个项目...
            </div>
            {cloneProgressMsg && (
              <p className="text-xs font-mono text-stone-500 dark:text-stone-400 truncate mb-3" title={cloneProgressMsg}>
                {cloneProgressMsg}
              </p>
            )}
            <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-1">
              {claimResults.map((result) => (
                <RunningRow key={result.projectId} result={result} selectedModels={selectedModels} />
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
                        <tr key={r.projectId} className="border-b border-stone-100 dark:border-stone-800 last:border-b-0">
                          <td className="py-2 pr-3 font-mono text-xs text-stone-400 w-12 tabular-nums">
                            {r.projectId}
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

/* ─── Sub-components ─── */

function DoneSummary({ results }: { results: ClaimResult[] }) {
  const doneCount = results.filter((r) => r.status === 'done' || r.status === 'partial').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const allSuccess = errorCount === 0;

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl p-6 text-center">
      <div
        className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 ${
          allSuccess
            ? 'bg-emerald-100 dark:bg-emerald-500/15'
            : 'bg-amber-100 dark:bg-amber-500/15'
        }`}
      >
        {allSuccess ? (
          <Check className="w-7 h-7 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
        ) : (
          <span className="text-xl font-bold text-amber-600 dark:text-amber-400">!</span>
        )}
      </div>
      <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50 mb-1.5 tracking-tight">
        {allSuccess ? '全部完成' : '部分完成'}
      </h2>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        {doneCount > 0 && `${doneCount} 个项目已创建任务`}
        {doneCount > 0 && errorCount > 0 && '，'}
        {errorCount > 0 && `${errorCount} 个失败`}
      </p>
    </div>
  );
}

function RunningRow({
  result,
  selectedModels,
}: {
  key?: string | number;
  result: ClaimResult;
  selectedModels: ModelEntry[];
}) {
  const meta = getResultStatusMeta(result.status);
  const isRunning = result.status === 'running';
  const [expanded, setExpanded] = useState(isRunning);

  useEffect(() => {
    if (isRunning) setExpanded(true);
  }, [isRunning]);

  return (
    <div className="rounded-2xl border border-stone-100 dark:border-stone-700/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800/30 transition-colors cursor-default"
      >
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 flex-shrink-0" />
        ) : expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
        )}
        <span className="font-mono text-xs text-stone-400 tabular-nums">{result.projectId}</span>
        <span className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate flex-1">
          {result.projectName}
        </span>
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider flex-shrink-0 ${meta.className}`}>
          {meta.label}
        </span>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3 pt-0 space-y-1.5 border-t border-stone-100 dark:border-stone-800">
          {selectedModels.map((model) => {
            const status = result.modelStatuses.get(model.id) ?? 'pending';
            return (
              <div key={model.id} className="flex items-center gap-2 py-0.5">
                <div className="h-1 flex-1 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${getModelStatusBarClassName(status)}`} />
                </div>
                <span className="font-mono text-[11px] text-stone-400 w-20 text-right truncate">{model.id}</span>
                <span className={`text-[11px] w-20 text-right ${getModelStatusClassName(status)}`}>
                  {getModelStatusLabel(status)}
                </span>
              </div>
            );
          })}
          {result.status !== 'pending' && result.status !== 'running' && (
            <p className="text-xs text-stone-500 dark:text-stone-400 pt-1">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Pure helpers ─── */

function parseProjectIds(value: string): string[] {
  const tokens = value
    .split(/[\s,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token) || seen.has(token)) continue;
    seen.add(token);
    ids.push(token);
  }
  return ids;
}

function isOriginModel(value: string): boolean {
  return value.trim().toUpperCase() === 'ORIGIN';
}

function pickSourceModel(models: ModelEntry[], preferredSourceModelName: string): ModelEntry {
  return (
    models.find((model) => model.id.trim().toUpperCase() === preferredSourceModelName.trim().toUpperCase()) ??
    models.find((model) => isOriginModel(model.id)) ??
    models[0]
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return String(error);
}

function getModelStatusLabel(status: ModelEntry['status']): string {
  switch (status) {
    case 'done': return '✓ 完成';
    case 'cloning': return 'git clone 中…';
    case 'copying': return '本地复制中…';
    case 'error': return '✗ 失败';
    default: return '等待';
  }
}

function getModelStatusClassName(status: ModelEntry['status']): string {
  switch (status) {
    case 'done': return 'text-emerald-600 dark:text-emerald-400';
    case 'cloning':
    case 'copying': return 'text-slate-700 dark:text-slate-300';
    case 'error': return 'text-red-500';
    default: return 'text-stone-400';
  }
}

function getModelStatusBarClassName(status: ModelEntry['status']): string {
  switch (status) {
    case 'cloning':
    case 'copying': return 'w-full bg-slate-500 animate-pulse';
    case 'done': return 'w-full bg-emerald-500';
    case 'error': return 'w-full bg-red-400';
    default: return 'w-0';
  }
}

function getResultStatusMeta(status: ClaimResult['status']): { label: string; className: string } {
  switch (status) {
    case 'running':
      return { label: '处理中', className: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' };
    case 'done':
      return { label: '完成', className: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' };
    case 'partial':
      return { label: '部分完成', className: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400' };
    case 'error':
      return { label: '失败', className: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' };
    default:
      return { label: '等待中', className: 'bg-stone-100 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400' };
  }
}
