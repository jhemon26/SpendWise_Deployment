// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SwipeRow } from './SwipeRow.js';

/*
 * jsdom ships no PointerEvent, and without one fireEvent delivers an event
 * carrying no coordinates at all — so a drag test asserting "did not open"
 * passes whether the code works or not. MouseEvent already carries clientX and
 * clientY, so this is the smallest thing that makes the gestures real.
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
  }
}
globalThis.PointerEvent = TestPointerEvent as unknown as typeof globalThis.PointerEvent;

afterEach(cleanup);

/* wrapper (clips) > track (slides) > [0] the row, [1] the actions beside it */
const track = (c: HTMLElement): HTMLElement =>
  c.firstElementChild!.firstElementChild as HTMLElement;
const slider = track;
/** How far the track has slid. 0 means the actions are off the edge, unseen. */
const shift = (c: HTMLElement): string => track(c).style.transform;

describe('SwipeRow', () => {
  it('keeps its actions hidden until the row is moved', () => {
    /*
     * They were visible on a closed row: the sliding layer was painted with
     * --surface, which is 2.8% white, so the buttons behind it showed straight
     * through. Every transaction sat there with edit and delete on display.
     */
    const { container } = render(
      <SwipeRow onEdit={() => {}} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    // Closed means the track has not moved, so the actions sit past the
    // right edge of a clipping wrapper: off-screen, not merely transparent.
    expect(shift(container)).toBe('translateX(0px)');
    expect((container.firstElementChild as HTMLElement).style.overflow).toBe('hidden');
  });

  it('renders the row alone when it has no actions to offer', () => {
    const { container } = render(<SwipeRow><p>Tesco</p></SwipeRow>);
    expect(container.querySelector('button')).toBeNull();
    // The children, and nothing else — no swipe wrapper around them.
    expect(container.firstElementChild?.tagName).toBe('P');
    expect(container.textContent).toBe('Tesco');
  });

  it('paints no background of its own', () => {
    /*
     * The row used to paint an opaque colour so it could cover buttons sitting
     * underneath it. No flat colour was ever right — the card is a translucent
     * surface over a page gradient — so it showed as a dark block with a seam
     * down each side of the card. Nothing sits underneath now, so nothing is
     * painted, and the row is whatever colour the card already is.
     */
    const { container } = render(
      <SwipeRow onEdit={() => {}} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    expect(track(container).style.background).toBe('');
    expect((track(container).children[0] as HTMLElement).style.background).toBe('');
  });

  it('keeps the row at the full width of the list', () => {
    // If the row can shrink, the actions take space from it even while closed
    // and the content ends up inset from both edges of the card.
    const { container } = render(
      <SwipeRow onEdit={() => {}} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    expect((track(container).children[0] as HTMLElement).style.flex).toBe('0 0 100%');
  });

  it('reveals the actions once dragged far enough left', () => {
    const { container } = render(
      <SwipeRow onEdit={() => {}} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    slider(container).setPointerCapture = vi.fn();
    fireEvent.pointerDown(slider(container), { clientX: 200, clientY: 50, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(slider(container), { clientX: 140, clientY: 52, pointerId: 1 });
    fireEvent.pointerUp(slider(container), { pointerId: 1 });
    expect(shift(container)).toBe('translateX(-108px)');
  });

  it('does not open when the finger is scrolling the list', () => {
    // A vertical drag must never turn into a revealed row mid-scroll.
    const { container } = render(
      <SwipeRow onEdit={() => {}} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    slider(container).setPointerCapture = vi.fn();
    fireEvent.pointerDown(slider(container), { clientX: 200, clientY: 50, pointerId: 1, pointerType: 'touch' });
    // Well past the open threshold horizontally, but further still vertically:
    // only the axis decision keeps this row shut.
    fireEvent.pointerMove(slider(container), { clientX: 140, clientY: 170, pointerId: 1 });
    fireEvent.pointerUp(slider(container), { pointerId: 1 });
    expect(shift(container)).toBe('translateX(0px)');
  });

  it('springs back when the drag stops short of the threshold', () => {
    const { container } = render(
      <SwipeRow onEdit={() => {}} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    slider(container).setPointerCapture = vi.fn();
    fireEvent.pointerDown(slider(container), { clientX: 200, clientY: 50, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(slider(container), { clientX: 180, clientY: 50, pointerId: 1 });  // 20px < 46px
    fireEvent.pointerUp(slider(container), { pointerId: 1 });
    expect(shift(container)).toBe('translateX(0px)');
  });

  it('runs the action and closes the row', () => {
    const onEdit = vi.fn();
    const { container } = render(
      <SwipeRow onEdit={onEdit} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    slider(container).setPointerCapture = vi.fn();
    fireEvent.pointerDown(slider(container), { clientX: 200, clientY: 50, pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerMove(slider(container), { clientX: 130, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(slider(container), { pointerId: 1 });
    fireEvent.click(screen.getByLabelText('Edit transaction'));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(shift(container)).toBe('translateX(0px)');
  });

  it('reveals the actions for a keyboard user, who cannot swipe', () => {
    const { container } = render(
      <SwipeRow onEdit={() => {}} onDelete={() => {}}><p>Tesco</p></SwipeRow>,
    );
    fireEvent.focus(screen.getByLabelText('Edit transaction'));
    expect(shift(container)).toBe('translateX(-108px)');
  });
});
