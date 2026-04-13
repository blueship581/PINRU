import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaskTypeQuotaEditor from './TaskTypeQuotaEditor';

describe('TaskTypeQuotaEditor', () => {
  it('shows fixed totals before per-task quotas', () => {
    render(
      <TaskTypeQuotaEditor
        taskTypes={['Bug修复']}
        quotas={{ Bug修复: 2 }}
        totals={{ Bug修复: 15 }}
        onTaskTypesChange={vi.fn()}
        onQuotasChange={vi.fn()}
        onTotalsChange={vi.fn()}
      />,
    );

    const [totalInput, quotaInput] = screen.getAllByRole('spinbutton');

    expect(totalInput).toHaveValue(15);
    expect(quotaInput).toHaveValue(2);
  });

  it('writes the first input back to fixed totals instead of per-task quotas', () => {
    const onTotalsChange = vi.fn();
    const onQuotasChange = vi.fn();

    render(
      <TaskTypeQuotaEditor
        taskTypes={['Bug修复']}
        quotas={{ Bug修复: 3 }}
        totals={{ Bug修复: 3 }}
        onTaskTypesChange={vi.fn()}
        onQuotasChange={onQuotasChange}
        onTotalsChange={onTotalsChange}
      />,
    );

    const [totalInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(totalInput, { target: { value: '30' } });

    expect(onTotalsChange).toHaveBeenCalledWith({ Bug修复: 30 });
    expect(onQuotasChange).not.toHaveBeenCalled();
  });

  it('renders quota preview as read-only when requested', () => {
    const onQuotasChange = vi.fn();

    render(
      <TaskTypeQuotaEditor
        taskTypes={['Bug修复']}
        quotas={{ Bug修复: 7 }}
        totals={{ Bug修复: 10 }}
        onTaskTypesChange={vi.fn()}
        onQuotasChange={onQuotasChange}
        onTotalsChange={vi.fn()}
        quotaFieldLabel="剩余额度"
        quotaFieldReadOnly
      />,
    );

    const [, quotaInput] = screen.getAllByRole('spinbutton');
    fireEvent.change(quotaInput, { target: { value: '3' } });

    expect(screen.getByText('剩余额度')).toBeInTheDocument();
    expect(quotaInput).toHaveValue(7);
    expect(onQuotasChange).not.toHaveBeenCalled();
  });
});
