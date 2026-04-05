import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Copy,
  FileCode2,
  FolderTree,
  Loader2,
  Save,
  Settings2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { getLlmProviders } from '../services/config';
import { generateTaskPrompt, saveTaskPrompt, type CodeAnalysisSummary, type LlmProviderConfig } from '../services/llm';
import { getTask } from '../services/task';
import { useAppStore } from '../store';

const TASK_TYPES = ['功能开发', 'Bug 修复', '重构优化', '测试补齐', '文档整理', '性能调优'];
const CONSTRAINTS = [
  '技术栈或依赖约束',
  '架构或模式约束',
  '代码风格或规范约束',
  '业务逻辑约束',
  '回复格式约束',
  '优先最小改动',
];
const SCOPES = ['单文件', '模块内多文件', '跨模块多文件', '跨系统多模块'];

const cardCls = 'bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl';
const inputCls = 'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400';
const btnPrimary = 'px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 cursor-default';
const btnSecondary = 'px-4 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-default disabled:opacity-50';

export default function Prompt() {
  const navigate = useNavigate();
  const allTasks = useAppStore((state) => state.tasks);
  const loadTasks = useAppStore((state) => state.loadTasks);
  const tasks = useMemo(
    () => allTasks.filter((task) => task.status === 'Claimed' || task.status === 'PromptReady'),
    [allTasks],
  );

  const [providers, setProviders] = useState<LlmProviderConfig[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [taskType, setTaskType] = useState('功能开发');
  const [selectedConstraints, setSelectedConstraints] = useState<string[]>(['优先最小改动']);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['单文件']);
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [analysis, setAnalysis] = useState<CodeAnalysisSummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');
  const [loadError, setLoadError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  useEffect(() => {
    (async () => {
      await loadTasks();
      const loadedProviders = await getLlmProviders();
      setProviders(loadedProviders);
    })().catch((error) => {
      console.error(error);
      setLoadError(error instanceof Error ? error.message : '数据加载失败');
    });
  }, [loadTasks]);

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId('');
      setPromptContent('');
      setAnalysis(null);
      return;
    }

    if (!tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (!providers.length) {
      setSelectedProviderId('');
      return;
    }

    if (!providers.some((provider) => provider.id === selectedProviderId)) {
      const defaultProvider = providers.find((provider) => provider.isDefault) ?? providers[0];
      setSelectedProviderId(defaultProvider.id);
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    if (!selectedTaskId) {
      setPromptContent('');
      setAnalysis(null);
      return;
    }

    let cancelled = false;
    setActionMessage('');
    setLoadError('');

    (async () => {
      const task = await getTask(selectedTaskId);
      if (cancelled) return;
      setPromptContent(task?.prompt_text ?? '');
      setAnalysis(null);
    })().catch((error) => {
      if (cancelled) return;
      setLoadError(error instanceof Error ? error.message : '任务详情加载失败');
    });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;

  const stackSummary = useMemo(() => {
    if (!analysis?.detectedStack.length) return '尚未生成代码分析';
    return analysis.detectedStack.join(' · ');
  }, [analysis]);

  const toggleConstraint = (constraint: string) => {
    setSelectedConstraints((current) => {
      const next = current.includes(constraint)
        ? current.filter((item) => item !== constraint)
        : [...current, constraint];
      return next.length ? next : [constraint];
    });
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) => {
      const next = current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope];
      return next.length ? next : [scope];
    });
  };

  const handleGenerate = async () => {
    if (!selectedTaskId) {
      setLoadError('请先选择任务');
      return;
    }
    if (!selectedProviderId) {
      setLoadError('请先配置并选择模型提供商');
      return;
    }

    setGenerating(true);
    setLoadError('');
    setActionMessage('');

    try {
      const result = await generateTaskPrompt({
        taskId: selectedTaskId,
        providerId: selectedProviderId,
        taskType,
        scopes: selectedScopes,
        constraints: selectedConstraints,
        additionalNotes: additionalNotes.trim() || null,
      });
      setPromptContent(result.promptText);
      setAnalysis(result.analysis);
      setActionMessage(`已使用 ${result.providerName} · ${result.model} 生成并写入任务`);
      await loadTasks();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '提示词生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedTaskId) {
      setLoadError('请先选择任务');
      return;
    }
    if (!promptContent.trim()) {
      setLoadError('提示词内容不能为空');
      return;
    }

    setSaving(true);
    setLoadError('');
    setActionMessage('');

    try {
      await saveTaskPrompt(selectedTaskId, promptContent);
      setActionMessage('提示词已保存到任务，并标记为 PromptReady');
      await loadTasks();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '提示词保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!promptContent.trim()) return;

    await navigator.clipboard.writeText(promptContent);
    setCopyState('done');
    setTimeout(() => setCopyState('idle'), 1800);
  };

  return (
    <div className="h-full flex flex-col p-8 bg-stone-50 dark:bg-[#161615]">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50 tracking-tight">提示词工坊</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
          基于已 Clone 的代码仓库生成、编辑并保存第二阶段提示词
        </p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[360px,minmax(0,1fr)] gap-6">
        <div className="min-h-0 overflow-y-auto space-y-4 pr-1">
          <section className={`${cardCls} p-6`}>
            <SectionHead
              title="任务与模型"
              description="选择任务、执行类型和当前用于生成提示词的模型提供商"
            />

            <div className="space-y-4">
              <Field label="任务">
                <select
                  value={selectedTaskId}
                  onChange={(event) => setSelectedTaskId(event.target.value)}
                  className={inputCls}
                >
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.id} · {task.projectName}
                    </option>
                  ))}
                  {!tasks.length && <option value="">暂无可生成提示词的任务</option>}
                </select>
              </Field>

              <Field label="任务类型">
                <select
                  value={taskType}
                  onChange={(event) => setTaskType(event.target.value)}
                  className={inputCls}
                >
                  {TASK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="提供商"
                hint="OpenAI 兼容可用于 OpenAI、DeepSeek、OpenRouter、通义等兼容接口"
              >
                <select
                  value={selectedProviderId}
                  onChange={(event) => setSelectedProviderId(event.target.value)}
                  className={inputCls}
                  disabled={!providers.length}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} · {provider.model}
                    </option>
                  ))}
                  {!providers.length && <option value="">请先在设置中配置提供商</option>}
                </select>
              </Field>

              {selectedTask && (
                <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3 space-y-2">
                  <InfoRow label="项目">{selectedTask.projectName}</InfoRow>
                  <InfoRow label="任务 ID">{selectedTask.id}</InfoRow>
                  <InfoRow label="当前状态">{selectedTask.status}</InfoRow>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={generating || !selectedTaskId || !selectedProviderId}
                  className={`${btnPrimary} flex-1`}
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {generating ? '生成中...' : '分析并生成'}
                </button>
                {!providers.length && (
                  <button
                    onClick={() => navigate('/settings')}
                    className={btnSecondary}
                  >
                    <Settings2 className="w-4 h-4" />
                    设置
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className={`${cardCls} p-6`}>
            <SectionHead
              title="生成约束"
              description="这些信息会直接写进提示词，约束后续模型的输出方式和改动边界"
            />

            <div className="space-y-5">
              <Field label="作用范围">
                <div className="flex flex-wrap gap-2">
                  {SCOPES.map((scope) => (
                    <button
                      key={scope}
                      onClick={() => toggleScope(scope)}
                      className={`px-3.5 py-2 rounded-2xl text-sm font-medium transition-colors cursor-default ${
                        selectedScopes.includes(scope)
                          ? 'bg-[#E7EDF5] dark:bg-[#1A1F29] text-[#111827] dark:text-[#F8FBFF] border border-[#D6E1EE] dark:border-[#2A3342]'
                          : 'bg-stone-50 dark:bg-stone-800/50 text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-700 hover:text-stone-800 dark:hover:text-stone-200'
                      }`}
                    >
                      {scope}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="约束条件">
                <div className="flex flex-wrap gap-2">
                  {CONSTRAINTS.map((constraint) => (
                    <button
                      key={constraint}
                      onClick={() => toggleConstraint(constraint)}
                      className={`px-3.5 py-2 rounded-2xl text-sm font-medium transition-colors cursor-default ${
                        selectedConstraints.includes(constraint)
                          ? 'bg-[#E7EDF5] dark:bg-[#1A1F29] text-[#111827] dark:text-[#F8FBFF] border border-[#D6E1EE] dark:border-[#2A3342]'
                          : 'bg-stone-50 dark:bg-stone-800/50 text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-700 hover:text-stone-800 dark:hover:text-stone-200'
                      }`}
                    >
                      {constraint}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="补充说明" hint="会作为额外上下文传给提示词工坊模型">
                <textarea
                  value={additionalNotes}
                  onChange={(event) => setAdditionalNotes(event.target.value)}
                  placeholder="例如：这次优先保留现有交互，不要大改 UI 结构；重点处理某几个模块。"
                  rows={5}
                  className={`${inputCls} resize-none leading-6`}
                />
              </Field>
            </div>
          </section>

          <section className={`${cardCls} p-6`}>
            <SectionHead
              title="代码分析"
              description="生成后会展示用于提示词拼装的仓库扫描结果，便于确认上下文是否正确"
            />

            {analysis ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3 space-y-2">
                  <InfoRow label="仓库路径">{analysis.repoPath}</InfoRow>
                  <InfoRow label="技术栈">{stackSummary}</InfoRow>
                  <InfoRow label="文件数">{String(analysis.totalFiles)}</InfoRow>
                </div>

                <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-300 mb-3">
                    <FolderTree className="w-4 h-4 text-stone-400" />
                    文件树节选
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {analysis.fileTree.map((line) => (
                      <p
                        key={line}
                        className="font-mono text-[12px] leading-5 text-stone-500 dark:text-stone-400"
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {analysis.keyFiles.map((file) => (
                    <div
                      key={file.path}
                      className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-700 flex items-center gap-2">
                        <FileCode2 className="w-4 h-4 text-stone-400" />
                        <span className="font-mono text-xs text-stone-700 dark:text-stone-300 truncate">
                          {file.path}
                        </span>
                      </div>
                      <pre className="p-4 text-[12px] leading-5 font-mono text-stone-600 dark:text-stone-400 whitespace-pre-wrap overflow-x-auto">
                        {file.snippet}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyCard
                icon={<Wand2 className="w-5 h-5" />}
                title="尚未生成仓库分析"
                description="点击“分析并生成”后，这里会展示扫描到的技术栈、文件树和关键文件摘录。"
              />
            )}
          </section>
        </div>

        <section className={`${cardCls} min-h-0 flex flex-col overflow-hidden`}>
          <div className="px-6 py-5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight">
                提示词正文
              </h2>
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                生成后可继续手动微调，再保存回任务
              </p>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {selectedProvider && (
                <Badge>
                  {selectedProvider.name} · {selectedProvider.model}
                </Badge>
              )}
              {copyState === 'done' && <Badge ok>已复制</Badge>}
              {actionMessage && <Badge ok>{actionMessage}</Badge>}
            </div>
          </div>

          <div className="flex-1 min-h-0 p-6 flex flex-col">
            {loadError && (
              <div className="mb-4 rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
                {loadError}
              </div>
            )}

            {!selectedTaskId ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyCard
                  icon={<Sparkles className="w-5 h-5" />}
                  title="暂无可编辑任务"
                  description="先完成第一阶段领题，或在看板中保留一个 Claimed / PromptReady 状态的任务。"
                />
              </div>
            ) : (
              <>
                <textarea
                  value={promptContent}
                  onChange={(event) => setPromptContent(event.target.value)}
                  placeholder="这里会显示生成后的提示词，也可以直接手动撰写。"
                  className="flex-1 min-h-[420px] w-full rounded-[28px] bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] px-6 py-5 font-mono text-[13px] leading-6 text-stone-700 dark:text-stone-300 focus:outline-none focus:ring-2 focus:ring-slate-400/30 resize-none"
                />

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-stone-500 dark:text-stone-400">
                    {selectedTask ? `${selectedTask.id} · ${selectedTask.projectName}` : '未选择任务'}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {!providers.length && (
                      <button onClick={() => navigate('/settings')} className={btnSecondary}>
                        前往模型设置
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={handleCopy}
                      disabled={!promptContent.trim()}
                      className={btnSecondary}
                    >
                      <Copy className="w-4 h-4" />
                      复制
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || !promptContent.trim()}
                      className={btnPrimary}
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {saving ? '保存中...' : '保存到任务'}
                    </button>
                  </div>
                </div>
              </>
            )}
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

function Badge({
  children,
  ok,
}: {
  children: ReactNode;
  ok?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
        ok
          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
      }`}
    >
      {children}
    </span>
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

function EmptyCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/50 px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white dark:bg-stone-800 text-stone-400">
        {icon}
      </div>
      <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{title}</p>
      <p className="text-sm leading-6 text-stone-500 dark:text-stone-400 mt-1">{description}</p>
    </div>
  );
}
