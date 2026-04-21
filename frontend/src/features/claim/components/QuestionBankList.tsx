import { useEffect, useRef, useState, type FC } from 'react';
import { Check, ChevronDown, ChevronRight, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { QuestionBankItem } from '../../../api/git';
import {
  getQuestionBankSourceKindLabel,
  getQuestionBankStatusMeta,
} from '../utils/claimUtils';

function truncatePath(path: string, maxSegments = 3) {
  if (!path) return '';
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= maxSegments) return path;
  return `…/${segments.slice(-maxSegments).join('/')}`;
}

export default function QuestionBankList({
  filteredItems,
  selectableFilteredItems,
  totalCount,
  readyCount,
  selectedCount,
  selectedIdSet,
  allFilteredSelected,
  filter,
  setFilter,
  onToggleSelection,
  onToggleSelectAll,
  onSelectAll,
  onClearSelection,
  onInvertSelection,
  onRefresh,
  refreshingQuestionId,
  onDelete,
  deletingQuestionId,
  deleteError,
  loading,
  error,
}: {
  filteredItems: QuestionBankItem[];
  selectableFilteredItems: QuestionBankItem[];
  totalCount: number;
  readyCount: number;
  selectedCount: number;
  selectedIdSet: Set<number>;
  allFilteredSelected: boolean;
  filter: string;
  setFilter: (value: string) => void;
  onToggleSelection: (item: QuestionBankItem) => void;
  onToggleSelectAll: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onInvertSelection: () => void;
  onRefresh: (questionId: number) => void;
  refreshingQuestionId: number | null;
  onDelete: (item: QuestionBankItem) => void;
  deletingQuestionId: number | null;
  deleteError: string;
  loading: boolean;
  error: string;
}) {
  const hasSelectable = selectableFilteredItems.length > 0;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-50">
            项目题库
          </h3>
          <span className="text-[11px] text-stone-400 dark:text-stone-500">
            共 {totalCount} · 可建 {readyCount}
            {filter && ` · 筛选 ${filteredItems.length}`}
            {selectedCount > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  已选 {selectedCount}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={!hasSelectable || allFilteredSelected}
            title={filter ? '选中当前筛选下的全部可用题' : '选中全部可用题'}
            className="hover:text-slate-900 disabled:opacity-40 dark:hover:text-slate-200 cursor-default"
          >
            全选{filter ? ' 筛选' : ''} {selectableFilteredItems.length}
          </button>
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <button
            type="button"
            onClick={onInvertSelection}
            disabled={!hasSelectable}
            title={filter ? '在当前筛选范围内反转选择' : '反转全部题目的选择'}
            className="hover:text-slate-900 disabled:opacity-40 dark:hover:text-slate-200 cursor-default"
          >
            反选
          </button>
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
            className="hover:text-slate-900 disabled:opacity-40 dark:hover:text-slate-200 cursor-default"
          >
            清空
          </button>
        </div>
      </div>

      <label className="relative block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="按题目名 / ID / 来源筛选"
          className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-9 pr-3 text-xs focus:border-stone-300 focus:outline-none focus:ring-0 dark:border-stone-800 dark:bg-stone-900 dark:focus:border-stone-700"
        />
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {loading && totalCount === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-200 px-4 py-10 text-center text-xs text-stone-400 dark:border-stone-800 dark:text-stone-500">
          正在加载题库…
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-200 px-4 py-10 text-center text-xs text-stone-400 dark:border-stone-800 dark:text-stone-500">
          {totalCount === 0 ? '当前项目题库还是空的。' : '没有匹配的题目。'}
        </div>
      ) : (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white dark:divide-stone-800/70 dark:border-stone-800 dark:bg-stone-900/40">
          {filteredItems.map((item) => (
            <QuestionBankRow
              key={item.questionId}
              item={item}
              checked={selectedIdSet.has(item.questionId)}
              onToggleSelection={onToggleSelection}
              onRefresh={onRefresh}
              refreshing={refreshingQuestionId === item.questionId}
              onDelete={onDelete}
              deleting={deletingQuestionId === item.questionId}
            />
          ))}
        </ul>
      )}

      {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
    </section>
  );
}

const QuestionBankRow: FC<{
  item: QuestionBankItem;
  checked: boolean;
  onToggleSelection: (item: QuestionBankItem) => void;
  onRefresh: (questionId: number) => void;
  refreshing: boolean;
  onDelete: (item: QuestionBankItem) => void;
  deleting: boolean;
}> = ({ item, checked, onToggleSelection, onRefresh, refreshing, onDelete, deleting }) => {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  const statusMeta = getQuestionBankStatusMeta(item.status);
  const selectable = item.status === 'ready';
  const hasDetails = Boolean(item.sourcePath || item.archivePath || item.errorMessage);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current !== null) {
        window.clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  return (
    <li
      className={`group flex items-center gap-3 px-3 py-2 transition-colors ${
        checked ? 'bg-slate-50/70 dark:bg-slate-900/30' : 'hover:bg-stone-50/70 dark:hover:bg-stone-800/30'
      } ${selectable ? '' : 'opacity-60'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!selectable}
        onChange={() => onToggleSelection(item)}
        className="h-3.5 w-3.5 rounded border-stone-300 accent-slate-700 disabled:opacity-40 cursor-default"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => hasDetails && setExpanded((prev) => !prev)}
            className={`flex min-w-0 items-center gap-1 text-left ${
              hasDetails ? 'cursor-default' : 'cursor-default'
            }`}
          >
            {hasDetails &&
              (expanded ? (
                <ChevronDown className="h-3 w-3 flex-none text-stone-400" />
              ) : (
                <ChevronRight className="h-3 w-3 flex-none text-stone-400" />
              ))}
            <span className="truncate text-[13px] font-medium text-stone-900 dark:text-stone-100">
              {item.displayName}
            </span>
          </button>
          <span className="flex-none text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {getQuestionBankSourceKindLabel(item.sourceKind)}
          </span>
          <span
            className={`flex-none rounded px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.className}`}
          >
            {statusMeta.label}
          </span>
        </div>

        {expanded && hasDetails && (
          <div className="mt-1.5 space-y-1 pl-4 text-[11px] text-stone-500 dark:text-stone-400">
            {item.sourcePath && (
              <p title={item.sourcePath}>
                <span className="text-stone-400 dark:text-stone-600">源码</span>{' '}
                <span className="font-mono break-all">{truncatePath(item.sourcePath, 4)}</span>
              </p>
            )}
            {item.archivePath && (
              <p title={item.archivePath}>
                <span className="text-stone-400 dark:text-stone-600">归档</span>{' '}
                <span className="font-mono break-all">{truncatePath(item.archivePath, 4)}</span>
              </p>
            )}
            {item.errorMessage && (
              <p className="text-red-500">{item.errorMessage}</p>
            )}
          </div>
        )}
      </div>

      {item.sourceKind === 'gitlab' && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRefresh(item.questionId);
          }}
          disabled={refreshing}
          title="刷新源码"
          className="flex-none rounded p-1 text-stone-400 opacity-0 transition-opacity hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50 group-hover:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-default"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin opacity-100' : ''}`} />
        </button>
      )}

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (deleting) return;
          if (!confirmingDelete) {
            setConfirmingDelete(true);
            if (confirmTimerRef.current !== null) {
              window.clearTimeout(confirmTimerRef.current);
            }
            confirmTimerRef.current = window.setTimeout(() => {
              setConfirmingDelete(false);
              confirmTimerRef.current = null;
            }, 3000);
            return;
          }
          if (confirmTimerRef.current !== null) {
            window.clearTimeout(confirmTimerRef.current);
            confirmTimerRef.current = null;
          }
          setConfirmingDelete(false);
          onDelete(item);
        }}
        disabled={deleting}
        title={
          confirmingDelete
            ? '再次点击确认移除（将同时清除源码目录与归档压缩包）'
            : '移除题库条目'
        }
        className={`flex-none rounded p-1 transition-opacity disabled:opacity-50 cursor-default ${
          confirmingDelete
            ? 'bg-red-50 text-red-600 opacity-100 dark:bg-red-500/10 dark:text-red-400'
            : 'text-stone-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-500/10 dark:hover:text-red-400'
        }`}
      >
        {confirmingDelete ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Trash2 className={`h-3.5 w-3.5 ${deleting ? 'animate-pulse opacity-100' : ''}`} />
        )}
      </button>
    </li>
  );
};
