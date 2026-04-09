import { type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type Task } from '../store';
import { getTaskTypePresentation } from '../lib/taskTypes';

export default function TaskGroupSection({
  taskType,
  tasks,
  isCollapsed,
  onToggleCollapse,
  gridClass,
  hideHeader = false,
  renderTaskCard,
}: {
  taskType: string;
  tasks: Task[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  gridClass: string;
  hideHeader?: boolean;
  renderTaskCard: (task: Task) => ReactNode;
}) {
  const presentation = getTaskTypePresentation(taskType);

  return (
    <section className="space-y-3">
      {!hideHeader && (
        <button
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 text-left transition-colors hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900/70 dark:hover:border-stone-700 cursor-default"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${presentation.dot}`} />
            <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
              {presentation.label}
            </span>
            <span className="rounded-full border border-stone-200 bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
              {tasks.length}
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-stone-400 transition-transform dark:text-stone-500 ${
              isCollapsed ? '-rotate-90' : 'rotate-0'
            }`}
          />
        </button>
      )}

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <motion.div layout className={`grid gap-3 ${gridClass}`}>
              <AnimatePresence mode="popLayout">
                {tasks.map((task) => renderTaskCard(task))}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
