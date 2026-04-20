import { useState } from 'react';
import { GitFork, Library } from 'lucide-react';
import { useClaimProject } from './hooks/useClaimProject';
import QuestionBankPanel from './components/QuestionBankPanel';
import GitLabClaimPanel from './components/GitLabClaimPanel';
import type { ClaimMode } from './types';

const tabs: Array<{ value: ClaimMode; label: string; icon: typeof Library }> = [
  { value: 'bank', label: '综合题库', icon: Library },
  { value: 'gitlab', label: 'GitLab 领题', icon: GitFork },
];

export default function Claim() {
  const project = useClaimProject();
  const [mode, setMode] = useState<ClaimMode>('bank');

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            领题
          </h1>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {project.activeProject?.name ?? (project.loading ? '加载中…' : '暂未激活项目')}
          </p>
        </div>

        <nav className="inline-flex rounded-full border border-stone-200 bg-white/70 p-1 dark:border-stone-800 dark:bg-stone-900/60">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.value === mode;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setMode(tab.value)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors cursor-default ${
                  selected
                    ? 'bg-[#111827] text-white dark:bg-[#E5EAF2] dark:text-[#0D1117]'
                    : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      {mode === 'bank' ? (
        <QuestionBankPanel project={project} />
      ) : (
        <GitLabClaimPanel project={project} />
      )}
    </div>
  );
}
