import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  FolderDown,
  FolderOpen,
  GitPullRequest,
  Home,
  Loader2,
  Plus,
  Settings,
  Terminal,
  Wand2,
  X,
} from 'lucide-react';
import { Dialogs } from '@wailsio/runtime';
import { useEffect, useMemo, useRef, useState } from 'react';
import TaskTypeQuotaEditor from './TaskTypeQuotaEditor';
import { useAppStore } from '../../store';
import { inspectDirectory } from '../../api/git';
import {
  DEFAULT_TASK_TYPES,
  createProject,
  getProjects,
  serializeProjectModels,
  serializeProjectTaskSettings,
  setActiveProjectId,
  type ProjectConfig,
  type TaskTypeQuotas,
} from '../../api/config';

const NAV_ITEMS: Array<{ to: string; label: string; icon: typeof FolderDown; end?: boolean }> = [
  { to: '/', icon: Home, label: '主页', end: true },
  { to: '/claim', icon: FolderDown, label: '领题' },
  { to: '/prompt', icon: Wand2, label: '操作台' },
  { to: '/submit', icon: GitPullRequest, label: '提交' },
];

type ModelEntry = {
  id: string;
  name: string;
};

type ProjectFormState = {
  name: string;
  basePath: string;
  defaultSubmitRepo: string;
  sourceModelFolder: string;
  overviewMarkdown: string;
};

const DEFAULT_MODELS: ModelEntry[] = [
  { id: 'ORIGIN', name: 'ORIGIN' },
  { id: 'cotv21-pro', name: 'cotv21-pro' },
  { id: 'cotv21.2-pro', name: 'cotv21.2-pro' },
];

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function createEmptyProjectForm(): ProjectFormState {
  return {
    name: '',
    basePath: '',
    defaultSubmitRepo: '',
    sourceModelFolder: 'ORIGIN',
    overviewMarkdown: '',
  };
}

function normalizeModelName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.toUpperCase() === 'ORIGIN' ? 'ORIGIN' : trimmed;
}

function isOriginModel(name: string) {
  return normalizeModelName(name) === 'ORIGIN';
}

async function ensureEmptyProjectDirectory(path: string) {
  const inspection = await inspectDirectory(path);
  if (!inspection.exists) {
    throw new Error('所选目录不存在');
  }
  if (!inspection.isDir) {
    throw new Error('所选路径不是文件夹');
  }
  if (!inspection.isEmpty) {
    throw new Error('请选择空文件夹，当前目录中已有内容');
  }
  return inspection;
}

export default function Layout() {
  const theme = useAppStore((s) => s.theme);
  const activeProject = useAppStore((s) => s.activeProject);
  const loadActiveProject = useAppStore((s) => s.loadActiveProject);
  const resetForNewProject = useAppStore((s) => s.resetForNewProject);

  const navigate = useNavigate();
  const location = useLocation();

  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [projectMenuError, setProjectMenuError] = useState('');

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [pickingProjectDir, setPickingProjectDir] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectForm, setProjectForm] = useState<ProjectFormState>(createEmptyProjectForm);
  const [modelList, setModelList] = useState<ModelEntry[]>(DEFAULT_MODELS);
  const [addingModel, setAddingModel] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [taskTypes, setTaskTypes] = useState<string[]>([...DEFAULT_TASK_TYPES]);
  const [quotas, setQuotas] = useState<TaskTypeQuotas>({});

  const projectMenuRef = useRef<HTMLDivElement>(null);

  const inputCls =
    'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400';

  const sourceModelOptions = useMemo(() => modelList.map((model) => model.name), [modelList]);

  const refreshProjects = async () => {
    const nextProjects = await getProjects();
    setProjects(nextProjects);
  };

  const resetProjectForm = () => {
    setProjectForm(createEmptyProjectForm());
    setModelList(DEFAULT_MODELS);
    setAddingModel(false);
    setNewModelName('');
    setTaskTypes([...DEFAULT_TASK_TYPES]);
    setQuotas({});
    setProjectError('');
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    if (!activeProject) return;
    setProjects((prev) =>
      prev.some((project) => project.id === activeProject.id)
        ? prev.map((project) => (project.id === activeProject.id ? { ...project, ...activeProject } : project))
        : prev,
    );
  }, [activeProject]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadActiveProject(), refreshProjects()]);
      } catch (error) {
        setProjectMenuError(error instanceof Error ? error.message : '项目列表加载失败');
      } finally {
        setLoadingProjects(false);
      }
    })().catch(() => {
      setLoadingProjects(false);
    });
  }, [loadActiveProject]);

  useEffect(() => {
    if (!showProjectMenu) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setShowProjectMenu(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showProjectMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      if (event.key === ',') {
        event.preventDefault();
        if (location.pathname !== '/settings') {
          navigate('/settings');
        }
        return;
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        window.location.reload();
        return;
      }

      if (isEditableTarget(event.target)) return;

      const routeMap: Record<string, string> = {
        '1': '/',
        '2': '/claim',
        '3': '/prompt',
        '4': '/submit',
      };

      const nextRoute = routeMap[event.key];
      if (nextRoute && location.pathname !== nextRoute) {
        event.preventDefault();
        navigate(nextRoute);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [location.pathname, navigate]);

  const handlePickProjectDirectory = async () => {
    setPickingProjectDir(true);
    setProjectError('');

    try {
      const result = await Dialogs.OpenFile({
        CanChooseDirectories: true,
        CanChooseFiles: false,
        CanCreateDirectories: true,
        ResolvesAliases: true,
        Title: '选择项目目录',
        Message: '请选择用于存放项目副本的目录',
        ButtonText: '选择',
        Directory: projectForm.basePath.trim() || undefined,
      });

      const selectedPath = Array.isArray(result) ? result[0] : result;
      if (!selectedPath || !selectedPath.trim()) {
        return;
      }

      const inspection = await ensureEmptyProjectDirectory(selectedPath.trim());
      setProjectForm((prev) => ({
        ...prev,
        basePath: inspection.path,
        name: inspection.name || prev.name,
      }));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '打开目录选择器失败');
    } finally {
      setPickingProjectDir(false);
    }
  };

  const handleAddModel = () => {
    const normalized = normalizeModelName(newModelName);
    if (!normalized) return;
    if (modelList.some((model) => model.id.toUpperCase() === normalized.toUpperCase())) {
      return;
    }

    setModelList((prev) => [...prev, { id: normalized, name: normalized }]);
    setNewModelName('');
    setAddingModel(false);
  };

  const handleRemoveModel = (id: string) => {
    if (isOriginModel(id)) return;

    const nextModels = modelList.filter((model) => model.id !== id);
    setModelList(nextModels);

    if (normalizeModelName(projectForm.sourceModelFolder) === normalizeModelName(id)) {
      const fallbackSource =
        nextModels.find((model) => isOriginModel(model.name))?.name ?? nextModels[0]?.name ?? 'ORIGIN';
      setProjectForm((prev) => ({ ...prev, sourceModelFolder: fallbackSource }));
    }
  };

  const handleSwitchProject = async (project: ProjectConfig) => {
    if (switchingProject) return;
    if (project.id === activeProject?.id) {
      setShowProjectMenu(false);
      return;
    }

    setSwitchingProject(true);
    setProjectMenuError('');
    try {
      await setActiveProjectId(project.id);
      await resetForNewProject();
      await refreshProjects();
      setShowProjectMenu(false);
      navigate('/');
    } catch (error) {
      setProjectMenuError(error instanceof Error ? error.message : '切换项目失败');
    } finally {
      setSwitchingProject(false);
    }
  };

  const handleCreateProject = async () => {
    const name = projectForm.name.trim();
    let cloneBasePath = '';
    const normalizedModels = modelList
      .map((model) => normalizeModelName(model.name))
      .filter(Boolean);
    const sourceModelFolder =
      sourceModelOptions.find(
        (model) => normalizeModelName(model) === normalizeModelName(projectForm.sourceModelFolder),
      ) ?? 'ORIGIN';

    if (!name) {
      setProjectError('项目名称不能为空');
      return;
    }
    if (!projectForm.basePath.trim()) {
      setProjectError('请选择项目文件位置');
      return;
    }
    try {
      const inspection = await ensureEmptyProjectDirectory(projectForm.basePath.trim());
      cloneBasePath = inspection.path;
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '项目目录校验失败');
      return;
    }
    if (normalizedModels.length === 0) {
      setProjectError('请至少配置一个模型');
      return;
    }
    if (taskTypes.length === 0) {
      setProjectError('请至少配置一个任务类型');
      return;
    }
    if (projectForm.defaultSubmitRepo.trim() && !/^[^/\s]+\/[^/\s]+$/.test(projectForm.defaultSubmitRepo.trim())) {
      setProjectError('源码仓库格式应为 owner/repo');
      return;
    }
    if (!normalizedModels.includes('ORIGIN')) {
      setProjectError('ORIGIN 必须存在，作为原始参照副本');
      return;
    }
    if (!normalizedModels.some((model) => model.toUpperCase() === sourceModelFolder.toUpperCase())) {
      setProjectError('源码模型必须在模型列表中');
      return;
    }

    setCreatingProject(true);
    setProjectError('');
    try {
      const serializedTaskSettings = serializeProjectTaskSettings(taskTypes, quotas);
      const nextProject: ProjectConfig = {
        id: `project-${Date.now()}`,
        name,
        gitlabUrl: '',
        gitlabToken: '',
        hasGitLabToken: false,
        cloneBasePath,
        models: serializeProjectModels(normalizedModels),
        sourceModelFolder,
        defaultSubmitRepo: projectForm.defaultSubmitRepo.trim(),
        overviewMarkdown: projectForm.overviewMarkdown,
        ...serializedTaskSettings,
        createdAt: 0,
        updatedAt: 0,
      };

      await createProject(nextProject);
      await setActiveProjectId(nextProject.id);
      await resetForNewProject();
      await refreshProjects();
      setShowProjectModal(false);
      resetProjectForm();
      navigate('/');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '创建项目失败');
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div
      className="flex h-screen w-full overflow-hidden font-sans select-none bg-stone-50 text-stone-900 dark:bg-[#161615] dark:text-stone-100"
    >
      <aside
        className="w-[200px] flex-shrink-0 flex flex-col bg-[#ECEAE6] border-r border-black/[.06] dark:bg-[#1A1A19] dark:border-white/[.06]"
      >
        <div className="px-5 pt-7 pb-4">
          <button
            onClick={() => navigate('/')}
            className="block text-left px-1 py-1 transition-colors cursor-default"
          >
            <p className="text-[17px] font-bold leading-tight tracking-tight text-stone-900 dark:text-stone-50">
              PR
            </p>
            <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
              Project Review
            </p>
          </button>

          <div className="relative mt-4" ref={projectMenuRef}>
            <button
              onClick={() => setShowProjectMenu((prev) => !prev)}
              disabled={loadingProjects || switchingProject}
              className="flex w-full items-center gap-2 rounded-2xl bg-black/[.03] px-3 py-2.5 text-left transition-colors hover:bg-black/[.05] disabled:opacity-60 dark:bg-white/[.04] dark:hover:bg-white/[.06]"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  当前项目
                </p>
                <p className="truncate text-xs font-semibold text-stone-700 dark:text-stone-200">
                  {activeProject?.name ?? (loadingProjects ? '加载中...' : '未创建项目')}
                </p>
              </div>
              {switchingProject ? (
                <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-stone-400" />
              ) : (
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-stone-400" />
              )}
            </button>

            {showProjectMenu && (
              <div className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl dark:border-stone-800 dark:bg-stone-900">
                <div className="max-h-64 overflow-y-auto p-1.5">
                  {projects.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-stone-400 dark:text-stone-500">暂无项目配置</p>
                  ) : (
                    projects.map((project) => {
                      const isActive = project.id === activeProject?.id;
                      return (
                        <button
                          key={project.id}
                          onClick={() => handleSwitchProject(project)}
                          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors cursor-default ${
                            isActive
                              ? 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-100'
                              : 'text-stone-600 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800/70'
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{project.name}</span>
                            <span className="block truncate text-[10px] text-stone-400 dark:text-stone-500">
                              {project.cloneBasePath || '未设置目录'}
                            </span>
                          </span>
                          {isActive && <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-stone-100 p-1.5 dark:border-stone-800">
                  <button
                    onClick={() => {
                      setShowProjectMenu(false);
                      resetProjectForm();
                      setShowProjectModal(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800/70"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新建项目
                  </button>
                </div>
              </div>
            )}
          </div>

          {projectMenuError && (
            <p className="mt-2 px-1 text-[11px] text-red-500">{projectMenuError}</p>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map(({ to, end, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-150 cursor-default ${
                  isActive
                    ? 'bg-[#E7EDF5] dark:bg-[#1A1F29] text-[#111827] dark:text-[#F8FBFF] shadow-sm shadow-black/[.05]'
                    : 'text-stone-500 dark:text-stone-400 hover:bg-black/[.04] dark:hover:bg-white/[.05] hover:text-stone-800 dark:hover:text-stone-200'
                }`
              }
            >
              <Icon className="h-[15px] w-[15px] flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-5">
          <div className="mb-2 h-px bg-black/[.06] dark:bg-white/[.07]" />
          <div className="flex items-center justify-between px-1">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `p-2 rounded-xl transition-all duration-150 cursor-default ${
                  isActive
                    ? 'bg-[#E7EDF5] dark:bg-[#1A1F29] text-[#111827] dark:text-[#F8FBFF] shadow-sm shadow-black/[.05]'
                    : 'text-stone-500 dark:text-stone-400 hover:bg-black/[.04] dark:hover:bg-white/[.05] hover:text-stone-800 dark:hover:text-stone-200'
                }`
              }
              title="设置"
            >
              <Settings className="h-[15px] w-[15px]" />
            </NavLink>
            <button
              onClick={() => {
                resetProjectForm();
                setShowProjectModal(true);
              }}
              className="p-2 rounded-xl text-stone-500 transition-colors hover:bg-black/[.04] hover:text-stone-800 dark:text-stone-400 dark:hover:bg-white/[.05] dark:hover:text-stone-200"
              title="新建项目"
            >
              <Plus className="h-[15px] w-[15px]" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden flex flex-col bg-stone-50 dark:bg-[#161615]">
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>

      {showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-6 md:items-center md:p-6">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm dark:bg-black/45"
            onClick={() => {
              if (creatingProject) return;
              setShowProjectModal(false);
              resetProjectForm();
            }}
          />
          <div className="relative flex w-full max-w-5xl max-h-[92vh] flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-6 py-5 dark:border-stone-800">
              <div>
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">新建项目</h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                  配置项目目录、模型列表、源码来源和任务配额
                </p>
              </div>
              <button
                onClick={() => {
                  if (creatingProject) return;
                  setShowProjectModal(false);
                  resetProjectForm();
                }}
                className="p-2 rounded-xl text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      项目名称
                    </span>
                    <input
                      value={projectForm.name}
                      onChange={(event) => setProjectForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="例如：评审项目"
                      className={inputCls}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      项目文件位置
                    </span>
                    <div className="flex gap-2.5">
                      <input
                        value={projectForm.basePath}
                        onChange={(event) => setProjectForm((prev) => ({ ...prev, basePath: event.target.value }))}
                        placeholder="请输入项目目录路径"
                        className={`${inputCls} flex-1`}
                      />
                      <button
                        onClick={handlePickProjectDirectory}
                        disabled={pickingProjectDir}
                        className="flex items-center gap-2 rounded-2xl bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                      >
                        {pickingProjectDir ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FolderOpen className="h-4 w-4" />
                        )}
                        浏览
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                      请选择空文件夹。选中后会自动将目录名带入项目名称。
                    </p>
                  </label>

                  <div>
                    <span className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      模型列表
                    </span>
                    <div className="space-y-1.5">
                      {modelList.map((model) => (
                        <div
                          key={model.id}
                          className="group flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 dark:border-stone-700 dark:bg-stone-800/50"
                        >
                          <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-stone-400" />
                          <span className="flex-1 font-mono text-sm text-stone-700 dark:text-stone-300">
                            {model.name}
                          </span>
                          {isOriginModel(model.name) && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                              原始
                            </span>
                          )}
                          {!isOriginModel(model.name) && (
                            <button
                              onClick={() => handleRemoveModel(model.id)}
                              className="p-1 text-stone-400 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100"
                              aria-label={`删除 ${model.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}

                      {addingModel ? (
                        <div className="flex items-center gap-2 px-1 pt-1">
                          <input
                            type="text"
                            value={newModelName}
                            onChange={(event) => setNewModelName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') handleAddModel();
                              if (event.key === 'Escape') {
                                setAddingModel(false);
                                setNewModelName('');
                              }
                            }}
                            placeholder="模型名，例如：cotv22-pro"
                            autoFocus
                            className={`${inputCls} flex-1 font-mono`}
                          />
                          <button
                            onClick={handleAddModel}
                            className="rounded-full bg-[#111827] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:text-[#0D1117] dark:hover:bg-[#F3F6FB]"
                          >
                            确认
                          </button>
                          <button
                            onClick={() => {
                              setAddingModel(false);
                              setNewModelName('');
                            }}
                            className="rounded-xl px-3 py-2 text-sm text-stone-500 transition-colors hover:text-stone-700 dark:hover:text-stone-300"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingModel(true)}
                          className="flex items-center gap-2 px-1 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        >
                          <Plus className="h-4 w-4" />
                          添加模型
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                      ORIGIN 为原始参照副本，不可删除。
                    </p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      任务类型与配额
                    </span>
                    <p className="mb-3 text-xs text-stone-400 dark:text-stone-500">
                      可以手动新增任务类型。每次领题或手动建题卡时，会按分配到的类型扣减对应数量。
                    </p>
                    <TaskTypeQuotaEditor
                      taskTypes={taskTypes}
                      quotas={quotas}
                      onTaskTypesChange={setTaskTypes}
                      onQuotasChange={setQuotas}
                    />
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      源码模型
                    </span>
                    <select
                      value={projectForm.sourceModelFolder}
                      onChange={(event) =>
                        setProjectForm((prev) => ({ ...prev, sourceModelFolder: event.target.value }))
                      }
                      className={`${inputCls} font-mono`}
                    >
                      {sourceModelOptions.map((modelName) => (
                        <option key={modelName} value={modelName}>
                          {modelName}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                      这里指定哪个模型副本作为源码来源。实际目录会自动使用 `label-xxxxx-任务类型 / 项目ID-任务类型` 规则。
                    </p>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      源码仓库
                    </span>
                    <input
                      value={projectForm.defaultSubmitRepo}
                      onChange={(event) =>
                        setProjectForm((prev) => ({ ...prev, defaultSubmitRepo: event.target.value }))
                      }
                      placeholder="例如：prompt2repo/label-01849"
                      className={inputCls}
                    />
                    <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                      可选。留空时会按当前 GitHub 账号和任务信息自动生成仓库名。
                    </p>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
                      项目记录
                    </span>
                    <textarea
                      value={projectForm.overviewMarkdown}
                      onChange={(event) =>
                        setProjectForm((prev) => ({ ...prev, overviewMarkdown: event.target.value }))
                      }
                      placeholder={'支持 Markdown，例如：\n# 里程碑\n- 已完成首轮验收\n- 待补充回归记录'}
                      rows={10}
                      className={`${inputCls} min-h-[220px] resize-y leading-6`}
                    />
                    <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                      会展示在“项目概况”里，适合记录阶段说明、里程碑、注意事项和文档链接。
                    </p>
                  </label>
                </div>
              </div>

              {projectError && <p className="mt-5 text-sm text-red-500">{projectError}</p>}
            </div>

            <div className="flex justify-end gap-3 border-t border-stone-100 px-6 py-4 dark:border-stone-800">
              <button
                onClick={() => {
                  if (creatingProject) return;
                  setShowProjectModal(false);
                  resetProjectForm();
                }}
                className="rounded-2xl bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-300"
              >
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={creatingProject}
                className="rounded-2xl bg-[#111827] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1F2937] disabled:opacity-50 dark:bg-[#E5EAF2] dark:text-[#0D1117] dark:hover:bg-[#F3F6FB]"
              >
                {creatingProject ? '创建中...' : '创建项目'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
