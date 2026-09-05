// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Onboarding, type OnboardingResult } from './Onboarding.js';

afterEach(cleanup);

const toBills = (): void => {
  // Straight through to the last step; every step is skippable by design.
  for (let i = 0; i < 7; i++) {
    const n = screen.queryByRole('button', { name: /Continue|Get started/i });
    if (n) fireEvent.click(n);
  }
};

describe('the bills step', () => {
  it('shows every bill at once, with no separate choosing phase', () => {
    render(<Onboarding onDone={() => {}} onSkip={() => {}} />);
    toBills();
    expect(screen.getByText('Bills and fixed costs')).toBeDefined();
    // All ten suggestions have an amount field waiting; nothing to select first.
    for (const n of ['Rent', 'Council tax', 'Energy', 'Gym']) {
      expect(screen.getByLabelText(`${n} amount`)).toBeDefined();
    }
  });

  it('reveals the due day only once there is something to pay', () => {
    render(<Onboarding onDone={() => {}} onSkip={() => {}} />);
    toBills();
    expect(screen.queryByLabelText('Rent due day')).toBeNull();
    fireEvent.change(screen.getByLabelText('Rent amount'), { target: { value: '650' } });
    expect(screen.getByLabelText('Rent due day')).toBeDefined();
  });

  it('treats an amount as the choice, and keeps blanks out', () => {
    /*
     * There is no "selected" state to drift from the figures any more: a bill
     * with nothing against it used to be savable as a £0 commitment that then
     * appeared on every screen.
     */
    let result: OnboardingResult | null = null;
    render(<Onboarding onDone={(r) => { result = r; }} onSkip={() => {}} />);
    toBills();
    fireEvent.change(screen.getByLabelText('Rent amount'), { target: { value: '650' } });
    fireEvent.change(screen.getByLabelText('Energy amount'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /Finish setup/i }));

    expect(result).not.toBeNull();
    const names = result!.fixedCosts.map((f) => f.name);
    expect(names).toEqual(['Rent', 'Energy']);
    expect(result!.fixedCosts[0]!.limitMinor).toBe(65000);
  });

  it('totals only what was filled in', () => {
    render(<Onboarding onDone={() => {}} onSkip={() => {}} />);
    toBills();
    fireEvent.change(screen.getByLabelText('Rent amount'), { target: { value: '650' } });
    fireEvent.change(screen.getByLabelText('Water amount'), { target: { value: '30' } });
    expect(screen.getByText('£680.00')).toBeDefined();
  });
});
