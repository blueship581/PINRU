import { create } from 'zustand';
import {
  listModelRuns,
  listTasks,
  TaskFromDB,
  type TaskSession,
  type ModelRunFromDB,
  type PromptGenerationStatus,
} from './api/task';
import {
  DEFAULT_TASK_TYPE,
  getActiveProjectId,
  getConfig,
  getProjects,
  normalizeProjectModels,
  normalizeTaskTypeName,
  type ProjectConfig,
  type TaskType,
} from './api/config';
import { listJobs, type BackgroundJob } from './api/job';

export type { TaskType } from './api/config';

export type TaskStatus = 'Claimed' | 'Downloading' | 'Downloaded' | 'PromptReady' | 'Submitted' | 'Error';

export interface Task {
  id: string;
  projectId: string;
  projectName: string;
  status: TaskStatus;
  taskType: TaskType;
  sessionList: TaskSession[];
  promptGenerationStatus: PromptGenerationStatus;
  promptGenerationError: string | null;
  createdAt: number;
  executionRounds: number;
  progress: number;
  totalModels: number;
  runningModels: number;
}

export interface CloneModel {
  id: string;
  name: string;
  isDefault: boolean;
}

function getExecutionRounds(dbTask: TaskFromDB): number {
  return Math.max(dbTask.sessionList?.length ?? 0, 1);
}

function buildPersistedTaskSessionList(
  dbTask: TaskFromDB,
  modelRuns: ModelRunFromDB[],
): TaskSession[] {
  const persistedModelSessions = modelRuns.flatMap((run) => run.sessionList ?? []);
  if (persistedModelSessions.length > 0) {
    return persistedModelSessions;
  }
  return dbTask.sessionList ?? [];
}

function getPersistedExecutionRounds(
  dbTask: TaskFromDB,
  modelRuns: ModelRunFromDB[],
): number {
  const maxModelRounds = modelRuns.reduce((maxRounds, run) => {
    const roundCount = run.sessionList?.length ?? 0;
    return roundCount > maxRounds ? roundCount : maxRounds;
  }, 0);
  if (maxModelRounds > 0) {
    return maxModelRounds;
  }
  return getExecutionRounds(dbTask);
}

function mapDbTaskToTask(dbTask: TaskFromDB, modelRuns: ModelRunFromDB[]): Task {
  const persistedSessionList = buildPersistedTaskSessionList(dbTask, modelRuns);
  return {
    id: dbTask.id,
    projectId: String(dbTask.gitlabProjectId),
    projectName: dbTask.projectName,
    status: dbTask.status as TaskStatus,
    taskType: normalizeTaskTypeName(dbTask.taskType) || DEFAULT_TASK_TYPE,
    sessionList: persistedSessionList,
    promptGenerationStatus: dbTask.promptGenerationStatus,
    promptGenerationError: dbTask.promptGenerationError,
    createdAt: dbTask.createdAt,
    executionRounds: getPersistedExecutionRounds(dbTask, modelRuns),
    progress: 0,
    totalModels: 0,
    runningModels: 0,
  };
}

function isOriginModel(name: string) {
  return name.trim().toUpperCase() === 'ORIGIN';
}

function isSourceModel(name: string, sourceModelName: string) {
  return name.trim().toUpperCase() === sourceModelName.trim().toUpperCase();
}

function isNonExecutionModel(name: string, sourceModelName: string) {
  return isOriginModel(name) || isSourceModel(name, sourceModelName);
}

interface AppState {
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  tasks: Task[];
  loadTasks: () => Promise<void>;
  addTask: (task: Task) => void;
  removeTask: (id: string) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  updateTaskType: (id: string, taskType: TaskType) => void;
  cloneModels: CloneModel[];
  loadCloneModels: () => Promise<void>;
  addCloneModel: (model: CloneModel) => void;
  removeCloneModel: (id: string) => void;
  updateCloneModel: (id: string, model: Partial<CloneModel>) => void;
  activeProject: ProjectConfig | null;
  loadActiveProject: () => Promise<void>;
  setActiveProject: (project: ProjectConfig) => void;
  resetForNewProject: () => Promise<void>;
  backgroundJobs: BackgroundJob[];
  loadBackgroundJobs: () => Promise<void>;
  updateBackgroundJob: (job: Partial<BackgroundJob> & { id: string }) => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
  tasks: [],
  loadTasks: async () => {
    try {
      const [activeProjectId, projects] = await Promise.all([
        getActiveProjectId(),
        getProjects(),
      ]);
      const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
      const sourceModelName = activeProject?.sourceModelFolder?.trim() || 'ORIGIN';
      const dbTasks = await listTasks(activeProjectId || undefined);
      const runsByTask = await Promise.all(
        dbTasks.map(async (task) => {
          try {
            const runs = await listModelRuns(task.id);
            return [task.id, runs] as const;
          } catch (error) {
            console.error(`Failed to load model runs for task ${task.id}:`, error);
            return [task.id, [] as ModelRunFromDB[]] as const;
          }
        }),
      );

      const runMap = new Map(runsByTask);
      set({
        tasks: dbTasks.map((dbTask) => {
          const runs = (runMap.get(dbTask.id) ?? []).filter(
            (run) => !isNonExecutionModel(run.modelName, sourceModelName),
          );
          const progress = runs.filter((run) => run.status === 'done').length;
          const runningModels = runs.filter((run) => run.status === 'running').length;
          const allRuns = runMap.get(dbTask.id) ?? [];

          return {
            ...mapDbTaskToTask(dbTask, allRuns),
            progress,
            totalModels: runs.length,
            runningModels,
          };
        }),
      });
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  },
  addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks] })),
  removeTask: (id) => set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
  updateTaskStatus: (id, status) => set((state) => ({
    tasks: state.tasks.map((t) => t.id === id ? { ...t, status } : t)
  })),
  updateTaskType: (id, taskType) => set((state) => ({
    tasks: state.tasks.map((t) => t.id === id ? { ...t, taskType } : t)
  })),
  cloneModels: [
    { id: 'ORIGIN', name: 'ORIGIN', isDefault: true },
    { id: 'cotv21-pro', name: 'cotv21-pro', isDefault: true },
    { id: 'cotv21.2-pro', name: 'cotv21.2-pro', isDefault: true },
  ],
  loadCloneModels: async () => {
    try {
      await useAppStore.getState().loadActiveProject();
      const { activeProject } = useAppStore.getState();
      const modelsStr = await getConfig('default_models');

      if (activeProject?.models) {
        const modelNames = normalizeProjectModels(activeProject.models);
        if (modelNames.length) {
          set({
            cloneModels: modelNames.map(name => ({
              id: name.trim(),
              name: name.trim(),
              isDefault: true,
            }))
          });
          return;
        }
      }

      if (modelsStr) {
        const names = modelsStr.split('\n').filter(n => n.trim());
        set({
          cloneModels: names.map(name => ({
            id: name.trim(),
            name: name.trim(),
            isDefault: true,
          }))
        });
      }
    } catch (err) {
      console.error('Failed to load clone models:', err);
    }
  },
  addCloneModel: (model) => set((state) => ({ cloneModels: [...state.cloneModels, model] })),
  removeCloneModel: (id) => set((state) => ({ cloneModels: state.cloneModels.filter(m => m.id !== id) })),
  updateCloneModel: (id, model) => set((state) => ({
    cloneModels: state.cloneModels.map(m => m.id === id ? { ...m, ...model } : m)
  })),
  activeProject: null,
  loadActiveProject: async () => {
    try {
      const [activeProjectId, projects] = await Promise.all([
        getActiveProjectId(),
        getProjects(),
      ]);
      const active = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;
      set({ activeProject: active });
    } catch (err) {
      console.error('Failed to load active project:', err);
    }
  },
  setActiveProject: (project) => set({ activeProject: project }),
  resetForNewProject: async () => {
    set({ tasks: [] });
    const { loadActiveProject, loadCloneModels, loadTasks } = useAppStore.getState();
    await loadActiveProject();
    await loadCloneModels();
    await loadTasks();
  },
  backgroundJobs: [],
  loadBackgroundJobs: async () => {
    try {
      const jobs = await listJobs();
      set({ backgroundJobs: jobs });
    } catch (err) {
      console.error('Failed to load background jobs:', err);
    }
  },
  updateBackgroundJob: (update) => set((state) => {
    const exists = state.backgroundJobs.some((j) => j.id === update.id);
    if (exists) {
      return {
        backgroundJobs: state.backgroundJobs.map((j) =>
          j.id === update.id ? { ...j, ...update } : j,
        ),
      };
    }

    return {
      backgroundJobs: [
        {
          id: update.id,
          jobType: 'unknown',
          taskId: null,
          status: 'pending',
          progress: 0,
          progressMessage: null,
          errorMessage: null,
          inputPayload: '{}',
          outputPayload: null,
          retryCount: 0,
          maxRetries: 0,
          timeoutSeconds: 0,
          createdAt: Math.floor(Date.now() / 1000),
          startedAt: null,
          finishedAt: null,
          ...update,
        },
        ...state.backgroundJobs,
      ],
    };
  }),
}));
