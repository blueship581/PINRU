import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { FolderDown, Wand2, GitPullRequest, Settings, Plus, FolderOpen, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';
import { useEffect, useState } from 'react';
import { getActiveProjectId, getProjects, pickDirectory, saveProjects, setActiveProjectId, type ProjectConfig } from '../services/config';

const navItems: Array<{ to: string; label: string; icon: typeof FolderDown; end?: boolean }> = [
  { to: '/claim',        icon: FolderDown,     label: '领题'   },
  { to: '/prompt',       icon: Wand2,          label: '提示词' },
  { to: '/submit',       icon: GitPullRequest, label: '提交'   },
];

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export default function Layout() {
  const theme = useAppStore((s) => s.theme);
  const navigate = useNavigate();
  const location = useLocation();
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [pickingProjectDir, setPickingProjectDir] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectForm, setProjectForm] = useState({
    name: '',
    basePath: '',
    modelsText: 'origin\ncotv21-pro\ncotv21.2-pro',
    defaultSubmitRepo: '',
    sourceModelFolder: 'ORIGIN',
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const resetProjectForm = () => {
    setProjectForm({
      name: '',
      basePath: '',
      modelsText: 'origin\ncotv21-pro\ncotv21.2-pro',
      defaultSubmitRepo: '',
      sourceModelFolder: 'ORIGIN',
    });
    setProjectError('');
  };

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
    try {
      const selected = await pickDirectory();
      if (selected) {
        setProjectForm((prev) => ({ ...prev, basePath: selected }));
      }
    } finally {
      setPickingProjectDir(false);
    }
  };

  const handleCreateProject = async () => {
    const name = projectForm.name.trim();
    const models = projectForm.modelsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    if (!name) {
      setProjectError('项目名称不能为空');
      return;
    }
    if (!projectForm.basePath.trim()) {
      setProjectError('请选择项目文件位置');
      return;
    }
    if (models.length === 0) {
      setProjectError('请至少配置一个模型');
      return;
    }
    if (models[0].toUpperCase() !== 'ORIGIN') {
      setProjectError('ORIGIN 必须存在且保持首行');
      return;
    }
    if (projectForm.defaultSubmitRepo.trim() && !/^[^/\s]+\/[^/\s]+$/.test(projectForm.defaultSubmitRepo.trim())) {
      setProjectError('源码仓库格式应为 owner/repo');
      return;
    }

    const sourceModelFolder = projectForm.sourceModelFolder.trim() || 'ORIGIN';
    if (!models.some((model) => model.toUpperCase() === sourceModelFolder.toUpperCase())) {
      setProjectError('源码文件夹必须在模型列表中');
      return;
    }

    setCreatingProject(true);
    setProjectError('');
    try {
      const existing = await getProjects();
      const nextProject: ProjectConfig = {
        id: `project-${Date.now()}`,
        name,
        basePath: projectForm.basePath.trim(),
        models: models.map((model, index) => index === 0 ? 'ORIGIN' : model),
        defaultSubmitRepo: projectForm.defaultSubmitRepo.trim() || null,
        sourceModelFolder: models.find((model) => model.toUpperCase() === sourceModelFolder.toUpperCase()) ?? 'ORIGIN',
      };
      await saveProjects([...existing, nextProject]);
      await setActiveProjectId(nextProject.id);
      setShowProjectModal(false);
      resetProjectForm();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '创建项目失败');
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden
                    font-sans select-none
                    bg-stone-50 dark:bg-[#161615]
                    text-stone-900 dark:text-stone-100">

      {/* ── Sidebar ── */}
      <aside
        className="w-[200px] flex-shrink-0 flex flex-col
                   bg-[#ECEAE6] dark:bg-[#1A1A19]
                   border-r border-black/[.06] dark:border-white/[.06]"
      >
        <div className="px-5 pt-7 pb-5">
          <button
            onClick={() => navigate('/')}
            className="block text-left px-1 py-1 transition-colors cursor-default"
          >
            <p className="text-[17px] font-bold leading-tight tracking-tight text-stone-900 dark:text-stone-50">PR</p>
            <p className="text-[9px] font-semibold tracking-[0.18em] uppercase text-stone-400 dark:text-stone-500 mt-0.5">
              Project Review
            </p>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map(({ to, end, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium
                 transition-all duration-150 cursor-default ${
                  isActive
                    ? 'bg-[#E7EDF5] dark:bg-[#1A1F29] text-[#111827] dark:text-[#F8FBFF] shadow-sm shadow-black/[.05]'
                    : 'text-stone-500 dark:text-stone-400 hover:bg-black/[.04] dark:hover:bg-white/[.05] hover:text-stone-800 dark:hover:text-stone-200'
                }`
              }
            >
              <Icon className="w-[15px] h-[15px] flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Settings */}
        <div className="px-3 pb-5">
          <div className="h-px bg-black/[.06] dark:bg-white/[.07] mb-2" />
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
              <Settings className="w-[15px] h-[15px]" />
            </NavLink>
            <button
              onClick={() => {
                resetProjectForm();
                setShowProjectModal(true);
              }}
              className="p-2 rounded-xl text-stone-500 dark:text-stone-400 hover:bg-black/[.04] dark:hover:bg-white/[.05] hover:text-stone-800 dark:hover:text-stone-200 transition-colors cursor-default"
              title="新建项目"
            >
              <Plus className="w-[15px] h-[15px]" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col
                       bg-stone-50 dark:bg-[#161615]">
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>

      {showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div
            className="absolute inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm"
            onClick={() => {
              if (creatingProject) return;
              setShowProjectModal(false);
              resetProjectForm();
            }}
          />
          <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">新建项目</h2>
                <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">配置项目目录、模型列表、源码文件夹和源码仓库</p>
              </div>
              <button
                onClick={() => {
                  if (creatingProject) return;
                  setShowProjectModal(false);
                  resetProjectForm();
                }}
                className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400"
              >
                <span className="sr-only">关闭</span>
                ×
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">项目名称</span>
                <input
                  value={projectForm.name}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：评审项目"
                  className="w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                />
              </label>

              <label className="block">
                <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">项目文件位置</span>
                <div className="flex gap-2.5">
                  <input
                    value={projectForm.basePath}
                    readOnly
                    placeholder="请选择项目目录"
                    className="flex-1 bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium text-stone-700 dark:text-stone-300"
                  />
                  <button
                    onClick={handlePickProjectDirectory}
                    disabled={pickingProjectDir}
                    className="px-4 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-default"
                  >
                    {pickingProjectDir ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                    浏览
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">模型列表</span>
                <textarea
                  value={projectForm.modelsText}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, modelsText: event.target.value }))}
                  rows={5}
                  className="w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium font-mono focus:outline-none focus:ring-2 focus:ring-slate-400/30 resize-none"
                />
                <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">首行必须为 ORIGIN，用于原始参照。</p>
              </label>

              <label className="block">
                <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">源码文件夹</span>
                <input
                  value={projectForm.sourceModelFolder}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, sourceModelFolder: event.target.value }))}
                  placeholder="例如：ORIGIN"
                  className="w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium font-mono focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                />
                <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                  默认使用 ORIGIN。提交时会先把这个文件夹上传到源码仓库默认分支。
                </p>
              </label>

              <label className="block">
                <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">源码仓库</span>
                <input
                  value={projectForm.defaultSubmitRepo}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, defaultSubmitRepo: event.target.value }))}
                  placeholder="例如：prompt2repo/label-01849"
                  className="w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                />
                <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                  可选。提交页会先把源码文件夹上传到这个仓库默认分支，再为其他模型创建 PR。
                </p>
              </label>
            </div>

            {projectError && <p className="mt-4 text-sm text-red-500">{projectError}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  if (creatingProject) return;
                  setShowProjectModal(false);
                  resetProjectForm();
                }}
                className="px-4 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-700 dark:text-stone-300"
              >
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={creatingProject}
                className="px-4 py-2.5 rounded-2xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] text-sm font-semibold disabled:opacity-50"
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
