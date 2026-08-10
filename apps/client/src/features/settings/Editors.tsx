import { useEffect, useRef, useState } from 'react';
import type { Bank, Category } from '@spendwise/shared-types';
import { toMinor, fromMinor, formatMoney } from '@spendwise/shared-types';
import { ICON_KEYS, ICONS } from '../../design-system/icons.js';
import { Avatar } from '../../design-system/components.js';
import { AVATAR_KEYS, SVG_PREFIX } from '../../design-system/avatars.js';

/**
 * The prototype's editing sheets, ported.
 *
 * Three editors share one bottom-sheet shell: a single value (budget, savings
 * target, name), a category (name, limit, icon, colour) and a bank (name,
 * colour). They are the only way to change anything from Profile, so each one
 * validates before it will save rather than writing a bad value and relying on
 * a later screen to cope with it.
 */

const PALETTE = [
  '#8B5CF6', '#6366F1', '#14B8A6', '#FB923C', '#EC4899', '#22D3EE',
  '#EAB308', '#94A3B8', '#64748B', '#10B981', '#F472B6', '#38BDF8',
];

/* ── shell ─────────────────────────────────────────────────────────────── */

function Scrim({ onClose, centred, children }: {
  onClose: () => void; centred?: boolean; children: React.ReactNode;
}): JSX.Element {
  // Escape closes; the same handler is what the scrim click uses, so there is
  // one way out rather than two that can drift apart.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        // Above the add sheet (100): the card editor can be opened from it, and
        // relying on DOM order for that is a trap for the next person.
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'rgba(8,8,10,.78)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: centred ? 'center' : 'flex-end',
        justifyContent: 'center', padding: centred ? 'var(--s5)' : 0,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: centred ? 320 : undefined,
          background: 'var(--surface)',
          border: centred ? '1px solid var(--line-strong)' : undefined,
          borderTop: centred ? undefined : '1px solid var(--line-strong)',
          borderRadius: centred ? 'var(--r-xl)' : 'var(--r-xl) var(--r-xl) 0 0',
          padding: centred ? 'var(--s5)' : 'var(--s3) var(--s5) var(--s6)',
          maxHeight: '92%', overflowY: 'auto',
        }}
      >
        {!centred && <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--line-strong)', margin: '0 auto var(--s4)' }} />}
        {children}
      </div>
    </div>
  );
}

const title: React.CSSProperties = {
  fontSize: 'var(--fs-md)', fontWeight: 800, letterSpacing: '-.02em',
  textAlign: 'center', marginBottom: 'var(--s4)',
};
const label: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.07em',
  textTransform: 'uppercase', color: 'var(--text-dim)', margin: 'var(--s4) 0 var(--s2)',
};
const field: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', padding: '12px var(--s4)',
  fontSize: 'var(--fs-sm)', fontWeight: 600, outline: 'none', color: 'var(--text)',
};
const btnRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s2)', marginTop: 'var(--s4)' };
const primary: React.CSSProperties = {
  width: '100%', background: 'var(--brand)', color: '#fff', padding: 15,
  borderRadius: 'var(--r-md)', border: 0, fontSize: 'var(--fs-md)', fontWeight: 800, cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', color: 'var(--text-muted)', padding: 13,
  borderRadius: 'var(--r-md)', border: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer',
};
const danger: React.CSSProperties = {
  width: '100%', background: 'var(--danger-soft)', color: 'var(--danger)', padding: 13,
  borderRadius: 'var(--r-md)', border: 0, fontSize: 'var(--fs-sm)', fontWeight: 700,
  cursor: 'pointer', marginTop: 'var(--s2)',
};

/* ── single value ──────────────────────────────────────────────────────── */

export interface ValueEdit {
  kind: 'money' | 'text';
  heading: string;
  value: string;
  currency: string;
  onSave: (raw: string) => void;
}

export function ValueEditor({ edit, onClose }: { edit: ValueEdit; onClose: () => void }): JSX.Element {
  const [v, setV] = useState(edit.value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  // Money is parsed from the STRING, never via parseFloat * 100 — see
  // shared-types/currency. An unparseable amount blocks the save.
  const valid = edit.kind === 'text'
    ? v.trim().length > 0
    : (() => { try { return toMinor(v.trim(), edit.currency) >= 0; } catch { return false; } })();

  const save = (): void => { if (valid) { edit.onSave(v.trim()); onClose(); } };

  return (
    <Scrim onClose={onClose} centred>
      <p style={title}>{edit.heading}</p>
      <input
        ref={ref}
        style={field}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        inputMode={edit.kind === 'money' ? 'decimal' : 'text'}
        aria-label={edit.heading}
      />
      {!valid && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', fontWeight: 600, marginTop: 'var(--s2)' }}>
          {edit.kind === 'money' ? 'Enter an amount, for example 820' : 'This cannot be empty'}
        </p>
      )}
      <div style={btnRow}>
        <button type="button" style={ghost} onClick={onClose}>Cancel</button>
        <button type="button" style={{ ...primary, opacity: valid ? 1 : .35, cursor: valid ? 'pointer' : 'not-allowed' }} disabled={!valid} onClick={save}>Save</button>
      </div>
    </Scrim>
  );
}

/* ── category ──────────────────────────────────────────────────────────── */

export function CategoryEditor({ cat, currency, onSave, onDelete, onClose }: {
  cat: Category | null;
  currency: string;
  onSave: (patch: { local_id?: string; name: string; icon: string; colour: string; limit_minor: number; is_fixed: boolean; due_day: number | null }) => void;
  onDelete?: (localId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(cat?.name ?? '');
  const [icon, setIcon] = useState(cat?.icon ?? 'other');
  const [colour, setColour] = useState(cat?.colour ?? PALETTE[1]!);
  const [limit, setLimit] = useState(cat ? String(fromMinor(cat.limit_minor, currency)) : '');
  const [fixed, setFixed] = useState(cat?.is_fixed ?? false);
  const [dueDay, setDueDay] = useState(cat?.due_day ? String(cat.due_day) : '');

  let limitMinor = 0;
  let limitOk = true;
  try { limitMinor = limit.trim() ? toMinor(limit.trim(), currency) : 0; } catch { limitOk = false; }

  const dayNum = Number(dueDay);
  const dayOk = !fixed || dueDay.trim() === '' || (Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31);
  const valid = name.trim().length > 0 && limitOk && limitMinor >= 0 && dayOk;

  return (
    <Scrim onClose={onClose}>
      <p style={title}>{cat ? 'Edit category' : 'New category'}</p>

      <input style={field} value={name} maxLength={24} placeholder="Category name"
             aria-label="Category name" onChange={(e) => setName(e.target.value)} />

      <p style={label}>Monthly limit</p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-dim)' }}>
          {formatMoney(0, currency).replace(/[\d.,\s]/g, '')}
        </span>
        <input
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          aria-label="Monthly limit"
          style={{
            background: 'none', border: 0, outline: 'none', padding: 0, color: 'var(--text)',
            fontSize: 28, fontWeight: 800, letterSpacing: '-.04em',
            fontVariantNumeric: 'tabular-nums', width: '100%',
          }}
        />
      </div>
      {!limitOk && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', fontWeight: 600, marginTop: 6 }}>
          That is not an amount.
        </p>
      )}

      <p style={label}>Type</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, background: 'var(--surface-2)', borderRadius: 'var(--r-pill)', padding: 3 }}>
        {([[false, 'Day-to-day'], [true, 'Fixed cost']] as const).map(([val, text]) => (
          <button
            key={text}
            type="button"
            aria-pressed={fixed === val}
            onClick={() => setFixed(val)}
            style={{
              fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '8px 0', border: 0, cursor: 'pointer',
              borderRadius: 'var(--r-pill)',
              background: fixed === val ? 'var(--surface-3)' : 'transparent',
              color: fixed === val ? 'var(--text)' : 'var(--text-dim)',
            }}
          >{text}</button>
        ))}
      </div>

      {fixed && (
        <>
          <p style={label}>Due day of the month</p>
          <input style={field} value={dueDay} inputMode="numeric" placeholder="e.g. 15"
                 aria-label="Due day" onChange={(e) => setDueDay(e.target.value)} />
          {!dayOk && (
            <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', fontWeight: 600, marginTop: 6 }}>
              Use a day between 1 and 31.
            </p>
          )}
        </>
      )}

      <p style={label}>Icon</p>
      <div role="group" aria-label="Icon" style={{
        display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 'var(--s2)',
        maxHeight: 186, overflowY: 'auto', padding: 2,
      }}>
        {ICON_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={icon === k}
            aria-label={k}
            onClick={() => setIcon(k)}
            style={{
              aspectRatio: '1', borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center',
              background: 'var(--surface-2)', cursor: 'pointer',
              border: `1.5px solid ${icon === k ? colour : 'transparent'}`,
              color: icon === k ? 'var(--text)' : 'var(--text-dim)',
            }}
          >
            <svg viewBox="0 0 24 24" width={19} height={19} stroke="currentColor" strokeWidth={2}
                 fill="none" strokeLinecap="round" strokeLinejoin="round"
                 dangerouslySetInnerHTML={{ __html: ICONS[k] ?? '' }} />
          </button>
        ))}
      </div>

      <p style={label}>Colour</p>
      <div role="group" aria-label="Colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={colour === c}
            aria-label={c}
            onClick={() => setColour(c)}
            style={{
              width: 34, height: 34, borderRadius: 'var(--r-pill)', display: 'grid', placeItems: 'center',
              background: 'none', cursor: 'pointer',
              border: `2.5px solid ${colour === c ? 'var(--text)' : 'transparent'}`,
              transform: colour === c ? 'scale(1.06)' : undefined,
            }}
          >
            <i style={{ width: 22, height: 22, borderRadius: 'var(--r-pill)', background: c }} />
          </button>
        ))}
      </div>

      <div style={btnRow}>
        <button type="button" style={ghost} onClick={onClose}>Cancel</button>
        <button
          type="button"
          disabled={!valid}
          style={{ ...primary, opacity: valid ? 1 : .35, cursor: valid ? 'pointer' : 'not-allowed' }}
          onClick={() => {
            if (!valid) return;
            onSave({
              ...(cat ? { local_id: cat.local_id } : {}),
              name: name.trim(), icon, colour, limit_minor: limitMinor, is_fixed: fixed,
              due_day: fixed && dueDay.trim() ? dayNum : null,
            });
            onClose();
          }}
        >Save</button>
      </div>

      {cat && onDelete && (
        <button type="button" style={danger} onClick={() => { onDelete(cat.local_id); onClose(); }}>
          Delete category
        </button>
      )}
    </Scrim>
  );
}

/* ── bank ──────────────────────────────────────────────────────────────── */

export function BankEditor({ bank, onSave, onDelete, onClose }: {
  bank: Bank | null;
  onSave: (patch: { local_id?: string; name: string; colour: string }) => void;
  onDelete?: (localId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(bank?.name ?? '');
  const [colour, setColour] = useState(bank?.colour ?? PALETTE[1]!);
  const valid = name.trim().length > 0;

  return (
    <Scrim onClose={onClose}>
      <p style={title}>{bank ? 'Edit bank or card' : 'New bank or card'}</p>
      <input style={field} value={name} maxLength={24} placeholder="Name, e.g. Monzo"
             aria-label="Bank name" onChange={(e) => setName(e.target.value)} />

      <p style={label}>Colour</p>
      <div role="group" aria-label="Colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={colour === c}
            aria-label={c}
            onClick={() => setColour(c)}
            style={{
              width: 34, height: 34, borderRadius: 'var(--r-pill)', display: 'grid', placeItems: 'center',
              background: 'none', cursor: 'pointer',
              border: `2.5px solid ${colour === c ? 'var(--text)' : 'transparent'}`,
              transform: colour === c ? 'scale(1.06)' : undefined,
            }}
          >
            <i style={{ width: 22, height: 22, borderRadius: 'var(--r-pill)', background: c }} />
          </button>
        ))}
      </div>

      <div style={btnRow}>
        <button type="button" style={ghost} onClick={onClose}>Cancel</button>
        <button
          type="button"
          disabled={!valid}
          style={{ ...primary, opacity: valid ? 1 : .35, cursor: valid ? 'pointer' : 'not-allowed' }}
          onClick={() => {
            if (!valid) return;
            onSave({ ...(bank ? { local_id: bank.local_id } : {}), name: name.trim(), colour });
            onClose();
          }}
        >Save</button>
      </div>

      {bank && onDelete && (
        <button type="button" style={danger} onClick={() => { onDelete(bank.local_id); onClose(); }}>
          Delete
        </button>
      )}
    </Scrim>
  );
}

/* ── avatar ────────────────────────────────────────────────────────────── */

export function AvatarEditor({ emoji, colour, name, onSave, onClose }: {
  emoji: string; colour: string; name: string;
  onSave: (next: { emoji: string; colour: string }) => void;
  onClose: () => void;
}): JSX.Element {
  const [pick, setPick] = useState(emoji);
  const [tint, setTint] = useState(colour);

  return (
    <Scrim onClose={onClose}>
      <p style={title}>Choose your look</p>

      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 'var(--s4)' }}>
        <Avatar emoji={pick} colour={tint} name={name} size={72} />
      </div>

      <div role="group" aria-label="Illustrated avatar" style={{
        display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 'var(--s2)',
        maxHeight: 220, overflowY: 'auto', padding: 2,
      }}>
        {AVATAR_KEYS.map((k) => {
          const value = SVG_PREFIX + k;
          const on = pick === value;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              aria-label={k}
              onClick={() => setPick(value)}
              style={{
                aspectRatio: '1', borderRadius: 'var(--r-md)', cursor: 'pointer',
                display: 'grid', placeItems: 'center', padding: 3,
                background: on ? 'var(--brand-soft)' : 'var(--surface-2)',
                border: `1.5px solid ${on ? 'var(--line-brand)' : 'transparent'}`,
              }}
            >
              <Avatar emoji={value} colour={tint} name={name} size={30} />
            </button>
          );
        })}
      </div>

      {!pick && (
        <>
      <p style={label}>Initials background</p>
      <div role="group" aria-label="Background colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={tint === c}
            aria-label={c}
            onClick={() => setTint(c)}
            style={{
              width: 34, height: 34, borderRadius: 'var(--r-pill)', display: 'grid', placeItems: 'center',
              background: 'none', cursor: 'pointer',
              border: `2.5px solid ${tint === c ? 'var(--text)' : 'transparent'}`,
              transform: tint === c ? 'scale(1.06)' : undefined,
            }}
          >
            <i style={{ width: 22, height: 22, borderRadius: 'var(--r-pill)', background: c }} />
          </button>
        ))}
      </div>
        </>
      )}

      <div style={btnRow}>
        <button type="button" style={ghost} onClick={() => { onSave({ emoji: '', colour: tint }); onClose(); }}>
          Use initials
        </button>
        <button type="button" style={primary} onClick={() => { onSave({ emoji: pick, colour: tint }); onClose(); }}>
          Save
        </button>
      </div>
    </Scrim>
  );
}

/* ── delete account ────────────────────────────────────────────────────── */

/**
 * Irreversible, so it asks for the word to be typed.
 *
 * A plain "are you sure?" is dismissed reflexively; typing DELETE forces the
 * user to read what they are about to do. For an action that destroys every
 * transaction they have ever recorded, that friction is the point.
 */
export function DeleteAccountEditor({ onConfirm, onClose }: {
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ok = typed.trim().toUpperCase() === 'DELETE';

  return (
    <Scrim onClose={busy ? () => undefined : onClose} centred>
      <p style={title}>Delete your account</p>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 'var(--s4)' }}>
        This removes every transaction, category, budget and setting from your
        account and from this device. It cannot be undone.
      </p>
      <label htmlFor="sw-del" style={{ ...label, marginTop: 0 }}>Type DELETE to confirm</label>
      <input
        id="sw-del"
        style={field}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        aria-label="Type DELETE to confirm"
      />

      {failed && (
        <p role="alert" style={{ fontSize: 'var(--fs-2xs)', color: 'var(--danger)', fontWeight: 600, marginTop: 'var(--s2)' }}>
          {failed}
        </p>
      )}

      <div style={btnRow}>
        <button type="button" style={ghost} disabled={busy} onClick={onClose}>Cancel</button>
        <button
          type="button"
          disabled={!ok || busy}
          onClick={() => {
            setBusy(true); setFailed(null);
            onConfirm().catch(() => {
              // Never pretend it worked — the account would still exist.
              setFailed('Could not delete the account. Check your connection and try again.');
              setBusy(false);
            });
          }}
          style={{
            width: '100%', padding: 15, borderRadius: 'var(--r-md)', border: 0,
            fontSize: 'var(--fs-md)', fontWeight: 800,
            background: 'var(--danger)', color: '#fff',
            opacity: ok && !busy ? 1 : .35,
            cursor: ok && !busy ? 'pointer' : 'not-allowed',
          }}
        >{busy ? 'Deleting…' : 'Delete forever'}</button>
      </div>
    </Scrim>
  );
}
