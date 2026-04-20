import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { RepoPromptEntry, RepoPromptGroup } from '../utils/aggregation';
import { getTaskTypeChartColor } from '../utils/chartColor';
import { getTaskTypeDisplayLabel } from '../../../shared/lib/taskTypes';
import { saveTaskPrompt } from '../../../api/llm';

interface RepoPromptListProps {
  groups: RepoPromptGroup[];
  onTaskPromptSaved: (taskId: string, promptText: string) => void;
  reposPerPage?: number;
}

export default function RepoPromptList({
  groups,
  onTaskPromptSaved,
  reposPerPage = 5,
}: RepoPromptListProps) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => {
        if (group.repoName.toLowerCase().includes(q)) {
          return group;
        }
        const matchedEntries = group.entries.filter((e) =>
          e.promptText.toLowerCase().includes(q),
        );
        if (matchedEntries.length === 0) return null;
        return { ...group, entries: matchedEntries };
      })
      .filter((g): g is RepoPromptGroup => g !== null);
  }, [groups, search]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / reposPerPage));
  const safePage = Math.min(page, totalPages - 1);
  const pageGroups = useMemo(
    () => filteredGroups.slice(safePage * reposPerPage, safePage * reposPerPage + reposPerPage),
    [filteredGroups, safePage, reposPerPage],
  );

  useEffect(() => {
    if (editingTaskId && textareaRef.current) {
      textareaRef.current.focus();
      const end = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(end, end);
    }
  }, [editingTaskId]);

  const openEdit = (entry: RepoPromptEntry) => {
    setSaveError(null);
    setDraft(entry.promptText);
    setEditingTaskId(entry.taskId);
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setDraft('');
    setSaveError(null);
  };

  const handleSave = async (entry: RepoPromptEntry) => {
    const text = draft.trim();
    if (!text) {
      setSaveError('提示词不能为空，后端要求至少包含有效内容。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await saveTaskPrompt(entry.taskId, text);
      onTaskPromptSaved(entry.taskId, text);
      setEditingTaskId(null);
      setDraft('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (groups.length === 0) {
    return (
      <p className="rounded-2xl bg-stone-100/60 dark:bg-stone-800/30 px-4 py-6 text-sm text-stone-500">
        暂无任务。
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索仓库名 / 提示词内容…"
          className="w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 pl-8 pr-8 py-2 text-sm text-stone-700 dark:text-stone-200 placeholder:text-stone-400 outline-none focus:ring-2 focus:ring-stone-300/50 dark:focus:ring-stone-600/50 transition"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {filteredGroups.length === 0 && (
        <p className="rounded-2xl bg-stone-100/60 dark:bg-stone-800/30 px-4 py-6 text-sm text-stone-500 text-center">
          未找到匹配"<span className="font-medium text-stone-600 dark:text-stone-300">{search}</span>"的结果。
        </p>
      )}

      {pageGroups.map((group) => (
        <section
          key={group.repoId}
          className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#1A1A19] overflow-hidden"
        >
          <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-100 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-900/40">
            <div className="flex items-baseline gap-2 min-w-0">
              <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 truncate">
                {group.repoName}
              </h3>
              <span className="text-[11px] text-stone-400 tabular-nums flex-shrink-0">
                #{group.repoId}
              </span>
            </div>
            <span className="text-[11px] text-stone-400 flex-shrink-0">
              {group.entries.length} 个任务
            </span>
          </header>

          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {group.entries.map((entry) => {
              const isEditing = editingTaskId === entry.taskId;
              return (
                <li key={entry.taskId} className="px-4 py-3">
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 pt-0.5" style={{ width: 180 }}>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getTaskTypeChartColor(entry.taskType) }}
                        />
                        <span className="text-[13px] font-medium text-stone-800 dark:text-stone-100 truncate">
                          {getTaskTypeDisplayLabel(entry.taskType)}
                        </span>
                      </div>
                      <div
                        className="mt-1 text-[11px] text-stone-500 truncate"
                        title={entry.taskLabel}
                      >
                        {entry.taskLabel}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-stone-400">
                        {entry.status}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            ref={textareaRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                handleSave(entry);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                            rows={8}
                            placeholder="编辑该任务的提示词…"
                            className="block w-full resize-y rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-[#171B22] focus:outline-none focus:ring-2 focus:ring-slate-400/30 text-sm px-3.5 py-2.5 text-stone-800 dark:text-stone-100 placeholder:text-stone-400"
                          />
                          <div className="flex items-center gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => handleSave(entry)}
                              disabled={saving}
                              className="rounded-xl bg-[#111827] dark:bg-[#E5EAF2] px-3 py-1.5 text-xs font-semibold text-white dark:text-[#0D1117] hover:bg-[#1F2937] dark:hover:bg-[#F3F6FB] disabled:opacity-50 transition-colors"
                            >
                              {saving ? '保存中…' : '保存'}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="rounded-xl bg-stone-100 dark:bg-stone-800 px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
                            >
                              取消
                            </button>
                            <span className="text-stone-400">⌘/Ctrl + Enter 保存 · Esc 取消</span>
                            {saveError && (
                              <span className="text-red-500">{saveError}</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openEdit(entry)}
                          className="block w-full text-left rounded-xl px-3 py-2 -mx-3 -my-2 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors group"
                        >
                          {entry.promptText ? (
                            <pre
                              className="whitespace-pre-wrap break-words text-[13px] text-stone-700 dark:text-stone-300 leading-relaxed"
                              style={{ fontFamily: 'inherit' }}
                            >
                              {entry.promptText}
                            </pre>
                          ) : (
                            <span className="text-[13px] italic text-stone-400 group-hover:text-stone-600 dark:group-hover:text-stone-300">
                              该任务还没有提示词，点击编辑
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-stone-500 pt-1">
          <span>
            第 {safePage * reposPerPage + 1}-
            {Math.min((safePage + 1) * reposPerPage, filteredGroups.length)} / {filteredGroups.length} 个仓库
            {search && ` (共 ${groups.length} 个)`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-xl px-3 py-1.5 text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <span className="px-2 tabular-nums text-stone-500">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded-xl px-3 py-1.5 text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
