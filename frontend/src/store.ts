import { create } from 'zustand';
import { listModelRuns, listTasks, TaskFromDB, type ModelRunFromDB } from './services/task';
import { getActiveProjectId, getConfig, getProjects, normalizeProjectModels, type ProjectConfig } from './services/config';

export type TaskStatus = 'Claimed' | 'Downloading' | 'Downloaded' | 'PromptReady' | 'Submitted' | 'Error';

export interface Task {
  id: string;
  projectId: string;
  projectName: string;
  status: TaskStatus;
  createdAt: number;
  progress: number;
  totalModels: number;
  runningModels: number;
}

export interface CloneModel {
  id: string;
  name: string;
  isDefault: boolean;
}

function mapDbTaskToTask(dbTask: TaskFromDB): Task {
  return {
    id: dbTask.id,
    projectId: String(dbTask.gitlabProjectId),
    projectName: dbTask.projectName,
    status: dbTask.status as TaskStatus,
    createdAt: dbTask.createdAt,
    progress: 0,
    totalModels: 0,
    runningModels: 0,
  };
}

function isOriginModel(name: string) {
  return name.trim().toUpperCase() === 'ORIGIN';
}

interface AppState {
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  tasks: Task[];
  loadTasks: () => Promise<void>;
  addTask: (task: Task) => void;
  removeTask: (id: string) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  cloneModels: CloneModel[];
  loadCloneModels: () => Promise<void>;
  addCloneModel: (model: CloneModel) => void;
  removeCloneModel: (id: string) => void;
  updateCloneModel: (id: string, model: Partial<CloneModel>) => void;
  activeProject: ProjectConfig | null;
  loadActiveProject: () => Promise<void>;
  setActiveProject: (project: ProjectConfig) => void;
  resetForNewProject: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
  tasks: [],
  loadTasks: async () => {
    try {
      const activeProjectId = await getActiveProjectId();
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
          const runs = (runMap.get(dbTask.id) ?? []).filter((run) => !isOriginModel(run.modelName));
          const progress = runs.filter((run) => run.status === 'done').length;
          const runningModels = runs.filter((run) => run.status === 'running').length;

          return {
            ...mapDbTaskToTask(dbTask),
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
}));
