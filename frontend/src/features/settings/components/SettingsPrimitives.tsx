import type { ReactNode } from 'react';
import { Check, Cpu, Loader2, X } from 'lucide-react';

export function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-7">
      <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight">{title}</h2>
      <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">{description}</p>
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-stone-700 dark:text-stone-300 mb-1.5">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5">{hint}</p>}
    </div>
  );
}

export function InfoText({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-stone-400 dark:text-stone-500 flex-shrink-0">{label}</span>
      <span className="text-right text-stone-700 dark:text-stone-300 break-all">{children}</span>
    </div>
  );
}

export function StatusBadge({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span
      className={`text-sm font-semibold flex items-center gap-1.5 ${
        ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      }`}
    >
      {ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
      {children}
    </span>
  );
}

export function MiniBadge({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
        ok
          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
      }`}
    >
      {children}
    </span>
  );
}

export function IconBtn({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-2 rounded-xl transition-colors cursor-default ${
        danger
          ? 'text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700'
      }`}
    >
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
    </div>
  );
}

export function ErrorMsg({ msg }: { msg: string }) {
  return <p className="text-sm text-red-500 font-medium">{msg}</p>;
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/50 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white dark:bg-stone-800 text-stone-400">
        {icon ?? <Cpu className="w-5 h-5" />}
      </div>
      <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{title}</p>
      <p className="text-sm leading-6 text-stone-500 dark:text-stone-400 mt-1">{description}</p>
    </div>
  );
}
