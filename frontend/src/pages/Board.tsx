import React, { useState, useEffect } from 'react';
import {
  Search, Clock, GitBranch, CheckCircle2, CircleDashed, PlayCircle,
  X, ExternalLink, ChevronDown, ChevronRight, Plus, Trash2, Settings, Eye, EyeOff,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, TaskStatus, Task } from '../store';
import { motion, AnimatePresence } from 'motion/react';
import { getActiveProjectId, updateProject, type ProjectConfig } from '../services/config';
import {
  createTask,
  deleteTask,
  getTask,
  listModelRuns,
  updateTaskStatus,
  type ModelRunFromDB,
  type TaskFromDB,
} from '../services/task';

/* ── Status config ── */
const STATUS: Record<TaskStatus, {
  label: string;
  dotCls: string;
  badgeCls: string;
  headerCls: string;
}> = {
  Claimed:     { label: '已领题',    dotCls: 'bg-blue-500',    badgeCls: 'bg-blue-50   dark:bg-blue-500/10   text-blue-700   dark:text-blue-400',   headerCls: 'text-blue-700   dark:text-blue-400'   },
  Downloading: { label: '下载中',    dotCls: 'bg-amber-500 animate-pulse',   badgeCls: 'bg-amber-50  dark:bg-amber-500/10  text-amber-700  dark:text-amber-400',  headerCls: 'text-amber-700  dark:text-amber-400'  },
  Downloaded:  { label: '已下载',    dotCls: 'bg-slate-500',  badgeCls: 'bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300', headerCls: 'text-slate-700 dark:text-slate-300' },
  PromptReady: { label: '提示词就绪', dotCls: 'bg-violet-500',  badgeCls: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300', headerCls: 'text-violet-700 dark:text-violet-300' },
  Submitted:   { label: '已提交',    dotCls: 'bg-emerald-500', badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', headerCls: 'text-emerald-700 dark:text-emerald-400' },
  Error:       { label: '错误',      dotCls: 'bg-red-500',     badgeCls: 'bg-red-50    dark:bg-red-500/10    text-red-700    dark:text-red-400',    headerCls: 'text-red-700    dark:text-red-400'    },
};

const COLUMNS: TaskStatus[] = ['Claimed', 'Downloading', 'Downloaded', 'PromptReady', 'Submitted', 'Error'];

export default function Board() {
  const navigate = useNavigate();
  const tasks       = useAppStore(s => s.tasks);
  const loadTasks   = useAppStore(s => s.loadTasks);
  const addTaskToStore = useAppStore(s => s.addTask);
  const removeTaskFromStore = useAppStore(s => s.removeTask);
  const activeProject = useAppStore(s => s.activeProject);
  const setActiveProject = useAppStore(s => s.setActiveProject);
  const loadActiveProject = useAppStore(s => s.loadActiveProject);
  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskFromDB | null>(null);
  const [selectedModelRuns, setSelectedModelRuns] = useState<ModelRunFromDB[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const updateTaskStatusInStore = useAppStore(s => s.updateTaskStatus);
  const [statusChanging, setStatusChanging] = useState(false);
  const [newTask, setNewTask] = useState({
    projectId: '',
    projectName: '',
    status: 'Claimed' as TaskStatus,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    Claimed: true, PromptReady: true, Running: true,
  });

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { loadActiveProject(); }, [loadActiveProject]);

  useEffect(() => {
    if (!selected?.id) {
      setSelectedTaskDetail(null);
      setSelectedModelRuns([]);
      setDrawerError('');
      return;
    }

    let cancelled = false;
    setDrawerLoading(true);
    setDrawerError('');

    (async () => {
      const [taskDetail, modelRuns] = await Promise.all([
        getTask(selected.id),
        listModelRuns(selected.id),
      ]);

      if (cancelled) return;
      setSelectedTaskDetail(taskDetail);
      setSelectedModelRuns(modelRuns);
      setDrawerLoading(false);
    })().catch((error) => {
      if (cancelled) return;
      console.error(error);
      setDrawerError(error instanceof Error ? error.message : '详情加载失败');
      setDrawerLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  const filtered = tasks.filter(t =>
    t.projectName.toLowerCase().includes(search.toLowerCase()) ||
    t.projectId.includes(search)
  );

  const toggle = (id: string) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const resetCreateForm = () => {
    setNewTask({ projectId: '', projectName: '', status: 'Claimed' });
    setCreateError('');
  };

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const handleCreateTask = async () => {
    const projectId = Number.parseInt(newTask.projectId, 10);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      setCreateError('项目 ID 需要是正整数');
      return;
    }
    if (!newTask.projectName.trim()) {
      setCreateError('项目名称不能为空');
      return;
    }

    setCreating(true);
    setCreateError('');
    try {
      const activeConfigId = await getActiveProjectId();
      const created = await createTask({
        gitlabProjectId: projectId,
        projectName: newTask.projectName.trim(),
        localPath: null,
        models: [],
        projectConfigId: activeConfigId,
      });
      if (newTask.status !== 'Claimed') {
        await updateTaskStatus(created.id, newTask.status);
      }
      addTaskToStore({
        id: created.id,
        projectId: String(created.gitlabProjectId),
        projectName: created.projectName,
        status: newTask.status,
        createdAt: created.createdAt,
        progress: 0,
        totalModels: 0,
        runningModels: 0,
      });
      setShowCreateModal(false);
      resetCreateForm();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建题卡失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTask = async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    setDeleteError('');
    try {
      await deleteTask(pendingDelete.id);
      removeTaskFromStore(pendingDelete.id);
      if (selected?.id === pendingDelete.id) {
        setSelected(null);
      }
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除题卡失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    setStatusChanging(true);
    try {
      await updateTaskStatus(taskId, newStatus);
      updateTaskStatusInStore(taskId, newStatus);
      setSelected(prev => prev ? { ...prev, status: newStatus } : null);
    } catch (err) {
      console.error('Failed to update task status:', err);
    } finally {
      setStatusChanging(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Search bar */}
      <div className="sticky top-0 z-10 bg-stone-50 dark:bg-[#161615] px-8 pt-7 pb-4 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="搜索项目名称或 ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400 dark:placeholder:text-stone-600"
            />
          </div>
          <span className="text-sm text-stone-400 dark:text-stone-500 font-medium ml-auto">
            共 {filtered.length} 条任务
          </span>
          <button
            onClick={() => setShowProjectPanel(true)}
            className="p-2 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors cursor-default"
            title="项目配置"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors shadow-sm cursor-default"
          >
            <Plus className="w-4 h-4" />
            添加题卡
          </button>
        </div>
      </div>

      {/* Accordion list */}
      <div className="flex-1 overflow-y-auto px-8 py-5 space-y-3">
        {COLUMNS.map(status => {
          const cfg      = STATUS[status];
          const colTasks = filtered.filter(t => t.status === status);
          const open     = !!expanded[status];

          return (
            <div
              key={status}
              className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl overflow-hidden"
            >
              {/* Accordion header */}
              <button
                onClick={() => toggle(status)}
                className="w-full px-5 py-3.5 flex items-center gap-3 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dotCls}`} />
                <span className={`font-semibold text-sm ${cfg.headerCls}`}>{cfg.label}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badgeCls}`}>
                  {colTasks.length}
                </span>
                <span className="ml-auto text-stone-400">
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </span>
              </button>

              {/* Accordion body */}
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-stone-100 dark:border-stone-800 px-5 pt-4 pb-5">
                      {colTasks.length === 0 ? (
                        <p className="text-sm text-stone-400 dark:text-stone-600 text-center py-6 border border-dashed border-stone-200 dark:border-stone-800 rounded-2xl">
                          暂无任务
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {colTasks.map(task => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              status={status}
                              onClick={() => setSelected(task)}
                              onDelete={() => {
                                setDeleteError('');
                                setPendingDelete(task);
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* ── Detail drawer ── */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (creating) return;
                setShowCreateModal(false);
                resetCreateForm();
              }}
              className="fixed inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm z-30"
            />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="fixed inset-0 z-40 flex items-center justify-center p-6"
            >
              <div className="w-full max-w-md rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
                <div className="flex items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">添加题卡</h2>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">手动创建一张看板任务卡</p>
                  </div>
                  <button
                    onClick={() => {
                      if (creating) return;
                      setShowCreateModal(false);
                      resetCreateForm();
                    }}
                    className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <label className="block">
                    <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">项目 ID</span>
                    <input
                      value={newTask.projectId}
                      onChange={(event) => setNewTask((prev) => ({ ...prev, projectId: event.target.value }))}
                      placeholder="例如 1849"
                      className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">项目名称</span>
                    <input
                      value={newTask.projectName}
                      onChange={(event) => setNewTask((prev) => ({ ...prev, projectName: event.target.value }))}
                      placeholder="例如 label-01849"
                      className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">状态</span>
                    <select
                      value={newTask.status}
                      onChange={(event) => setNewTask((prev) => ({ ...prev, status: event.target.value as TaskStatus }))}
                      className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                    >
                      {COLUMNS.map((status) => (
                        <option key={status} value={status}>{STATUS[status].label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {createError && (
                  <p className="mt-4 text-sm text-red-500">{createError}</p>
                )}

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      if (creating) return;
                      setShowCreateModal(false);
                      resetCreateForm();
                    }}
                    className="px-4 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-700 dark:text-stone-300"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreateTask}
                    disabled={creating}
                    className="px-4 py-2.5 rounded-2xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] text-sm font-semibold disabled:opacity-50"
                  >
                    {creating ? '创建中...' : '创建题卡'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}

        {pendingDelete && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (deleting) return;
                setPendingDelete(null);
                setDeleteError('');
              }}
              className="fixed inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6"
            >
              <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">确认删除题卡</h2>
                <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                  将删除「{pendingDelete.projectName}」的题卡、关联模型记录，以及本地对比目录中的文件。此操作不可撤销。
                </p>
                {deleteError && (
                  <p className="mt-3 text-sm text-red-500">{deleteError}</p>
                )}
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      if (deleting) return;
                      setPendingDelete(null);
                      setDeleteError('');
                    }}
                    className="px-4 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-700 dark:text-stone-300"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleDeleteTask}
                    disabled={deleting}
                    className="px-4 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {deleting ? '删除中...' : '确认删除'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}

        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
              className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
            >
              {/* Drawer header */}
              <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS[selected.status].dotCls}`} />
                    <select
                      value={selected.status}
                      disabled={statusChanging}
                      onChange={(e) => handleStatusChange(selected.id, e.target.value as TaskStatus)}
                      className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border-0 outline-none cursor-default appearance-none ${STATUS[selected.status].badgeCls} disabled:opacity-60`}
                    >
                      {COLUMNS.map((s) => (
                        <option key={s} value={s}>{STATUS[s].label}</option>
                      ))}
                    </select>
                  </div>
                  <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight truncate">
                    {selected.projectName}
                  </h2>
                  <p className="text-xs font-mono text-stone-400 mt-0.5">
                    #{selected.projectId} · {selected.id}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 flex-shrink-0 cursor-default"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Drawer body */}
              <div className="flex-1 overflow-y-auto p-7">
                {drawerLoading ? (
                  <div className="py-20 text-center text-sm text-stone-400 dark:text-stone-500">
                    正在加载任务详情…
                  </div>
                ) : drawerError ? (
                  <div className="rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
                    {drawerError}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 mb-8">
                      <InfoCard label="项目 ID" value={selected.projectId} mono />
                      <InfoCard label="当前状态" value={STATUS[selected.status].label} />
                      <InfoCard label="创建时间" value={new Date(selected.createdAt * 1000).toLocaleString('zh-CN')} />
                      <InfoCard label="提示词" value={selectedTaskDetail?.promptText ? '已保存' : '未保存'} />
                    </div>

                    <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-4 mb-8 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                          工作目录
                        </span>
                        <span className="text-xs text-stone-400 dark:text-stone-500">
                          {selectedModelRuns.filter((run) => !isOriginModel(run.modelName)).length} 个模型副本
                        </span>
                      </div>
                      <p className="font-mono text-xs leading-6 text-stone-600 dark:text-stone-300 break-all">
                        {selectedTaskDetail?.localPath || '当前题卡未记录本地目录'}
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">模型执行</h3>
                        <div className="flex items-center gap-2 text-[11px] font-semibold">
                          <span className="px-2 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                            待处理 {selectedModelRuns.filter((run) => !isOriginModel(run.modelName) && run.status === 'pending').length}
                          </span>
                          <span className="px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            执行中 {selectedModelRuns.filter((run) => !isOriginModel(run.modelName) && run.status === 'running').length}
                          </span>
                          <span className="px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            已完成 {selectedModelRuns.filter((run) => !isOriginModel(run.modelName) && run.status === 'done').length}
                          </span>
                        </div>
                      </div>

                      {selectedModelRuns.length === 0 ? (
                        <p className="text-sm text-stone-400 dark:text-stone-600 text-center py-6 border border-dashed border-stone-200 dark:border-stone-800 rounded-2xl">
                          当前任务还没有模型记录
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {selectedModelRuns.map((run) => {
                            const presentation = modelRunPresentation(run.status);

                            return (
                              <div
                                key={run.id}
                                className="px-4 py-3 bg-stone-50 dark:bg-stone-800/50 rounded-2xl border border-stone-200 dark:border-stone-700"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2.5">
                                      <presentation.icon className={`w-3.5 h-3.5 flex-shrink-0 ${presentation.iconCls}`} />
                                      <span className="font-mono text-sm text-stone-700 dark:text-stone-300">
                                        {run.modelName}
                                      </span>
                                      {isOriginModel(run.modelName) && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                          参考
                                        </span>
                                      )}
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${presentation.badgeCls}`}>
                                        {presentation.label}
                                      </span>
                                    </div>
                                    <div className="mt-2 space-y-1.5 text-xs text-stone-500 dark:text-stone-400">
                                      <p className="break-all">{run.localPath || '未记录副本目录'}</p>
                                      <p className="font-mono break-all">{run.branchName || '尚未创建分支'}</p>
                                    </div>
                                  </div>

                                  {run.prUrl ? (
                                    <a
                                      href={run.prUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-stone-400 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 transition-colors cursor-default flex-shrink-0"
                                    >
                                      PR <ExternalLink className="w-3 h-3" />
                                    </a>
                                  ) : (
                                    <span className="text-xs text-stone-400 dark:text-stone-500 flex-shrink-0">
                                      未生成 PR
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Drawer footer */}
              <div className="px-7 py-5 border-t border-stone-100 dark:border-stone-800 flex gap-3">
                <button
                  onClick={() => {
                    setSelected(null);
                    navigate('/prompt');
                  }}
                  className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-2xl text-sm font-semibold text-stone-700 dark:text-stone-300 transition-colors cursor-default"
                >
                  生成提示词
                </button>
                <button
                  onClick={() => {
                    setSelected(null);
                    navigate('/submit');
                  }}
                  className="flex-1 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors shadow-sm cursor-default"
                >
                  提交 PR
                </button>
              </div>
            </motion.aside>
          </>
        )}
        {showProjectPanel && activeProject && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProjectPanel(false)}
              className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
            />
            <ProjectPanel
              project={activeProject}
              onClose={() => setShowProjectPanel(false)}
              onSaved={(updated) => {
                setActiveProject(updated);
                setShowProjectPanel(false);
              }}
            />
          </>
        )}
        {showProjectPanel && !activeProject && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProjectPanel(false)}
              className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className="fixed top-0 right-0 bottom-0 w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
            >
              <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">项目配置</h2>
                <button onClick={() => setShowProjectPanel(false)} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
                暂无激活项目，请先在设置中创建并激活项目
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Task Card ── */
function TaskCard({
  task,
  status,
  onClick,
  onDelete,
}: {
  key?: string;
  task: Task;
  status: TaskStatus;
  onClick: () => void;
  onDelete: () => void;
}) {
  const cfg = STATUS[status];
  return (
    <motion.div
      layout
      onClick={onClick}
      className="group bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700 rounded-2xl p-4 hover:bg-white dark:hover:bg-stone-800 hover:border-stone-300 dark:hover:border-stone-600 hover:shadow-sm transition-all cursor-default"
    >
      {/* Top row */}
      <div className="flex items-center justify-between mb-3">
        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dotCls}`} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400 dark:text-stone-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(task.createdAt * 1000).toLocaleDateString('zh-CN')}
          </span>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            title="删除题卡"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Project name — primary */}
      <p className="font-semibold text-sm text-stone-900 dark:text-stone-50 mb-1 leading-snug line-clamp-2" title={task.projectName}>
        {task.projectName}
      </p>

      {/* Project ID — secondary */}
      <p className="font-mono text-xs text-stone-400 dark:text-stone-500 mb-4">#{task.projectId}</p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <GitBranch className="w-3.5 h-3.5" />
          <span className="font-mono truncate max-w-[120px]">{task.id}</span>
        </div>
        {task.totalModels > 0 && (
          <div className="flex items-center gap-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
            {task.progress === task.totalModels
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              : task.runningModels > 0
                ? <PlayCircle className="w-3.5 h-3.5 text-slate-500" />
                : <CircleDashed className="w-3.5 h-3.5" />
            }
            {task.progress}/{task.totalModels}
          </div>
        )}
      </div>

      {status === 'Downloading' && task.totalModels > 0 && (
        <div className="mt-3 h-1 w-full bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all"
            style={{ width: `${(task.progress / task.totalModels) * 100}%` }}
          />
        </div>
      )}
    </motion.div>
  );
}

function InfoCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">{label}</p>
      <p className={`mt-2 text-sm text-stone-700 dark:text-stone-300 break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function isOriginModel(modelName: string) {
  return modelName.trim().toUpperCase() === 'ORIGIN';
}

function modelRunPresentation(status: string) {
  if (status === 'done') {
    return {
      label: '完成',
      icon: CheckCircle2,
      iconCls: 'text-emerald-500',
      badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    };
  }

  if (status === 'running') {
    return {
      label: '执行中',
      icon: PlayCircle,
      iconCls: 'text-amber-500',
      badgeCls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    };
  }

  if (status === 'error') {
    return {
      label: '异常',
      icon: X,
      iconCls: 'text-red-500',
      badgeCls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    };
  }

  return {
    label: '待处理',
    icon: CircleDashed,
    iconCls: 'text-stone-400',
    badgeCls: 'bg-stone-100 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400',
  };
}

function ProjectPanel({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectConfig;
  onClose: () => void;
  onSaved: (updated: ProjectConfig) => void;
}) {
  const [form, setForm] = useState<ProjectConfig>({ ...project });
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');

  const setField = <K extends keyof Pick<ProjectConfig, 'name' | 'gitlabUrl' | 'gitlabToken' | 'cloneBasePath' | 'models'>>(key: K, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateProject(form);
      onSaved({ ...form, updatedAt: Math.floor(Date.now() / 1000) });
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const modelTags = form.models
    ? form.models.split(',').map((m) => m.trim()).filter(Boolean)
    : ['ORIGIN'];

  const removeModel = (name: string) => {
    const next = modelTags.filter((m) => m.toUpperCase() !== 'ORIGIN' && m.toLowerCase() !== name.toLowerCase());
    setField('models', ['ORIGIN', ...next].join(', '));
  };

  const addModel = () => {
    const name = newModelInput.trim();
    if (!name || modelTags.some((m) => m.toLowerCase() === name.toLowerCase())) {
      setAddingModel(false);
      setNewModelInput('');
      return;
    }
    const nonOrigin = modelTags.filter((m) => m.toUpperCase() !== 'ORIGIN');
    setField('models', ['ORIGIN', ...nonOrigin, name].join(', '));
    setNewModelInput('');
    setAddingModel(false);
  };

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className="fixed top-0 right-0 bottom-0 w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
    >
      {/* Header */}
      <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">项目配置</h2>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 font-mono">{project.id}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-7 space-y-5">
        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">项目名称</span>
          <input
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">GitLab URL</span>
          <input
            value={form.gitlabUrl}
            onChange={(e) => setField('gitlabUrl', e.target.value)}
            placeholder="https://gitlab.example.com"
            className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">GitLab Token</span>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.gitlabToken}
              onChange={(e) => setField('gitlabToken', e.target.value)}
              className="w-full px-4 py-2.5 pr-11 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-default"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </label>

        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">本地克隆路径</span>
          <input
            value={form.cloneBasePath}
            onChange={(e) => setField('cloneBasePath', e.target.value)}
            placeholder="~/code/pinru"
            className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          />
        </label>

        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">模型列表</span>
          <div className="flex flex-wrap gap-2 p-3 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 min-h-[48px]">
            {/* ORIGIN chip — 固定不可删 */}
            <span className="inline-flex items-center px-3 py-1 rounded-xl bg-[#111827] dark:bg-[#E5EAF2] text-white dark:text-[#0D1117] text-xs font-mono font-semibold">
              ORIGIN
            </span>
            {/* 其他模型 chip */}
            {modelTags.filter((m) => m.toUpperCase() !== 'ORIGIN').map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-stone-100 dark:bg-stone-700 border border-stone-200 dark:border-stone-600 text-xs font-mono text-stone-700 dark:text-stone-300"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeModel(name)}
                  className="ml-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-100 transition-colors cursor-default"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {/* 添加按钮 / 输入框 */}
            {addingModel ? (
              <input
                autoFocus
                value={newModelInput}
                onChange={(e) => setNewModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addModel(); }
                  if (e.key === 'Escape') { setAddingModel(false); setNewModelInput(''); }
                }}
                onBlur={addModel}
                placeholder="模型名称"
                className="w-28 px-2 py-1 rounded-xl bg-white dark:bg-stone-600 border border-stone-300 dark:border-stone-500 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-400/30"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingModel(true)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-xl border border-dashed border-stone-300 dark:border-stone-600 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:border-stone-400 transition-colors cursor-default"
              >
                <Plus className="w-3 h-3" />
                添加
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-7 py-5 border-t border-stone-100 dark:border-stone-800 flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-2xl text-sm font-semibold text-stone-700 dark:text-stone-300 transition-colors cursor-default"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 cursor-default"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </motion.aside>
  );
}
