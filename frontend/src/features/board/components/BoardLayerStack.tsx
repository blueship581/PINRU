import type { MouseEvent, RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import TaskDetailDrawer from '../../../shared/components/TaskDetailDrawer';
import type { Task, TaskStatus } from '../../../store';
import type { ProjectConfig, TaskTypeQuotas } from '../../../api/config';
import type { TaskTypeOverviewSummary } from '../../../shared/lib/taskTypeOverview';
import {
  SessionExtractCandidateModal,
  TaskCardContextMenu,
} from './BoardOverlays';
import { DeleteTaskDialog } from './BoardMainContent';
import { STATUS } from './BoardPresentation';
import {
  EmptyProjectAside,
  ProjectOverviewPanel,
  ProjectPanel,
} from './ProjectPanels';
import type { BoardTaskDetailController } from '../hooks/useBoardTaskDetail';

export type TaskCardContextMenuState = {
  task: Task;
  position: {
    x: number;
    y: number;
  };
};

export function BoardLayerStack({
  taskCardContextMenu,
  taskCardContextMenuRef,
  availableTaskTypes,
  statusOptions,
  localFolderOpening,
  actionError,
  onOpenLocalFolder,
  onTaskCardStatusChange,
  onTaskCardTaskTypeChange,
  onTaskCardGeneratePrompt,
  showProjectOverview,
  activeProject,
  visibleProjectTaskSummaries,
  taskCount,
  onCloseProjectOverview,
  onNormalizeProjectOverview,
  onOpenTaskContextMenu,
  onSelectTaskFromOverview,
  pendingDelete,
  deleting,
  deleteError,
  onCancelDelete,
  onConfirmDelete,
  detail,
  detailEscCloseHintVisible,
  onCloseDetailDrawer,
  projectQuotas,
  sourceModelName,
  onOpenSubmit,
  showProjectPanel,
  onCloseProjectPanel,
  onProjectSaved,
}: {
  taskCardContextMenu: TaskCardContextMenuState | null;
  taskCardContextMenuRef: RefObject<HTMLDivElement | null>;
  availableTaskTypes: string[];
  statusOptions: TaskStatus[];
  localFolderOpening: boolean;
  actionError: string;
  onOpenLocalFolder: () => void;
  onTaskCardStatusChange: (status: TaskStatus) => void;
  onTaskCardTaskTypeChange: (taskType: string) => void;
  onTaskCardGeneratePrompt: (constraints: string[], scope: string) => void;
  showProjectOverview: boolean;
  activeProject: ProjectConfig | null;
  visibleProjectTaskSummaries: TaskTypeOverviewSummary[];
  taskCount: number;
  onCloseProjectOverview: () => void;
  onNormalizeProjectOverview: () => Promise<void>;
  onOpenTaskContextMenu: (event: MouseEvent, task: Task) => void;
  onSelectTaskFromOverview: (task: Task) => void;
  pendingDelete: Task | null;
  deleting: boolean;
  deleteError: string;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  detail: BoardTaskDetailController;
  detailEscCloseHintVisible: boolean;
  onCloseDetailDrawer: () => void;
  projectQuotas: TaskTypeQuotas;
  sourceModelName: string;
  onOpenSubmit: () => void;
  showProjectPanel: boolean;
  onCloseProjectPanel: () => void;
  onProjectSaved: (updated: ProjectConfig) => void;
}) {
  return (
    <AnimatePresence>
      {taskCardContextMenu && (
        <TaskCardContextMenu
          menuRef={taskCardContextMenuRef}
          task={taskCardContextMenu.task}
          position={taskCardContextMenu.position}
          statusOptions={statusOptions}
          availableTaskTypes={availableTaskTypes}
          statusChanging={detail.statusChanging}
          taskTypeChanging={detail.taskTypeChanging}
          localFolderOpening={localFolderOpening}
          actionError={actionError}
          onOpenLocalFolder={onOpenLocalFolder}
          onStatusChange={onTaskCardStatusChange}
          onTaskTypeChange={onTaskCardTaskTypeChange}
          onGeneratePrompt={onTaskCardGeneratePrompt}
        />
      )}

      {showProjectOverview && activeProject && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCloseProjectOverview}
            className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
          />
          <ProjectOverviewPanel
            project={activeProject}
            summaries={visibleProjectTaskSummaries}
            taskCount={taskCount}
            onClose={onCloseProjectOverview}
            onNormalized={onNormalizeProjectOverview}
            onOpenTaskContextMenu={onOpenTaskContextMenu}
            onSelectTask={onSelectTaskFromOverview}
          />
        </>
      )}

      {showProjectOverview && !activeProject && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCloseProjectOverview}
            className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
          />
          <EmptyProjectAside
            title="项目概况"
            widthClass="w-[520px]"
            onClose={onCloseProjectOverview}
          />
        </>
      )}

      {pendingDelete && (
        <DeleteTaskDialog
          task={pendingDelete}
          deleting={deleting}
          error={deleteError}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      )}

      {detail.selected && (
        <TaskDetailDrawer
          selected={detail.selected}
          selectedTaskDetail={detail.selectedTaskDetail}
          selectedModelRuns={detail.selectedModelRuns}
          drawerLoading={detail.drawerLoading}
          drawerError={detail.drawerError}
          statusChanging={detail.statusChanging}
          taskTypeChanging={detail.taskTypeChanging}
          sessionListDraft={detail.sessionListDraft}
          sessionListSaving={detail.sessionListSaving}
          sessionSaveState={detail.sessionSaveState}
          hasUnsavedSessionChanges={detail.hasUnsavedSessionChanges}
          sessionExtracting={detail.sessionExtracting}
          openSessionEditors={detail.openSessionEditors}
          copiedSessionId={detail.copiedSessionId}
          promptDraft={detail.promptDraft}
          promptSaving={detail.promptSaving}
          promptSaveState={detail.promptSaveState}
          promptCopied={detail.promptCopied}
          activeDrawerTab={detail.activeDrawerTab}
          sessionModelOptions={detail.sessionModelOptions}
          selectedSessionModelName={detail.selectedSessionModelName}
          sessionTaskTypeOptions={detail.sessionTaskTypeOptions}
          projectQuotas={projectQuotas}
          sourceModelName={sourceModelName}
          selectedPromptGenerationStatus={detail.selectedPromptGenerationStatus}
          selectedPromptGenerationMeta={detail.selectedPromptGenerationMeta}
          selectedPromptGenerationError={detail.selectedPromptGenerationError}
          escCloseHintVisible={detailEscCloseHintVisible}
          statusMeta={STATUS}
          statusOptions={statusOptions}
          onClose={onCloseDetailDrawer}
          onStatusChange={detail.handleStatusChange}
          onTabChange={detail.setActiveDrawerTab}
          onAddSession={detail.handleAddSession}
          onAutoExtractSessions={() => void detail.handleAutoExtractSessions()}
          onSessionChange={detail.handleSessionChange}
          onToggleSessionEditor={detail.toggleSessionEditor}
          onSessionEditorBlur={() => void detail.handleSessionEditorBlur()}
          onCopySessionId={detail.handleCopySessionId}
          onRemoveSession={detail.handleRemoveSession}
          onResetSessions={detail.handleResetSessions}
          onSaveSessionList={() => void detail.handleSessionListSave()}
          onPromptDraftChange={detail.handlePromptDraftChange}
          onPromptCopy={detail.handlePromptCopy}
          onPromptReset={detail.handlePromptReset}
          onPromptSave={() => void detail.handlePromptSave()}
          onSessionModelChange={(modelName) =>
            void detail.handleSessionModelChange(modelName)
          }
          onOpenSubmit={onOpenSubmit}
          llmProviders={detail.llmProviders}
          promptGenerating={detail.promptGenerating}
          onGeneratePrompt={(config) => void detail.handleGeneratePrompt(config)}
        />
      )}

      {detail.selected && detail.sessionExtractCandidates.length > 1 && (
        <SessionExtractCandidateModal
          candidates={detail.sessionExtractCandidates}
          selectedModelName={detail.selectedSessionModelName}
          modelRuns={detail.selectedModelRuns}
          onClose={detail.closeSessionExtractCandidates}
          onSelect={(candidate) =>
            detail.applyExtractedSessionCandidate(candidate)
          }
        />
      )}

      {showProjectPanel && activeProject && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCloseProjectPanel}
            className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
          />
          <ProjectPanel
            project={activeProject}
            onClose={onCloseProjectPanel}
            onSaved={onProjectSaved}
          />
        </>
      )}

      {showProjectPanel && !activeProject && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCloseProjectPanel}
            className="fixed inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm z-20"
          />
          <EmptyProjectAside
            title="项目配置"
            widthClass="w-[480px]"
            onClose={onCloseProjectPanel}
          />
        </>
      )}
    </AnimatePresence>
  );
}
