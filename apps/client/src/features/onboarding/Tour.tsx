import { useEffect, useLayoutEffect, useState } from 'react';

/**
 * Guided tour (ARCHITECTURE §3.5, stage 4).
 *
 * Coach marks over the real UI, not a carousel of screenshots — people skip
 * carousels, and a screenshot stops matching the app the week after it is made.
 *
 * Each step points at a live element via `data-tour`. If the element is not on
 * screen the step is SKIPPED rather than pointing at nothing, so the tour
 * degrades quietly when the layout changes instead of breaking.
 */

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export const DEFAULT_STEPS: TourStep[] = [
  {
    target: 'safe-to-spend',
    title: 'Available to spend',
    body: 'Your spending budget, less what you have spent so far. Bills are counted separately, so this is money you can actually use.',
  },
  {
    target: 'gauge',
    title: 'Are you ahead or behind?',
    body: 'The ring shows budget used. The white mark is where you should be today.',
  },
  {
    target: 'add',
    title: 'Add a spend in seconds',
    body: 'Enter an amount and pick a category.',
  },
  {
    target: 'tabs',
    title: 'Everything else lives here',
    body: 'Activity, Budgets and Insights.',
  },
];

interface Rect { top: number; left: number; width: number; height: number }

export function Tour({ steps = DEFAULT_STEPS, onDone }: { steps?: TourStep[]; onDone: () => void }): JSX.Element | null {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Skip forward past any step whose target is not rendered.
  useLayoutEffect(() => {
    let idx = i;
    while (idx < steps.length) {
      const el = document.querySelector(`[data-tour="${steps[idx]!.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        if (idx !== i) setI(idx);
        return;
      }
      idx++;
    }
    onDone();
  }, [i, steps, onDone]);

  useEffect(() => {
    const onResize = (): void => {
      const el = document.querySelector(`[data-tour="${steps[i]?.target}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [i, steps]);

  const step = steps[i];
  if (!step || !rect) return null;

  const pad = 8;
  const spotlight: React.CSSProperties = {
    position: 'fixed',
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    borderRadius: 18,
    // A huge spread shadow dims everything EXCEPT this box — one element, no
    // four-panel overlay to keep in sync.
    boxShadow: '0 0 0 9999px rgba(6,8,13,.85)',
    border: '2px solid rgba(99,102,241,.9)',
    pointerEvents: 'none',
    zIndex: 200,
    transition: 'all .28s cubic-bezier(.2,.9,.25,1)',
  };

  const below = rect.top + rect.height / 2 < window.innerHeight / 2;
  const cardStyle: React.CSSProperties = {
    position: 'fixed',
    left: 16,
    right: 16,
    ...(below ? { top: rect.top + rect.height + pad + 14 } : { bottom: window.innerHeight - rect.top + pad + 14 }),
    zIndex: 201,
    padding: 'var(--s5)',
    borderRadius: 22,
    background: 'var(--surface)',
    border: '1px solid var(--line-strong)',
    boxShadow: '0 20px 60px -20px rgba(0,0,0,.9)',
    color: 'var(--text)',
    fontFamily: "'Plus Jakarta Sans',-apple-system,system-ui,sans-serif",
  };

  const last = i === steps.length - 1;

  return (
    <>
      <div style={spotlight} aria-hidden="true" />
      <div style={cardStyle} role="dialog" aria-label={step.title}>
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--brand-cyan)' }}>
          {i + 1} of {steps.length}
        </p>
        <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em', margin: '6px 0 6px' }}>{step.title}</h2>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.55 }}>{step.body}</p>

        <div style={{ display: 'flex', gap: 10, marginTop: 'var(--s4)' }}>
          <button
            type="button"
            onClick={onDone}
            style={{ flex: 1, minHeight: 46, borderRadius: 12, border: 0, background: 'transparent', color: 'var(--text-dim)', fontWeight: 600, cursor: 'pointer' }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => (last ? onDone() : setI(i + 1))}
            style={{ flex: 2, minHeight: 46, borderRadius: 12, border: 0, background: 'var(--brand)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}
