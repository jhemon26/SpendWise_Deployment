import { useRef, useState, type ReactNode } from 'react';

/**
 * A row that reveals actions when dragged left.
 *
 * Tapping a transaction used to open the editor, which made every scroll past
 * a list a chance to open something by accident. Actions now have to be asked
 * for: drag the row aside and two buttons appear beside it.
 *
 * The buttons are a SIBLING of the row in a track that slides, not a layer
 * underneath it. The underneath version needed the row to be opaque so it
 * could hide them, and no opaque colour was correct: the card is a 2.8%-white
 * translucent surface sitting on a page gradient, so a flat fill either let
 * the buttons show through or painted a dark block that did not match the card
 * and left seams down both sides. Sliding a track solves it outright — the
 * buttons are simply off the edge, clipped, with nothing to paint over.
 *
 * Pointer Events rather than touch handlers, so the same code covers finger,
 * trackpad and mouse, and a desktop reviewer can reach the actions too.
 *
 * The horizontal gesture must not fight the vertical scroll. Until the drag
 * has clearly committed to one axis nothing moves, and once it commits to
 * vertical the row bows out for the rest of that gesture — otherwise a list
 * becomes impossible to scroll with a thumb that is never perfectly straight.
 */

const ACTIONS_WIDTH = 108;   // two 40px buttons, a gap and the edge inset
const COMMIT_PX = 10;        // movement before an axis is decided
const OPEN_AT = 46;          // drag past this and it stays open

export function SwipeRow({
  children, onEdit, onDelete,
}: {
  children: ReactNode;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}): JSX.Element {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'none' | 'x' | 'y'>('none');

  if (!onEdit && !onDelete) return <>{children}</>;

  const settle = (to: number): void => { setDx(to); setOpen(to !== 0); };

  return (
    <div style={{ overflow: 'hidden' }}>
      <div
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY };
          axis.current = 'none';
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || axis.current === 'y') return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (axis.current === 'none') {
            if (Math.abs(mx) < COMMIT_PX && Math.abs(my) < COMMIT_PX) return;
            // Whichever axis moved further wins, and the decision sticks for
            // the rest of the gesture so the row cannot twitch mid-scroll.
            axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
            if (axis.current === 'y') return;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          const base = open ? -ACTIONS_WIDTH : 0;
          // Clamped: rightward drag past closed does nothing, and it cannot be
          // pulled further left than the actions beside it.
          setDx(Math.max(-ACTIONS_WIDTH, Math.min(0, base + mx)));
        }}
        onPointerUp={() => {
          if (axis.current === 'x') settle(dx < -OPEN_AT ? -ACTIONS_WIDTH : 0);
          start.current = null;
          axis.current = 'none';
        }}
        onPointerCancel={() => { settle(open ? -ACTIONS_WIDTH : 0); start.current = null; axis.current = 'none'; }}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          transform: `translateX(${dx}px)`,
          // Animate on release, follow the finger exactly while dragging.
          transition: start.current ? 'none' : 'transform .18s cubic-bezier(.2,.9,.25,1)',
          // Tells the browser we handle horizontal movement, so it keeps
          // owning vertical scroll rather than waiting on us.
          touchAction: 'pan-y',
        }}
      >
        {/* The row keeps the full width of the list, so nothing behind it
            shows and the card colour is whatever the card already is. */}
        <div style={{ flex: '0 0 100%', minWidth: 0 }}>{children}</div>

        <div
          onFocus={() => settle(-ACTIONS_WIDTH)}
          onBlur={(e) => {
            // Only close once focus has left the pair entirely, or tabbing
            // from Edit to Delete would slam the row shut between the two.
            if (!e.currentTarget.contains(e.relatedTarget)) settle(0);
          }}
          style={{
            flex: `0 0 ${ACTIONS_WIDTH}px`,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 8, paddingLeft: 8,
          }}
        >
          {onEdit && (
            <button
              type="button" aria-label="Edit transaction"
              onClick={() => { settle(0); onEdit(); }}
              style={round('var(--surface-3)', 'var(--text)')}
            >
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor"
                   strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h4L20 8l-4-4L4 16z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              type="button" aria-label="Delete transaction"
              onClick={() => { settle(0); onDelete(); }}
              style={round('var(--danger-soft)', 'var(--danger)')}
            >
              <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor"
                   strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const round = (bg: string, fg: string): React.CSSProperties => ({
  width: 40, height: 40, borderRadius: 999, border: 0, flexShrink: 0,
  background: bg, color: fg, display: 'grid', placeItems: 'center', cursor: 'pointer',
});
