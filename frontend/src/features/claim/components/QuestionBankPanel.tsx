import { useQuestionBank } from '../hooks/useQuestionBank';
import { SyncToolbar } from './QuestionBankSyncCards';
import QuestionBankList from './QuestionBankList';
import BulkCreateSection from './BulkCreateSection';
import GitLabProjectAdder from './GitLabProjectAdder';
import type { ClaimProjectState } from '../hooks/useClaimProject';

export default function QuestionBankPanel({
  project,
}: {
  project: ClaimProjectState;
}) {
  const { activeProject } = project;

  const qb = useQuestionBank(
    activeProject?.id ?? '',
    activeProject?.questionBankProjectIds ?? '',
  );

  if (!activeProject) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-stone-400 dark:text-stone-500">
        暂无激活项目，请先在设置中创建并激活项目
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <SyncToolbar
        importingLocalSources={qb.importingLocalSources}
        localImportError={qb.localImportError}
        localImportResult={qb.localImportResult}
        onScan={qb.handleScanLocalQuestionBank}
        onImportArchives={qb.handleImportArchivesViaPicker}
        syncing={qb.questionBankSyncing}
        syncError={qb.questionBankSyncError}
        syncResult={qb.questionBankSyncResult}
        configuredGitLabQuestionIds={qb.configuredGitLabQuestionIds}
        onSync={qb.handleSyncGitLabQuestionBank}
        normalizing={qb.normalizing}
        normalizeError={qb.normalizeError}
        normalizeResult={qb.normalizeResult}
        onNormalize={qb.handleNormalize}
      />

      <GitLabProjectAdder
        activeProject={activeProject}
        onSync={qb.handleSyncGitLabQuestionBank}
        syncing={qb.questionBankSyncing}
      />

      <QuestionBankList
        filteredItems={qb.filteredQuestionBankItems}
        selectableFilteredItems={qb.selectableFilteredQuestionBankItems}
        totalCount={qb.questionBankItems.length}
        readyCount={qb.readyQuestionCount}
        selectedCount={qb.selectedQuestionCount}
        selectedIdSet={qb.selectedQuestionIdSet}
        allFilteredSelected={qb.allFilteredSelected}
        filter={qb.questionBankFilter}
        setFilter={qb.setQuestionBankFilter}
        onToggleSelection={qb.toggleQuestionSelection}
        onToggleSelectAll={qb.toggleSelectAllFiltered}
        onSelectAll={qb.selectAllFiltered}
        onClearSelection={qb.clearSelection}
        onInvertSelection={qb.invertSelectionOnFiltered}
        onRefresh={qb.handleRefreshQuestionBankItem}
        refreshingQuestionId={qb.refreshingQuestionId}
        onDelete={(item) => { void qb.handleDeleteQuestionBankItem(item.questionId); }}
        deletingQuestionId={qb.deletingQuestionId}
        deleteError={qb.deleteError}
        loading={qb.questionBankLoading}
        error={qb.questionBankError}
      />

      <BulkCreateSection
        project={project}
        selectedQuestionBankItems={qb.selectedQuestionBankItems}
        selectedQuestionCount={qb.selectedQuestionCount}
        onCreated={qb.reloadQuestionBankItems}
      />
    </div>
  );
}
