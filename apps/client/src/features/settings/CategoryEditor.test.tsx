// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CategoryEditor } from './Editors.js';

afterEach(cleanup);

describe('setting up a bill', () => {
  const open = (onSave = vi.fn()) => {
    render(<CategoryEditor cat={null} currency="GBP" onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByLabelText('Limit each cycle'), { target: { value: '650' } });
    return onSave;
  };
  const markFixed = (): void => {
    // The fixed/flow switch, whichever label it carries.
    const btn = screen.getAllByRole('button')
      .find((b) => /fixed|bill/i.test(b.textContent ?? ''));
    if (btn) fireEvent.click(btn);
  };

  it('asks how often it is due before anything else about timing', () => {
    open(); markFixed();
    expect(screen.getByText('How often is it due?')).toBeDefined();
    for (const t of ['Monthly', 'Quarterly', 'Yearly']) {
      expect(screen.getByRole('button', { name: t })).toBeDefined();
    }
  });

  it('offers one to four installments and nothing beyond', () => {
    open(); markFixed();
    expect(screen.getByRole('button', { name: 'All at once' })).toBeDefined();
    for (const n of ['2×', '3×', '4×']) {
      expect(screen.getByRole('button', { name: n })).toBeDefined();
    }
    expect(screen.queryByRole('button', { name: '5×' })).toBeNull();
  });

  it('defaults to spreading, which is the gentler failure', () => {
    open(); markFixed();
    expect(screen.getByText(/Spread across as many paydays as fit/)).toBeDefined();
  });

  it('saves the recurrence and the chosen split', () => {
    const onSave = open(); markFixed();
    fireEvent.click(screen.getByRole('button', { name: 'Quarterly' }));
    fireEvent.change(screen.getByLabelText('Due day'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: '3×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      name: 'Rent', is_fixed: true, due_day: 15,
      recurrence: 'quarterly', installments: 3,
    });
  });

  it('treats a second tap on the same choice as going back to automatic', () => {
    const onSave = open(); markFixed();
    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ installments: null });
  });
});

describe('a saving goal', () => {
  const open = (onSave = vi.fn()) => {
    render(<CategoryEditor cat={null} currency="GBP" onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'New laptop' } });
    fireEvent.change(screen.getByLabelText('Limit each cycle'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Saving goal' }));
    return onSave;
  };

  it('can be created at all', () => {
    open();
    expect(screen.getByRole('button', { name: 'Saving goal' })).toBeDefined();
  });

  it('asks how to split it, but not when it is due', () => {
    /* A goal has no due date — that is the whole difference from a bill. But
       it still needs a rate, which the split supplies. */
    open();
    expect(screen.queryByText('How often is it due?')).toBeNull();
    expect(screen.queryByLabelText('Due day')).toBeNull();
    expect(screen.getByText('Set aside over')).toBeDefined();
  });

  it('saves as a goal with no date and no recurrence', () => {
    const onSave = open();
    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const patch = onSave.mock.calls[0]![0];
    expect(patch).toMatchObject({ name: 'New laptop', kind: 'goal', is_fixed: true, installments: 2 });
    expect(patch.due_day).toBeNull();
    expect(patch.recurrence).toBeUndefined();
  });
});
