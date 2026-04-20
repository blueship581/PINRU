import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import {
  getTaskTypePresentation,
  getTaskTypeQuotaValue,
  normalizeTaskTypeName,
} from '../../../api/config';
import { planManagedClaimPaths, type QuestionBankItem } from '../../../api/git';
import { createTask } from '../../../api/task';
import {
  submitJob,
  type GitCloneResult,
  type QuestionBankMaterializePayload,
} from '../../../api/job';
import { useAppStore } from '../../../store';
import { DoneSummary, RunningRow } from './ClaimPrimitives';
import type { ClaimResult, ModelEntry } from '../types';
import {
  buildQuestionBankLimitKey,
  buildTaskLimitKey,
  getQuestionBankDisplayProjectId,
  partitionClaimsByProjectLimit,
} from '../utils/claimUtils';
import { runWithConcurrency } from '../utils/asyncPool';
import { waitForJobCompletion } from '../hooks/useWaitForJob';
import { toErrorMessage } from '../../../shared/lib/errorMessage';
import type { ClaimProjectState } from '../hooks/useClaimProject';

type PlannedBankClaim = {
  item: QuestionBankItem;
  plan: { sequence: number; taskPath: string; sourcePath: string };
  claimKey: string;
  displayProjectId: string;
};

export default function BulkCreateSection({
  project,
  selectedQuestionBankItems,
  selectedQuestionCount,
  onCreated,
}: {
  project: ClaimProjectState;
  selectedQuestionBankItems: QuestionBankItem[];
  selectedQuestionCount: number;
  onCreated: () => Promise<void>;
}) {
  const tasks = useAppStore((state) => state.tasks);
  const loadTasks = useAppStore((state) => state.loadTasks);

  const [creationPhase, setCreationPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [claimResults, setClaimResults] = useState<ClaimResult[]>([]);
  const [materializeProgressMsg, setMaterializeProgressMsg] = useState('');
  const [bulkCreateError, setBulkCreateError] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);

  const {
    activeProject,
    activeConfigId,
    selectedModels,
    sourceModel,
    claimTaskType,
    claimTaskTypeRemaining,
    claimSetCount,
    setClaimSetCount,
    maxClaimSetCount,
    projectTaskSettings,
    availableTaskTypes,
    setSelectedTaskType,
    getTaskTypeRemaining,
  } = project;

  const requestedClaimCount = selectedQuestionCount * claimSetCount;
  const overQuotaCount =
    claimTaskTypeRemaining !== null ? Math.max(0, requestedClaimCount - claimTaskTypeRemaining) : 0;
  const withinQuotaCount = requestedClaimCount - overQuotaCount;

  const runQuestionBankMaterializePlan = async (
    item: QuestionBankItem,
    taskPath: string,
    sourcePath: string,
    onStatusChange?: (modelId: string, status: ModelEntry['status']) => void,
  ): Promise<GitCloneResult> => {
    const copyTargets = selectedModels
      .filter((model) => model.id !== sourceModel.id)
      .map((model) => ({
        modelId: model.id,
        path: `${taskPath.replace(/\/+$/, '')}/${model.id}`,
      }));

    onStatusChange?.(sourceModel.id, 'copying');
    const payload: QuestionBankMaterializePayload = {
      bankSourcePath: item.sourcePath,
      targetSourcePath: sourcePath,
      sourceModelId: sourceModel.id,
      copyTargets,
    };

    const job = await submitJob({
      jobType: 'question_bank_materialize',
      taskId: '',
      inputPayload: JSON.stringify(payload),
      timeoutSeconds: 900,
    });

    const finalJob = await waitForJobCompletion(job.id, (runningJob) => {
      setMaterializeProgressMsg(runningJob.progressMessage ?? '');
      const inCopyPhase = runningJob.progress >= 55;
      onStatusChange?.(sourceModel.id, inCopyPhase ? 'done' : 'copying');
      for (const model of selectedModels) {
        if (model.id === sourceModel.id) continue;
        onStatusChange?.(model.id, inCopyPhase ? 'copying' : 'pending');
      }
    });

    setMaterializeProgressMsg('');
    if (finalJob.status === 'error') {
      onStatusChange?.(sourceModel.id, 'error');
      throw new Error(finalJob.errorMessage || '题库复制失败');
    }
    if (finalJob.status === 'cancelled') {
      onStatusChange?.(sourceModel.id, 'error');
      throw new Error('题库复制已取消');
    }
    if (!finalJob.outputPayload) {
      return {
        sourcePath,
        successfulModels: selectedModels.map((model) => model.id),
        failedModels: [],
      };
    }
    return JSON.parse(finalJob.outputPayload) as GitCloneResult;
  };

  const handleCreateTasksFromQuestionBank = async () => {
    if (selectedQuestionBankItems.length === 0 || !activeProject) return;
    setBulkCreateError('');

    const buildPlannedClaims = async (): Promise<PlannedBankClaim[]> => {
      const plannedGroups = await Promise.all(
        selectedQuestionBankItems.map(async (item) => ({
          item,
          plans: await planManagedClaimPaths(
            activeProject.cloneBasePath,
            item.displayName,
            item.questionId,
            claimTaskType,
            claimSetCount,
            activeProject.id,
          ),
        })),
      );

      return plannedGroups.flatMap(({ item, plans }) =>
        plans.map((plan) => ({
          item,
          plan,
          claimKey: `${item.questionId}:${plan.sequence}`,
          displayProjectId: getQuestionBankDisplayProjectId(item, plan.sequence),
        })),
      );
    };

    try {
      const allPlannedClaims = await buildPlannedClaims();
      const budgetExecutableClaims =
        claimTaskTypeRemaining !== null ? allPlannedClaims.slice(0, claimTaskTypeRemaining) : allPlannedClaims;
      const quotaExceededClaims =
        claimTaskTypeRemaining !== null ? allPlannedClaims.slice(claimTaskTypeRemaining) : [];
      const perQuestionLimit = getTaskTypeQuotaValue(projectTaskSettings.quotas, claimTaskType);
      const normalizedClaimTaskType = normalizeTaskTypeName(claimTaskType);
      const existingCounts = new Map<string, number>();

      for (const task of tasks) {
        if (normalizeTaskTypeName(task.taskType) !== normalizedClaimTaskType) continue;
        const limitKey = buildTaskLimitKey(task.projectId, task.projectName);
        existingCounts.set(limitKey, (existingCounts.get(limitKey) ?? 0) + 1);
      }

      const { executableClaims, exceededClaims: questionLimitExceededClaims } =
        partitionClaimsByProjectLimit(
          budgetExecutableClaims,
          (claim) => buildQuestionBankLimitKey(claim.item),
          existingCounts,
          perQuestionLimit,
        );

      const makeResult = (
        claim: PlannedBankClaim,
        status: ClaimResult['status'],
        message: string,
      ): ClaimResult => ({
        claimKey: claim.claimKey,
        projectId: String(claim.item.questionId),
        displayProjectId: claim.displayProjectId,
        projectName: claim.item.displayName,
        claimSequence: claim.plan.sequence,
        localPath: claim.plan.taskPath,
        status,
        message,
        modelStatuses: new Map(selectedModels.map((model) => [model.id, 'pending' as const])),
      });

      setCreationPhase('running');
      setClaimResults([
        ...executableClaims.map((claim) => makeResult(claim, 'pending', '等待中')),
        ...questionLimitExceededClaims.map((claim) =>
          makeResult(claim, 'quota_exceeded', '单题上限已达，跳过'),
        ),
        ...quotaExceededClaims.map((claim) =>
          makeResult(claim, 'quota_exceeded', '配额已满，跳过'),
        ),
      ]);

      let createdCount = 0;
      await runWithConcurrency(executableClaims, 3, async (claim) => {
        setClaimResults((prev) =>
          prev.map((result) =>
            result.claimKey === claim.claimKey
              ? { ...result, status: 'running', message: '正在从 question_bank 复制题目...' }
              : result,
          ),
        );

        try {
          const result = await runQuestionBankMaterializePlan(
            claim.item,
            claim.plan.taskPath,
            claim.plan.sourcePath,
            (modelId, status) => {
              setClaimResults((prev) =>
                prev.map((entry) => {
                  if (entry.claimKey !== claim.claimKey) return entry;
                  const updated = new Map(entry.modelStatuses);
                  updated.set(modelId, status);
                  return { ...entry, modelStatuses: updated };
                }),
              );
            },
          );

          await createTask({
            gitlabProjectId: claim.item.questionId,
            projectName: claim.item.displayName,
            taskType: claimTaskType,
            claimSequence: claim.plan.sequence,
            localPath: claim.plan.taskPath,
            sourceModelName: sourceModel.id,
            sourceLocalPath: claim.plan.sourcePath,
            models: result.successfulModels,
            projectConfigId: activeConfigId,
          });

          createdCount += 1;
          const isPartial = result.failedModels.length > 0;
          setClaimResults((prev) =>
            prev.map((entry) =>
              entry.claimKey === claim.claimKey
                ? {
                    ...entry,
                    status: isPartial ? 'partial' : 'done',
                    message: isPartial
                      ? `${result.successfulModels.length}/${selectedModels.length} 成功，失败：${result.failedModels.map((failure) => failure.modelId).join('，')}`
                      : `${result.successfulModels.length} 个副本已创建`,
                  }
                : entry,
            ),
          );
        } catch (error) {
          setClaimResults((prev) =>
            prev.map((entry) =>
              entry.claimKey === claim.claimKey
                ? { ...entry, status: 'error', message: toErrorMessage(error) }
                : entry,
            ),
          );
        }
      });

      if (createdCount > 0) {
        await loadTasks();
        await onCreated();
      }
    } catch (error) {
      setBulkCreateError(error instanceof Error ? error.message : '批量创建题卡失败');
    } finally {
      setCreationPhase('done');
      setMaterializeProgressMsg('');
    }
  };

  const hasSelection = selectedQuestionCount > 0;
  const hasResults = claimResults.length > 0;

  if (!hasSelection && !hasResults) {
    return null;
  }

  const taskTypeLabel = getTaskTypePresentation(claimTaskType).label;
  const running = creationPhase === 'running';

  return (
    <>
      {hasResults && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">
              执行记录
            </h3>
            {creationPhase === 'done' && <DoneSummary results={claimResults} />}
          </div>
          <div className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white px-3 dark:divide-stone-800/70 dark:border-stone-800 dark:bg-stone-900/40">
            {claimResults.map((result) => (
              <RunningRow key={result.claimKey} result={result} selectedModels={selectedModels} />
            ))}
          </div>
        </section>
      )}

      {hasSelection && (
        <div className="sticky bottom-4 z-20">
          <div className="rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg shadow-stone-900/5 backdrop-blur dark:border-stone-700 dark:bg-stone-900/95 dark:shadow-black/30">
            {optionsOpen && (
              <div className="mb-3 grid grid-cols-2 gap-3 border-b border-stone-100 pb-3 dark:border-stone-800">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-stone-500 dark:text-stone-400">
                    任务类型
                  </span>
                  <select
                    value={claimTaskType}
                    onChange={(event) => setSelectedTaskType(event.target.value)}
                    className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400/30 dark:border-stone-700 dark:bg-stone-800"
                  >
                    {availableTaskTypes.map((taskType) => {
                      const presentation = getTaskTypePresentation(taskType);
                      const remaining = getTaskTypeRemaining(taskType);
                      const suffix =
                        remaining === null ? '不限额' : `剩余 ${Math.max(0, remaining)}`;
                      return (
                        <option key={taskType} value={taskType}>
                          {presentation.label} · {suffix}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-stone-500 dark:text-stone-400">
                    套数
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={maxClaimSetCount}
                    value={claimSetCount}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(parsed) || parsed <= 0) {
                        setClaimSetCount(1);
                        return;
                      }
                      if (maxClaimSetCount !== undefined) {
                        setClaimSetCount(Math.min(parsed, maxClaimSetCount));
                        return;
                      }
                      setClaimSetCount(parsed);
                    }}
                    className="w-full rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400/30 dark:border-stone-700 dark:bg-stone-800"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium text-stone-900 dark:text-stone-100">
                  <span>已选 {selectedQuestionCount} 题</span>
                  <span className="text-stone-300 dark:text-stone-600">·</span>
                  <span className="text-stone-600 dark:text-stone-300">{taskTypeLabel}</span>
                  <span className="text-stone-300 dark:text-stone-600">·</span>
                  <span className="text-stone-600 dark:text-stone-300">{claimSetCount} 套</span>
                </div>
                <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                  请求 {requestedClaimCount} · 可执行{' '}
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {withinQuotaCount}
                  </span>
                  {overQuotaCount > 0 && (
                    <>
                      {' · '}
                      <span className="text-orange-500">超出 {overQuotaCount}</span>
                    </>
                  )}
                  {materializeProgressMsg && running && (
                    <>
                      {' · '}
                      <span className="text-stone-400">{materializeProgressMsg}</span>
                    </>
                  )}
                </p>
                {bulkCreateError && (
                  <p className="mt-0.5 text-[11px] text-red-500">{bulkCreateError}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOptionsOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800 cursor-default"
                title="更多选项"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${optionsOpen ? 'rotate-180' : ''}`}
                />
                选项
              </button>

              <button
                type="button"
                onClick={handleCreateTasksFromQuestionBank}
                disabled={withinQuotaCount === 0 || running}
                className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-[#111827] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1F2937] disabled:opacity-50 dark:bg-[#E5EAF2] dark:text-[#0D1117] dark:hover:bg-[#F3F6FB] cursor-default"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {running ? '创建中…' : `创建 ${withinQuotaCount} 套`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
