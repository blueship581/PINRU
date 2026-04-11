import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';

interface CopyIconButtonProps {
  value: string;
  label: string;
  className?: string;
  iconClassName?: string;
}

export function CopyIconButton({
  value,
  label,
  className,
  iconClassName,
}: CopyIconButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const handleCopy = async () => {
    const nextValue = value.trim();
    if (!nextValue) {
      return;
    }

    try {
      await navigator.clipboard.writeText(nextValue);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      aria-label={copied ? `${label}，已复制` : label}
      title={copied ? '已复制' : label}
      onClick={() => void handleCopy()}
      className={clsx(className)}
    >
      {copied ? (
        <Check className={clsx(iconClassName)} />
      ) : (
        <Copy className={clsx(iconClassName)} />
      )}
    </button>
  );
}
