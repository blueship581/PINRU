import { Fragment, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { motion } from 'motion/react';
import { Plus, RefreshCw, X } from 'lucide-react';
import TaskTypeQuotaEditor from '../../../shared/components/TaskTypeQuotaEditor';
import MarkdownPreview from '../../../shared/components/MarkdownPreview';
import type { Task } from '../../../store';
import type { TaskTypeOverviewSummary } from '../../../shared/lib/taskTypeOverview';
import {
  getProjectTaskSettings,
  getProjects,
  normalizeProjectModels,
  serializeProjectModels,
  serializeProjectTaskSettings,
  updateProject,
  type ProjectConfig,
  type TaskTypeQuotas,
} from '../../../api/config';
import {
  normalizeManagedSourceFolders,
  type NormalizeManagedSourceFoldersResult,
} from '../../../api/git';
import { InfoCard, TaskTypeOverviewCard } from './BoardPresentation';

type TaskTypeSummary = TaskTypeOverviewSummary;

function isOriginModel(name: string) {
  return name.trim().toUpperCase() === 'ORIGIN';
}

export function EmptyProjectAside({
  title,
  widthClass,
  onClose,
}: {
  title: string;
  widthClass: string;
  onClose: () => void;
}) {
  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className={`fixed top-0 right-0 bottom-0 ${widthClass} bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl`}
    >
      <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">{title}</h2>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
        暂无激活项目，请先在设置中创建并激活项目
      </div>
    </motion.aside>
  );
}

export function ProjectOverviewPanel({
  project,
  summaries,
  taskCount,
  onClose,
  onNormalized,
  onSelectTask,
  onOpenTaskContextMenu,
}: {
  project: ProjectConfig;
  summaries: TaskTypeSummary[];
  taskCount: number;
  onClose: () => void;
  onNormalized: () => Promise<void>;
  onSelectTask: (task: Task) => void;
  onOpenTaskContextMenu: (event: MouseEvent, task: Task) => void;
}) {
  const modelList = normalizeProjectModels(project.models);
  const totalInFlight = summaries.reduce(
    (count, summary) => count + summary.waitingTasks.length + summary.processingTasks.length,
    0,
  );
  const [normalizing, setNormalizing] = useState(false);
  const [normalizeError, setNormalizeError] = useState('');
  const [normalizeResult, setNormalizeResult] =
    useState<NormalizeManagedSourceFoldersResult | null>(null);

  const handleNormalize = async () => {
    setNormalizing(true);
    setNormalizeError('');
    try {
      const result = await normalizeManagedSourceFolders(project.id);
      setNormalizeResult(result);
      await onNormalized();
    } catch (error) {
      setNormalizeError(error instanceof Error ? error.message : '归一处理失败');
    } finally {
      setNormalizing(false);
    }
  };

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className="fixed top-0 right-0 bottom-0 w-[560px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
    >
      <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-stone-400 dark:text-stone-500">
            项目概况
          </p>
          <h2 className="mt-1 text-lg font-bold text-stone-900 dark:text-stone-50">
            {project.name}
          </h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            主页恢复为题目卡片视图，项目信息集中在这里查看。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleNormalize}
            disabled={normalizing}
            title="将现有任务目录、源码目录和模型 Git 状态归一为统一规则"
            className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 disabled:opacity-50 cursor-default"
          >
            <RefreshCw className={`w-4 h-4 ${normalizing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-7 space-y-6">
        <div className="rounded-3xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">
                目录与 Git 归一
              </h3>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                任务目录会归一为 <code className="font-mono">label-00947-bug修复</code>
                ，源码目录会归一为 <code className="font-mono">01995-bug修复</code>；
                现有模型目录如果缺少 <code className="font-mono">.git</code>，也会自动补本地 Git 基线。
              </p>
            </div>
            <button
              type="button"
              onClick={handleNormalize}
              disabled={normalizing}
              className="px-3 py-2 rounded-2xl bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs font-semibold text-stone-700 dark:text-stone-300 disabled:opacity-50 cursor-default"
            >
              {normalizing ? '处理中…' : '执行归一'}
            </button>
          </div>
          {normalizeError && <p className="mt-3 text-sm text-red-500">{normalizeError}</p>}
          {normalizeResult && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-stone-500 dark:text-stone-400">
                共扫描 {normalizeResult.totalTasks} 个任务，已重命名{' '}
                {normalizeResult.renamedCount}，已回写 {normalizeResult.updatedCount}，已跳过{' '}
                {normalizeResult.skippedCount}，已补 Git 基线 {normalizeResult.gitInitializedCount}，
                错误 {normalizeResult.errorCount}。
              </p>
              {normalizeResult.errorCount > 0 && (
                <div className="space-y-1">
                  {normalizeResult.details
                    .filter((detail) => detail.status === 'error')
                    .slice(0, 3)
                    .map((detail) => (
                      <p key={detail.taskId} className="text-xs text-red-500">
                        {detail.taskId}: {detail.message}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="题卡总数" value={String(taskCount)} />
          <InfoCard label="模型数量" value={String(modelList.length)} />
          <InfoCard label="源码模型" value={project.sourceModelFolder || 'ORIGIN'} mono />
          <InfoCard label="源码目录名" value="项目ID-任务类型" />
          <InfoCard label="源码仓库" value={project.defaultSubmitRepo || '未配置'} mono />
        </div>

        <InfoCard label="本地克隆根目录" value={project.cloneBasePath} mono />

        <div className="rounded-3xl border border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/80 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">
                项目记录
              </h3>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                支持常用 Markdown，可记录阶段说明、交接信息和项目文档索引。
              </p>
            </div>
            <span className="rounded-2xl bg-white/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400 dark:bg-stone-800 dark:text-stone-500">
              Markdown
            </span>
          </div>
          <div className="mt-4 rounded-2xl border border-stone-200/80 bg-white px-4 py-4 dark:border-stone-800 dark:bg-stone-950/40">
            <MarkdownPreview
              content={project.overviewMarkdown || ''}
              emptyMessage="暂无项目记录，可在项目配置中补充。"
            />
          </div>
        </div>

        {summaries.length > 0 && (
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">
                  试题分配
                </h3>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  只展示当前有分配额度或已有流转记录的任务分类。
                </p>
              </div>
              <span className="rounded-2xl bg-stone-100 dark:bg-stone-800 px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
                在途 {totalInFlight}
              </span>
            </div>
            <div className="grid gap-3">
              {summaries.map((summary) => (
                <Fragment key={summary.taskType}>
                  <TaskTypeOverviewCard
                    summary={summary}
                    onSelectTask={onSelectTask}
                    onOpenTaskContextMenu={onOpenTaskContextMenu}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}

export function ProjectPanel({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectConfig;
  onClose: () => void;
  onSaved: (updated: ProjectConfig) => void;
}) {
  const initialTaskSettings = useMemo(() => getProjectTaskSettings(project), [project]);
  const [form, setForm] = useState<ProjectConfig>({ ...project });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  const [taskTypes, setTaskTypes] = useState<string[]>(() => initialTaskSettings.taskTypes);
  const [quotas, setQuotas] = useState<TaskTypeQuotas>(() => initialTaskSettings.quotas);
  const [totals, setTotals] = useState(() => initialTaskSettings.totals);

  useEffect(() => {
    setForm({ ...project });
    setTaskTypes(initialTaskSettings.taskTypes);
    setQuotas(initialTaskSettings.quotas);
    setTotals(initialTaskSettings.totals);
    setAddingModel(false);
    setNewModelInput('');
    setError('');
  }, [initialTaskSettings, project]);

  const setField = <
    K extends keyof Pick<
      ProjectConfig,
      | 'name'
      | 'gitlabUrl'
      | 'gitlabToken'
      | 'cloneBasePath'
      | 'models'
      | 'sourceModelFolder'
      | 'defaultSubmitRepo'
      | 'overviewMarkdown'
    >,
  >(
    key: K,
    value: string,
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const modelList = normalizeProjectModels(form.models);

  const setModels = (list: string[]) => {
    setField('models', serializeProjectModels(list));
  };

  const handleSave = async () => {
    const sourceModelFolder =
      modelList.find(
        (model) =>
          model.toUpperCase() === (form.sourceModelFolder?.trim() || 'ORIGIN').toUpperCase(),
      ) ?? 'ORIGIN';

    if (!form.name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    if (!form.cloneBasePath.trim()) {
      setError('本地克隆根目录不能为空');
      return;
    }
    if (taskTypes.length === 0) {
      setError('请至少保留一个任务类型');
      return;
    }
    if (
      form.defaultSubmitRepo.trim() &&
      !/^[^/\s]+\/[^/\s]+$/.test(form.defaultSubmitRepo.trim())
    ) {
      setError('源码仓库格式应为 owner/repo');
      return;
    }
    if (!modelList.some((model) => model.toUpperCase() === sourceModelFolder.toUpperCase())) {
      setError('源码模型必须在模型列表中');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const nextProject = {
        ...form,
        models: serializeProjectModels(modelList),
        sourceModelFolder,
        defaultSubmitRepo: form.defaultSubmitRepo.trim(),
        ...serializeProjectTaskSettings(taskTypes, quotas, totals),
      };
      await updateProject(nextProject);
      const refreshedProjects = await getProjects();
      const updatedProject =
        refreshedProjects.find((item) => item.id === nextProject.id) ?? nextProject;
      onSaved(updatedProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 26, stiffness: 220 }}
      className="fixed top-0 right-0 bottom-0 w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-2xl z-30 flex flex-col rounded-l-3xl"
    >
      <div className="px-7 py-6 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">项目配置</h2>
        <button
          onClick={onClose}
          className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 cursor-default"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-7 space-y-5">
        {[
          { label: '项目名称', key: 'name' as const, placeholder: '我的项目' },
          {
            label: 'GitLab URL',
            key: 'gitlabUrl' as const,
            placeholder: 'https://gitlab.example.com',
          },
          {
            label: 'GitLab Token',
            key: 'gitlabToken' as const,
            placeholder: form.hasGitLabToken
              ? '已保存，留空则保留当前令牌'
              : 'glpat-xxxx',
          },
          {
            label: '本地克隆根目录',
            key: 'cloneBasePath' as const,
            placeholder: '/Users/me/repos',
          },
        ].map(({ label, key, placeholder }) => (
          <label key={key} className="block">
            <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
              {label}
            </span>
            <input
              value={form[key] || ''}
              onChange={(event) => setField(key, event.target.value)}
              placeholder={placeholder}
              className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
            />
            {key === 'gitlabToken' && form.hasGitLabToken && (
              <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
                已保存访问令牌。这里留空会保留当前值。
              </p>
            )}
          </label>
        ))}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
              模型列表
            </span>
            <button
              onClick={() => setAddingModel(true)}
              className="text-xs font-semibold text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 flex items-center gap-1 cursor-default"
            >
              <Plus className="w-3.5 h-3.5" /> 添加
            </button>
          </div>
          <p className="mb-3 text-xs leading-5 text-stone-400 dark:text-stone-500">
            这里决定领题后会创建哪些本地目录。源码模型表示原始代码目录；其余模型会作为执行、副本提交和 AI 复审用的工作目录。
          </p>
          {addingModel && (
            <div className="flex gap-2 mb-2">
              <input
                value={newModelInput}
                onChange={(event) => setNewModelInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newModelInput.trim()) {
                    setModels([...modelList, newModelInput.trim()]);
                    setNewModelInput('');
                    setAddingModel(false);
                  }
                }}
                placeholder="模型名称"
                autoFocus
                className="flex-1 px-3 py-2 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
              />
              <button
                onClick={() => {
                  if (newModelInput.trim()) {
                    setModels([...modelList, newModelInput.trim()]);
                    setNewModelInput('');
                    setAddingModel(false);
                  }
                }}
                className="px-3 py-2 rounded-xl bg-[#111827] text-white text-sm font-semibold cursor-default"
              >
                添加
              </button>
              <button
                onClick={() => {
                  setAddingModel(false);
                  setNewModelInput('');
                }}
                className="px-3 py-2 rounded-xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-600 cursor-default"
              >
                取消
              </button>
            </div>
          )}
          <div className="space-y-1.5">
            {modelList.length === 0 ? (
              <p className="text-sm text-stone-400 dark:text-stone-600 text-center py-4 border border-dashed border-stone-200 dark:border-stone-800 rounded-xl">
                暂无模型
              </p>
            ) : (
              modelList.map((modelName, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700"
                >
                  <span className="font-mono text-sm text-stone-700 dark:text-stone-300">
                    {modelName}
                  </span>
                  {isOriginModel(modelName) ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                      原始
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        const nextModels = modelList.filter((_, itemIndex) => itemIndex !== index);
                        setModels(nextModels);
                        if (
                          form.sourceModelFolder.trim().toUpperCase() ===
                          modelName.trim().toUpperCase()
                        ) {
                          setField('sourceModelFolder', nextModels[0] ?? 'ORIGIN');
                        }
                      }}
                      className="text-stone-400 hover:text-red-500 transition-colors cursor-default"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
            任务类型约束
          </span>
          <p className="mb-3 text-xs text-stone-400 dark:text-stone-500">
            任务总量：整个项目该类型可创建的任务上限。单题上限：同一个 GitLab 项目在该类型下最多领取的次数。留空均为不限。
          </p>
          <TaskTypeQuotaEditor
            taskTypes={taskTypes}
            quotas={quotas}
            totals={totals}
            onTaskTypesChange={setTaskTypes}
            onQuotasChange={setQuotas}
            onTotalsChange={setTotals}
            addButtonLabel="添加任务类型"
          />
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
            源码模型
          </span>
          <select
            value={form.sourceModelFolder || 'ORIGIN'}
            onChange={(event) => setField('sourceModelFolder', event.target.value)}
            className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          >
            {modelList.map((modelName) => (
              <option key={modelName} value={modelName}>
                {modelName}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
            这里指定哪个模型作为源码来源。它不会计入“执行副本”数量，实际源码目录会自动使用对应 GitLab 项目名。
          </p>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
            源码仓库
          </span>
          <input
            value={form.defaultSubmitRepo || ''}
            onChange={(event) => setField('defaultSubmitRepo', event.target.value)}
            placeholder="owner/repo"
            className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
            项目记录
          </span>
          <textarea
            value={form.overviewMarkdown || ''}
            onChange={(event) => setField('overviewMarkdown', event.target.value)}
            placeholder={'支持 Markdown，例如：\n# 里程碑\n- 已验收第一轮\n- 待同步回归结论'}
            rows={10}
            className="w-full min-h-[220px] resize-y rounded-2xl bg-stone-50 px-4 py-3 leading-6 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/30"
          />
          <p className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
            会显示在项目概况中，支持标题、列表、代码块、链接等常用 Markdown。
          </p>
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      <div className="px-7 py-5 border-t border-stone-100 dark:border-stone-800 flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 bg-stone-100 dark:bg-stone-800 rounded-2xl text-sm font-semibold text-stone-700 dark:text-stone-300 cursor-default"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-2xl text-sm font-semibold disabled:opacity-50 cursor-default"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </motion.aside>
  );
}
