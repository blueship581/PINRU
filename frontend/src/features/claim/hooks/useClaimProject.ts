import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../../store';
import {
  DEFAULT_TASK_TYPE,
  getActiveProjectId,
  getProjectTaskSettings,
  getProjects,
  getTaskTypePresentation,
  getTaskTypeQuotaValue,
  normalizeProjectModels,
  normalizeTaskTypeName,
  type ProjectConfig,
  type TaskType,
  type TaskTypeQuotas,
} from '../../../api/config';
import { countCountedSessionsByTaskType } from '../../../shared/lib/sessionUtils';
import { getTaskTypeRemainingToCompleteCount } from '../../../shared/lib/taskTypeOverview';
import { pickSourceModel } from '../utils/claimUtils';
import type { ModelEntry } from '../types';

export type ClaimProjectState = {
  activeProject: ProjectConfig | null;
  activeConfigId: string | null;
  models: ModelEntry[];
  selectedModels: ModelEntry[];
  sourceModel: ModelEntry;
  preferredSourceModelName: string;
  cloneBasePath: string;
  projectTaskSettings: ReturnType<typeof getProjectTaskSettings>;
  availableTaskTypes: TaskType[];
  selectedTaskType: string | null;
  setSelectedTaskType: (value: string | null) => void;
  claimTaskType: string;
  claimTaskTypeRemaining: number | null;
  claimSetCount: number;
  setClaimSetCount: (value: number) => void;
  maxClaimSetCount: number | undefined;
  quotas: TaskTypeQuotas;
  getTaskTypeRemaining: (taskType: string) => number | null;
  loading: boolean;
};

export function useClaimProject(selectedCount = 1): ClaimProjectState {
  const tasks = useAppStore((state) => state.tasks);
  const loadTasks = useAppStore((state) => state.loadTasks);

  const [activeProject, setActiveProject] = useState<ProjectConfig | null>(null);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [selectedTaskType, setSelectedTaskType] = useState<string | null>(null);
  const [claimSetCount, setClaimSetCount] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await loadTasks();
      const [activeProjectId, projects] = await Promise.all([getActiveProjectId(), getProjects()]);
      const proj = projects.find((p) => p.id === activeProjectId) ?? projects[0];
      if (proj) {
        setActiveConfigId(proj.id);
        setActiveProject(proj);
      }
      setLoading(false);
    })();
  }, [loadTasks]);

  const modelList = useMemo(
    () => normalizeProjectModels(activeProject?.models ?? ''),
    [activeProject?.models],
  );

  const models = useMemo<ModelEntry[]>(
    () =>
      modelList.map((name) => ({
        id: name,
        name,
        checked: true,
        status: 'pending',
      })),
    [modelList],
  );

  const selectedModels = models.filter((m) => m.checked);
  const preferredSourceModelName = activeProject?.sourceModelFolder?.trim() || 'ORIGIN';
  const sourceModel = useMemo(
    () => pickSourceModel(selectedModels, preferredSourceModelName),
    [selectedModels, preferredSourceModelName],
  );

  const projectTaskSettings = useMemo(
    () => getProjectTaskSettings(activeProject),
    [activeProject],
  );
  const availableTaskTypes = projectTaskSettings.taskTypes;
  const quotas = projectTaskSettings.quotas;

  const submittedSessionsByTaskType = useMemo(
    () =>
      countCountedSessionsByTaskType(tasks, {
        status: 'Submitted',
        requireSessionId: true,
      }),
    [tasks],
  );

  const getTaskTypeRemaining = (taskType: string): number | null =>
    getTaskTypeRemainingToCompleteCount(
      taskType,
      quotas,
      projectTaskSettings.totals,
      submittedSessionsByTaskType[taskType] ?? 0,
    );

  const defaultTaskType = useMemo(
    () =>
      availableTaskTypes.find((taskType) => {
        const remaining = getTaskTypeRemaining(taskType);
        return remaining === null || remaining > 0;
      }) ??
      availableTaskTypes[0] ??
      DEFAULT_TASK_TYPE,
    [availableTaskTypes, projectTaskSettings.totals, quotas, submittedSessionsByTaskType],
  );

  const claimTaskType = selectedTaskType ?? defaultTaskType;
  const claimTaskTypeRemaining = getTaskTypeRemaining(claimTaskType);

  const maxClaimSetCount =
    selectedCount > 0 && claimTaskTypeRemaining !== null
      ? Math.max(1, Math.floor(claimTaskTypeRemaining / Math.max(1, selectedCount)))
      : undefined;

  useEffect(() => {
    if (maxClaimSetCount !== undefined && claimSetCount > maxClaimSetCount) {
      setClaimSetCount(maxClaimSetCount);
    }
  }, [claimSetCount, maxClaimSetCount]);

  useEffect(() => {
    if (selectedTaskType && !availableTaskTypes.includes(selectedTaskType)) {
      setSelectedTaskType(null);
    }
  }, [availableTaskTypes, selectedTaskType]);

  return {
    activeProject,
    activeConfigId,
    models,
    selectedModels,
    sourceModel,
    preferredSourceModelName,
    cloneBasePath: activeProject?.cloneBasePath ?? '',
    projectTaskSettings,
    availableTaskTypes,
    selectedTaskType,
    setSelectedTaskType,
    claimTaskType,
    claimTaskTypeRemaining,
    claimSetCount,
    setClaimSetCount,
    maxClaimSetCount,
    quotas,
    getTaskTypeRemaining,
    loading,
  };
}
