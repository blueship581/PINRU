import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
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
  fetchGitLabProject,
  fetchGitLabProjects,
  type GitLabProject,
} from '../services/git';
import { createTask } from '../services/task';
import { getActiveProjectId, getConfig, getProjects } from '../services/config';

type ModelEntry = {
  id: string;
  name: string;
  checked: boolean;
  status: 'pending' | 'cloning' | 'copying' | 'done' | 'error';
};

type BatchClaimStatus = 'pending' | 'running' | 'done' | 'partial' | 'error';

type BatchClaimResult = {
  projectId: string;
  projectName: string;
  localPath: string;
  status: BatchClaimStatus;
  message: string;
  successfulModels: number;
  totalModels: number;
};

type ClonePlanResult = {
  successfulModels: string[];
  failedModels: Array<{ modelId: string; message: string }>;
};

export default function Claim() {
  const navigate = useNavigate();
  const loadTasks = useAppStore((state) => state.loadTasks);
  const storeCloneModels = useAppStore((state) => state.cloneModels);
  const loadCloneModels = useAppStore((state) => state.loadCloneModels);

  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState('');
  const [batchProjectIds, setBatchProjectIds] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [cloneError, setCloneError] = useState('');
  const [claimSummary, setClaimSummary] = useState('');
  const [batchError, setBatchError] = useState('');
  const [batchResults, setBatchResults] = useState<BatchClaimResult[]>([]);

  const [project, setProject] = useState<GitLabProject | null>(null);
  const [localPath, setLocalPath] = useState('');
  const [defaultCloneRoot, setDefaultCloneRoot] = useState('~/repositories/gitlab/评审项目/project/generate');

  const [models, setModels] = useState<ModelEntry[]>(
    storeCloneModels.map((model) => ({
      ...model,
      checked: model.isDefault,
      status: 'pending' as const,
    })),
  );

  const [addingModel, setAddingModel] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  const [cloneProgressMsg, setCloneProgressMsg] = useState('');

  useEffect(() => {
    setModels(
      storeCloneModels.map((model) => ({
        ...model,
        checked: model.isDefault,
        status: 'pending' as const,
      })),
    );
  }, [storeCloneModels]);

  useEffect(() => {
    (async () => {
      await loadCloneModels();
      const [activeProjectId, projects, configuredCloneRoot] = await Promise.all([
        getActiveProjectId(),
        getProjects(),
        getConfig('default_clone_path'),
      ]);

      const activeProject = projects.find((item) => item.id === activeProjectId) ?? projects[0];
      if (activeProject) {
        setDefaultCloneRoot(activeProject.basePath);
        setModels(
          activeProject.models.map((name) => ({
            id: name,
            name,
            checked: true,
            status: 'pending' as const,
          })),
        );
        return;
      }

      if (configuredCloneRoot?.trim()) {
        setDefaultCloneRoot(configuredCloneRoot.trim());
      }
    })();
  }, [loadCloneModels]);

  const selectedModels = models.filter((model) => model.checked);
  const selectedModelNames = selectedModels.map((model) => model.name);

  const formatProjectName = (value: string) => `label-${value.padStart(5, '0')}`;
  const buildProjectRef = (value: string) => `prompt2repo/${formatProjectName(value)}`;
  const buildProjectBasePath = (projectName: string, root = defaultCloneRoot) => {
    const normalizedRoot = root.replace(/\/+$/, '');
    return normalizedRoot ? `${normalizedRoot}/${projectName}-comparison` : `${projectName}-comparison`;
  };

  const updateBatchResult = (projectIdValue: string, patch: Partial<BatchClaimResult>) => {
    setBatchResults((current) =>
      current.map((item) => (item.projectId === projectIdValue ? { ...item, ...patch } : item)),
    );
  };

  const runClonePlan = async (
    currentProject: GitLabProject,
    basePath: string,
    checkedModels: ModelEntry[],
    gitlabUrl: string,
    gitlabToken: string,
    onStatusChange?: (modelId: string, status: ModelEntry['status']) => void,
  ): Promise<ClonePlanResult> => {
    const normalizedBasePath = basePath.replace(/\/+$/, '');
    const sourceModel = checkedModels.find((model) => isOriginModel(model.id)) ?? checkedModels[0];
    const sourcePath = `${normalizedBasePath}/${sourceModel.id}`;
    const successfulModels: string[] = [];
    const failedModels: Array<{ modelId: string; message: string }> = [];

    // Pre-check: detect directory conflicts for ALL models before starting
    const allTargetPaths = checkedModels.map((model) => `${normalizedBasePath}/${model.id}`);
    const existingPaths = await checkPathsExist(allTargetPaths);
    if (existingPaths.length > 0) {
      const names = existingPaths.map((p) => p.split('/').pop() || p).join(', ');
      throw new Error(`目录冲突：以下目录已存在: ${names}，请先删除或更换路径`);
    }

    // Resolve clone URL from project
    const cloneUrl = currentProject.http_url_to_repo;
    if (!cloneUrl) {
      throw new Error('该项目缺少 clone 地址 (http_url_to_repo)');
    }

    // Retrieve gitlab username for clone auth
    const gitlabUsername = (await getConfig('gitlab_username')) || 'oauth2';

    // Subscribe to clone progress events
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
        failedModels.push({
          modelId: model.id,
          message: toErrorMessage(error),
        });
      }
    }

    return { successfulModels, failedModels };
  };

  const handleSearch = async () => {
    const ids = parseProjectIds(projectId);
    if (!ids.length) {
      setErrorMsg('请输入纯数字项目编号，例如 1849');
      return;
    }

    setIsSearching(true);
    setErrorMsg('');

    try {
      if (ids.length > 1) {
        setErrorMsg('单项目流程只支持一个编号；多个项目请使用上方的批量领题。');
        return;
      }

      const rawProjectId = ids[0];
      const [gitlabUrl, gitlabToken] = await Promise.all([
        getConfig('gitlab_url'),
        getConfig('gitlab_token'),
      ]);

      if (!gitlabUrl || !gitlabToken) {
        setErrorMsg('请先在设置页面配置 GitLab URL 和 Token');
        return;
      }

      const projectRef = buildProjectRef(rawProjectId);
      const resolvedProject = await fetchGitLabProject(projectRef, gitlabUrl, gitlabToken);
      setProject(resolvedProject);
      setLocalPath(buildProjectBasePath(formatProjectName(rawProjectId)));
      setStep(2);
    } catch (error) {
      setErrorMsg(`查询失败: ${toErrorMessage(error)}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleBatchClaim = async () => {
    const ids = parseProjectIds(batchProjectIds);
    if (!ids.length) {
      setBatchError('请至少输入一个项目编号');
      return;
    }

    if (!selectedModels.length) {
      setBatchError('请至少保留一个模型副本');
      return;
    }

    if (!defaultCloneRoot.trim()) {
      setBatchError('当前未配置默认下载目录，请先在项目设置中配置');
      return;
    }

    setIsBatchRunning(true);
    setBatchError('');
    setBatchResults(
      ids.map((id) => ({
        projectId: id,
        projectName: formatProjectName(id),
        localPath: buildProjectBasePath(formatProjectName(id)),
        status: 'pending',
        message: '等待查询 GitLab 项目',
        successfulModels: 0,
        totalModels: selectedModels.length,
      })),
    );

    try {
      const [gitlabUrl, gitlabToken] = await Promise.all([
        getConfig('gitlab_url'),
        getConfig('gitlab_token'),
      ]);

      if (!gitlabUrl || !gitlabToken) {
        setBatchError('请先在设置页面配置 GitLab URL 和 Token');
        return;
      }

      const lookupResults = await fetchGitLabProjects(
        ids.map((id) => buildProjectRef(id)),
        gitlabUrl,
        gitlabToken,
      );
      const resultMap = new Map(lookupResults.map((item) => [item.projectRef, item]));

      let createdCount = 0;

      for (const id of ids) {
        const lookup = resultMap.get(buildProjectRef(id));
        if (!lookup?.project) {
          updateBatchResult(id, {
            status: 'error',
            message: lookup?.error ?? 'GitLab 查询失败',
            successfulModels: 0,
          });
          continue;
        }

        const basePath = buildProjectBasePath(lookup.project.name);
        updateBatchResult(id, {
          projectName: lookup.project.name,
          localPath: basePath,
          status: 'running',
          message: '正在 clone 源码并复制副本...',
        });

        try {
          const cloneResult = await runClonePlan(
            lookup.project,
            basePath,
            selectedModels,
            gitlabUrl,
            gitlabToken,
          );

          await createTask({
            gitlab_project_id: Number.parseInt(id, 10),
            project_name: lookup.project.name,
            local_path: basePath,
            models: cloneResult.successfulModels,
          });

          createdCount += 1;
          const successCount = cloneResult.successfulModels.length;
          const isPartial = cloneResult.failedModels.length > 0;
          updateBatchResult(id, {
            status: isPartial ? 'partial' : 'done',
            successfulModels: successCount,
            message: isPartial
              ? `已创建任务，成功 ${successCount}/${selectedModels.length} 个副本；失败：${cloneResult.failedModels
                  .map((item) => `${item.modelId}(${item.message})`)
                  .join('，')}`
              : `已创建任务，成功 ${successCount}/${selectedModels.length} 个副本`,
          });
        } catch (error) {
          updateBatchResult(id, {
            status: 'error',
            successfulModels: 0,
            message: toErrorMessage(error),
          });
        }
      }

      if (createdCount > 0) {
        await loadTasks();
      }
    } catch (error) {
      setBatchError(`批量领题失败: ${toErrorMessage(error)}`);
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handleDeleteModel = (id: string) => {
    if (isOriginModel(id)) return;
    setModels((current) => current.filter((model) => model.id !== id));
  };

  const handleAddModel = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed || models.some((model) => model.id === trimmed)) return;

    setModels((current) => [
      ...current,
      {
        id: trimmed,
        name: trimmed,
        checked: true,
        status: 'pending',
      },
    ]);
    setNewModelInput('');
    setAddingModel(false);
  };

  const resetForm = () => {
    setStep(1);
    setProjectId('');
    setIsCloning(false);
    setErrorMsg('');
    setCloneError('');
    setClaimSummary('');
    setCloneProgressMsg('');
    setProject(null);
    setLocalPath('');
    setAddingModel(false);
    setNewModelInput('');
    setModels(
      storeCloneModels.map((model) => ({
        ...model,
        checked: model.isDefault,
        status: 'pending' as const,
      })),
    );
  };

  const handleClaim = async () => {
    if (!project) {
      setCloneError('请先查询并确认项目');
      return;
    }

    if (!localPath.trim()) {
      setCloneError('请填写本地路径');
      return;
    }

    if (!selectedModels.length) {
      setCloneError('请至少选择一个 Clone 副本');
      return;
    }

    setIsCloning(true);
    setCloneError('');
    setClaimSummary('');
    setModels((current) =>
      current.map((model) =>
        model.checked ? { ...model, status: 'pending' as const } : model,
      ),
    );

    try {
      const rawProjectId = parseProjectIds(projectId)[0];
      const [gitlabUrl, gitlabToken] = await Promise.all([
        getConfig('gitlab_url'),
        getConfig('gitlab_token'),
      ]);

      if (!gitlabUrl || !gitlabToken) {
        throw new Error('请先在设置页面配置 GitLab URL 和 Token');
      }

      const cloneResult = await runClonePlan(
        project,
        localPath.trim(),
        selectedModels,
        gitlabUrl,
        gitlabToken,
        (modelId, status) => {
          setModels((current) =>
            current.map((model) =>
              model.id === modelId ? { ...model, status } : model,
            ),
          );
        },
      );

      await createTask({
        gitlab_project_id: Number.parseInt(rawProjectId, 10),
        project_name: project.name,
        local_path: localPath.trim().replace(/\/+$/, ''),
        models: cloneResult.successfulModels,
      });
      await loadTasks();

      if (cloneResult.failedModels.length > 0) {
        setCloneError(
          cloneResult.failedModels
            .map((item) => `${item.modelId}: ${item.message}`)
            .join('\n'),
        );
        setClaimSummary(
          `已创建任务，成功 ${cloneResult.successfulModels.length}/${selectedModels.length} 个副本。`,
        );
      } else {
        setClaimSummary('已创建任务并加入看板。');
      }

      setIsCloning(false);
      setStep(4);
    } catch (error) {
      setCloneError(`领题失败: ${toErrorMessage(error)}`);
      setIsCloning(false);
    }
  };

  const inputCls =
    'w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400 dark:placeholder:text-stone-600';
  const cardCls =
    'bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl p-6';
  const btnPrimary =
    'px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50 cursor-default';
  const btnSecondary =
    'px-5 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors cursor-default';

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50 tracking-tight">拉取项目</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">从 GitLab 获取项目并克隆到本地</p>
      </div>

      <section className={`${cardCls} mb-6`}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-bold text-stone-900 dark:text-stone-100">批量领题</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
              支持空格、逗号或换行分隔多个项目编号；每个题只远程 clone 一次，其余副本本地复制。
            </p>
          </div>
          <button
            onClick={handleBatchClaim}
            disabled={isBatchRunning || !batchProjectIds.trim()}
            className={btnPrimary}
          >
            {isBatchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            批量领题
          </button>
        </div>

        <textarea
          rows={4}
          value={batchProjectIds}
          onChange={(event) => setBatchProjectIds(event.target.value)}
          placeholder={'例如：\n1849 1850 1851'}
          disabled={isBatchRunning}
          className={`${inputCls} resize-none font-mono`}
        />

        <p className="mt-2 text-xs text-stone-400 dark:text-stone-500 leading-6">
          当前根目录：<code className="font-mono">{defaultCloneRoot}</code>
          <br />
          当前模型：<code className="font-mono">{selectedModelNames.join(', ') || '暂无'}</code>
        </p>

        {batchError && (
          <p className="mt-3 text-sm text-red-500 font-medium flex items-center gap-1.5">
            <X className="w-3.5 h-3.5 flex-shrink-0" />
            {batchError}
          </p>
        )}

        {batchResults.length > 0 && (
          <div className="mt-4 space-y-2.5 border-t border-stone-100 dark:border-stone-800 pt-4">
            {batchResults.map((item) => {
              const meta = getBatchStatusMeta(item.status);
              return (
                <div
                  key={item.projectId}
                  className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                        {item.projectId} · {item.projectName}
                      </p>
                      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 font-mono break-all">
                        {item.localPath}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wider ${meta.className}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-stone-600 dark:text-stone-300 leading-6">{item.message}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {step < 4 && (
        <div className="space-y-5">
          <section className={step > 1 ? 'opacity-60 pointer-events-none' : ''}>
            <StepLabel n={1} label="输入项目编号" done={step > 1} />
            <div className={`${cardCls} mt-2`}>
              <div className="flex gap-2.5">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    placeholder="项目编号，例如：1849"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && step === 1 && handleSearch()}
                    disabled={step > 1}
                    className={`${inputCls} pl-10`}
                  />
                </div>
                {step === 1 && (
                  <button
                    onClick={handleSearch}
                    disabled={!projectId.trim() || isSearching}
                    className={btnPrimary}
                  >
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : '查询'}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                单项目流程按规则查询 <code className="font-mono">prompt2repo/label-xxxxx</code>；多个编号请使用上方批量领题。
              </p>
              {errorMsg && (
                <p className="mt-3 text-sm text-red-500 font-medium flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5 flex-shrink-0" />
                  {errorMsg}
                </p>
              )}
            </div>
          </section>

          {step >= 2 && project && (
            <section className={`animate-in fade-in slide-in-from-bottom-2 duration-200 ${step > 2 ? 'opacity-60 pointer-events-none' : ''}`}>
              <StepLabel n={2} label="确认项目信息" done={step > 2} />
              <div className={`${cardCls} mt-2 space-y-3 text-sm`}>
                <Row label="项目名称">
                  <span className="font-semibold text-stone-900 dark:text-stone-100">{project.name}</span>
                </Row>
                <Row label="项目路径">
                  <code className="text-xs bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-lg font-mono text-stone-700 dark:text-stone-300">
                    {buildProjectRef(parseProjectIds(projectId)[0])}
                  </code>
                </Row>
                <Row label="描述">
                  <span className="text-stone-600 dark:text-stone-400">{project.description || '暂无描述'}</span>
                </Row>
                <Row label="默认分支">
                  <code className="text-xs bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-lg font-mono text-stone-700 dark:text-stone-300">
                    {project.default_branch || 'N/A'}
                  </code>
                </Row>
                <Row label="仓库地址">
                  <a
                    href={project.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-700 dark:text-slate-300 hover:underline flex items-center gap-1.5 font-medium"
                  >
                    <GitFork className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate max-w-xs">{project.web_url}</span>
                  </a>
                </Row>
                {step === 2 && (
                  <div className="pt-3 border-t border-stone-100 dark:border-stone-800 flex justify-end gap-2.5">
                    <button
                      onClick={() => {
                        setStep(1);
                        setProject(null);
                        setErrorMsg('');
                      }}
                      className={btnSecondary}
                    >
                      返回上一步
                    </button>
                    <button onClick={() => setStep(3)} className={btnPrimary}>
                      确定并继续
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {step >= 3 && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-200">
              <StepLabel n={3} label="配置 Clone" />
              <div className={`${cardCls} mt-2 space-y-6`}>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-stone-700 dark:text-stone-300">本地路径</label>
                  <div className="flex gap-2.5">
                    <div className="relative flex-1">
                      <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                      <input
                        type="text"
                        value={localPath}
                        onChange={(event) => setLocalPath(event.target.value)}
                        disabled={isCloning}
                        className={`${inputCls} pl-10`}
                      />
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                    首个副本走 git clone，其余副本直接从首个副本复制，支持 ~/… 路径。
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-3 text-stone-700 dark:text-stone-300">Clone 副本</label>
                  <div className="space-y-1.5">
                    {models.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 group"
                      >
                        <input
                          type="checkbox"
                          checked={model.checked}
                          onChange={(event) =>
                            setModels((current) =>
                              current.map((item) =>
                                item.id === model.id ? { ...item, checked: event.target.checked } : item,
                              ),
                            )
                          }
                          disabled={isCloning || isOriginModel(model.id)}
                          className="w-4 h-4 rounded border-stone-300 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
                        />
                        <Terminal className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                        <span className="font-mono text-sm flex-1 text-stone-700 dark:text-stone-300">{model.name}</span>
                        <button
                          onClick={() => handleDeleteModel(model.id)}
                          disabled={isCloning || isOriginModel(model.id)}
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
                          onChange={(event) => setNewModelInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleAddModel();
                            if (event.key === 'Escape') {
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
                        disabled={isCloning}
                        className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 px-1 py-1.5 transition-colors disabled:opacity-40 cursor-default"
                      >
                        <Plus className="w-4 h-4" />
                        添加模型副本
                      </button>
                    )}
                  </div>
                </div>

                {isCloning ? (
                  <div className="pt-5 border-t border-stone-100 dark:border-stone-800 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-300">
                      <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                      正在准备项目...
                    </div>
                    {cloneProgressMsg && (
                      <p className="text-xs font-mono text-stone-500 dark:text-stone-400 truncate" title={cloneProgressMsg}>
                        {cloneProgressMsg}
                      </p>
                    )}
                    {models.filter((model) => model.checked).map((model) => (
                      <div key={model.id} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-medium">
                          <span className="font-mono text-stone-500 dark:text-stone-400">{model.id}</span>
                          <span className={getModelStatusClassName(model.status)}>
                            {getModelStatusLabel(model.status)}
                          </span>
                        </div>
                        <div className="h-1 w-full bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-300 ${getModelStatusBarClassName(model.status)}`} />
                        </div>
                      </div>
                    ))}
                    {cloneError && (
                      <pre className="text-xs text-red-500 font-mono whitespace-pre-wrap mt-2">{cloneError}</pre>
                    )}
                  </div>
                ) : (
                  <div className="pt-5 border-t border-stone-100 dark:border-stone-800 flex justify-between items-center">
                    {cloneError && (
                      <p className="text-sm text-red-500 font-medium whitespace-pre-wrap">{cloneError}</p>
                    )}
                    <div className="flex gap-2.5 ml-auto">
                      <button onClick={() => setStep(2)} className={btnSecondary}>返回</button>
                      <button
                        onClick={handleClaim}
                        disabled={selectedModels.length === 0}
                        className={btnPrimary}
                      >
                        <Rocket className="w-4 h-4" />
                        开始领题
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {step === 4 && (
        <div className={`${cardCls} text-center py-12 animate-in fade-in slide-in-from-bottom-2 duration-200`}>
          <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-5">
            <Check className="w-7 h-7 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
          </div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-stone-50 mb-1.5 tracking-tight">领题成功</h2>
          <p className="text-sm text-stone-500 dark:text-stone-400 mb-2">
            项目{' '}
            <code className="font-mono bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">
              {formatProjectName(parseProjectIds(projectId)[0] ?? projectId.trim())}
            </code>{' '}
            已克隆并加入看板
          </p>
          {claimSummary && (
            <p className="text-sm text-stone-500 dark:text-stone-400 mb-8">{claimSummary}</p>
          )}
          {!claimSummary && <div className="mb-8" />}
          <div className="flex justify-center gap-3">
            <button onClick={() => navigate('/')} className={btnSecondary}>返回看板</button>
            <button onClick={resetForm} className={btnPrimary}>
              继续领题 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepLabel({ n, label, done }: { n: number; label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mb-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          done
            ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
        }`}
      >
        {done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : n}
      </div>
      <span className="text-sm font-semibold text-stone-600 dark:text-stone-400">{label}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="w-20 flex-shrink-0 text-stone-400 dark:text-stone-500 text-right">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function parseProjectIds(value: string): string[] {
  const tokens = value
    .split(/[\s,，、;；]+/)
    .map((item) => item.trim())
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return String(error);
}

function getModelStatusLabel(status: ModelEntry['status']): string {
  switch (status) {
    case 'done':
      return '✓ 完成';
    case 'cloning':
      return 'git clone 中…';
    case 'copying':
      return '本地复制中…';
    case 'error':
      return '✗ 失败';
    default:
      return '等待';
  }
}

function getModelStatusClassName(status: ModelEntry['status']): string {
  switch (status) {
    case 'done':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'cloning':
    case 'copying':
      return 'text-slate-700 dark:text-slate-300';
    case 'error':
      return 'text-red-500';
    default:
      return 'text-stone-400';
  }
}

function getModelStatusBarClassName(status: ModelEntry['status']): string {
  switch (status) {
    case 'cloning':
    case 'copying':
      return 'w-full bg-slate-500 animate-pulse';
    case 'done':
      return 'w-full bg-emerald-500';
    case 'error':
      return 'w-full bg-red-400';
    default:
      return 'w-0';
  }
}

function getBatchStatusMeta(status: BatchClaimStatus): { label: string; className: string } {
  switch (status) {
    case 'running':
      return {
        label: '处理中',
        className: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
      };
    case 'done':
      return {
        label: '完成',
        className: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      };
    case 'partial':
      return {
        label: '部分完成',
        className: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400',
      };
    case 'error':
      return {
        label: '失败',
        className: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
      };
    default:
      return {
        label: '等待中',
        className: 'bg-stone-100 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400',
      };
  }
}
