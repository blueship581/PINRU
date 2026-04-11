import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownPreview from '../shared/components/MarkdownPreview';

describe('MarkdownPreview', () => {
  it('renders common markdown blocks and inline elements', () => {
    render(
      <MarkdownPreview
        content={[
          '# 项目记录',
          '',
          '- 第一轮梳理',
          '- 第二轮修复',
          '',
          '访问[文档](https://example.com/docs)并查看`任务提示词.md`。',
          '',
          '```ts',
          'const rounds = 2;',
          '```',
        ].join('\n')}
      />,
    );

    expect(screen.getByRole('heading', { name: '项目记录' })).toBeInTheDocument();
    expect(screen.getByText('第一轮梳理')).toBeInTheDocument();
    expect(screen.getByText('第二轮修复')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '文档' })).toHaveAttribute(
      'href',
      'https://example.com/docs',
    );
    expect(screen.getByText('任务提示词.md')).toBeInTheDocument();
    expect(screen.getByText('const rounds = 2;')).toBeInTheDocument();
  });

  it('shows the empty message when content is blank', () => {
    render(<MarkdownPreview content={' \n '} emptyMessage="还没有记录" />);

    expect(screen.getByText('还没有记录')).toBeInTheDocument();
  });
});
