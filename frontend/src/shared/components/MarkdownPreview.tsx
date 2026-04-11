import type { ReactNode } from 'react';

type MarkdownPreviewProps = {
  content: string;
  className?: string;
  emptyMessage?: string;
};

type InlineToken = {
  start: number;
  end: number;
  kind: 'code' | 'link' | 'strong' | 'em';
  text: string;
  href?: string;
};

const containerClassName =
  'space-y-4 text-sm leading-7 text-stone-700 dark:text-stone-300';

function normalizeMarkdown(content: string) {
  return content.replace(/\r\n?/g, '\n');
}

function isSpecialBlockStart(line: string) {
  const trimmed = line.trim();
  return (
    /^```/.test(trimmed) ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

function findNextInlineToken(text: string, from: number): InlineToken | null {
  const matchers: Array<{
    kind: InlineToken['kind'];
    regex: RegExp;
    map: (match: RegExpExecArray) => Omit<InlineToken, 'start' | 'end' | 'kind'>;
  }> = [
    {
      kind: 'code',
      regex: /`([^`\n]+)`/g,
      map: (match) => ({ text: match[1] }),
    },
    {
      kind: 'link',
      regex: /\[([^\]]+)\]\(([^)\s]+)\)/g,
      map: (match) => ({ text: match[1], href: match[2] }),
    },
    {
      kind: 'strong',
      regex: /\*\*([^*\n][\s\S]*?)\*\*/g,
      map: (match) => ({ text: match[1] }),
    },
    {
      kind: 'strong',
      regex: /__([^_\n][\s\S]*?)__/g,
      map: (match) => ({ text: match[1] }),
    },
    {
      kind: 'em',
      regex: /\*([^*\n]+)\*/g,
      map: (match) => ({ text: match[1] }),
    },
    {
      kind: 'em',
      regex: /_([^_\n]+)_/g,
      map: (match) => ({ text: match[1] }),
    },
  ];

  let best: InlineToken | null = null;

  for (const matcher of matchers) {
    matcher.regex.lastIndex = from;
    const match = matcher.regex.exec(text);
    if (!match || typeof match.index !== 'number') {
      continue;
    }

    const candidate: InlineToken = {
      kind: matcher.kind,
      start: match.index,
      end: match.index + match[0].length,
      ...matcher.map(match),
    };

    if (
      best === null ||
      candidate.start < best.start ||
      (candidate.start === best.start && candidate.end > best.end)
    ) {
      best = candidate;
    }
  }

  return best;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor);
    if (!token) {
      nodes.push(text.slice(cursor));
      break;
    }

    if (token.start > cursor) {
      nodes.push(text.slice(cursor, token.start));
    }

    const tokenKey = `${keyPrefix}-${tokenIndex}`;
    tokenIndex += 1;

    if (token.kind === 'code') {
      nodes.push(
        <code
          key={tokenKey}
          className="rounded-lg bg-stone-100 px-1.5 py-0.5 font-mono text-[0.92em] text-stone-800 dark:bg-stone-800 dark:text-stone-100"
        >
          {token.text}
        </code>,
      );
    } else if (token.kind === 'link') {
      nodes.push(
        <a
          key={tokenKey}
          href={token.href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-4 transition-colors hover:text-sky-800 dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-200"
        >
          {renderInline(token.text, `${tokenKey}-link`)}
        </a>,
      );
    } else if (token.kind === 'strong') {
      nodes.push(
        <strong key={tokenKey} className="font-semibold text-stone-900 dark:text-stone-50">
          {renderInline(token.text, `${tokenKey}-strong`)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={tokenKey} className="italic text-stone-800 dark:text-stone-200">
          {renderInline(token.text, `${tokenKey}-em`)}
        </em>,
      );
    }

    cursor = token.end;
  }

  return nodes;
}

function renderInlineWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  return text.split('\n').flatMap((line, index) => {
    const lineKey = `${keyPrefix}-line-${index}`;
    if (index === 0) {
      return renderInline(line, lineKey);
    }
    return [<br key={`${lineKey}-break`} />, ...renderInline(line, lineKey)];
  });
}

function parseMarkdownBlocks(content: string, keyPrefix: string): ReactNode[] {
  const lines = normalizeMarkdown(content).split('\n');
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeMatch = trimmed.match(/^```([\w-]+)?\s*$/);
    if (codeMatch) {
      const language = codeMatch[1]?.trim() || '';
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }

      const blockKey = `${keyPrefix}-code-${index}`;
      nodes.push(
        <div
          key={blockKey}
          className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-950 text-stone-100 dark:border-stone-700"
        >
          {language && (
            <div className="border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
              {language}
            </div>
          )}
          <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-6">
            <code className="font-mono">{codeLines.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const blockKey = `${keyPrefix}-heading-${index}`;
      const contentNodes = renderInline(text, `${blockKey}-content`);
      if (level === 1) {
        nodes.push(
          <h1
            key={blockKey}
            className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50"
          >
            {contentNodes}
          </h1>,
        );
      } else if (level === 2) {
        nodes.push(
          <h2
            key={blockKey}
            className="text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50"
          >
            {contentNodes}
          </h2>,
        );
      } else if (level === 3) {
        nodes.push(
          <h3
            key={blockKey}
            className="text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-50"
          >
            {contentNodes}
          </h3>,
        );
      } else {
        nodes.push(
          <h4
            key={blockKey}
            className="text-base font-semibold tracking-tight text-stone-900 dark:text-stone-50"
          >
            {contentNodes}
          </h4>,
        );
      }
      index += 1;
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      nodes.push(
        <hr
          key={`${keyPrefix}-hr-${index}`}
          className="border-0 border-t border-stone-200 dark:border-stone-800"
        />,
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }

      nodes.push(
        <blockquote
          key={`${keyPrefix}-quote-${index}`}
          className="rounded-r-2xl border-l-4 border-amber-300 bg-amber-50/60 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <div className={containerClassName}>
            {parseMarkdownBlocks(quoteLines.join('\n'), `${keyPrefix}-quote-inner-${index}`)}
          </div>
        </blockquote>,
      );
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      let currentItem = (unorderedMatch ?? orderedMatch)?.[1] ?? '';
      index += 1;

      while (index < lines.length) {
        const nextLine = lines[index];
        const nextUnorderedMatch = nextLine.match(/^\s*[-*+]\s+(.*)$/);
        const nextOrderedMatch = nextLine.match(/^\s*\d+\.\s+(.*)$/);

        if ((ordered && nextOrderedMatch) || (!ordered && nextUnorderedMatch)) {
          items.push(currentItem);
          currentItem = (nextOrderedMatch ?? nextUnorderedMatch)?.[1] ?? '';
          index += 1;
          continue;
        }

        if (!nextLine.trim()) {
          break;
        }

        if (/^\s+/.test(nextLine)) {
          currentItem += `\n${nextLine.trim()}`;
          index += 1;
          continue;
        }

        break;
      }
      items.push(currentItem);

      const listItems = items.map((item, itemIndex) => (
        <li key={`${keyPrefix}-item-${itemIndex}`} className="pl-1">
          {renderInlineWithBreaks(item, `${keyPrefix}-item-content-${itemIndex}`)}
        </li>
      ));
      if (ordered) {
        nodes.push(
          <ol key={`${keyPrefix}-list-${index}`} className="list-decimal space-y-2 pl-5">
            {listItems}
          </ol>,
        );
      } else {
        nodes.push(
          <ul key={`${keyPrefix}-list-${index}`} className="list-disc space-y-2 pl-5">
            {listItems}
          </ul>,
        );
      }
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isSpecialBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    nodes.push(
      <p key={`${keyPrefix}-paragraph-${index}`}>
        {renderInlineWithBreaks(paragraphLines.join('\n'), `${keyPrefix}-paragraph-content-${index}`)}
      </p>,
    );
  }

  return nodes;
}

export default function MarkdownPreview({
  content,
  className,
  emptyMessage = '暂无内容',
}: MarkdownPreviewProps) {
  const rawContent = normalizeMarkdown(content);
  const normalized = rawContent.trim();

  if (!/\S/.test(rawContent)) {
    return (
      <p className="text-sm leading-6 text-stone-400 dark:text-stone-500">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={`${containerClassName} ${className ?? ''}`.trim()}>
      {parseMarkdownBlocks(normalized, 'markdown')}
    </div>
  );
}
