import { useEffect, useMemo, useState } from 'react';
import { formatMoney, toMinor, type Bank, type Category, type Transaction } from '@spendwise/shared-types';
import { Icon } from '../../design-system/components.js';
import type { Derived } from '../insights/selectors.js';

/**
 * Add / edit a transaction.
 *
 * The amount is the headline of the sheet, not a field in a form, and the
 * IMPACT PREVIEW is the differentiator: before committing, it says what this
 * spend does to the rest of the month. Recalculated on every keystroke.
 */

export interface AddSheetProps {
  open: boolean;
  editing: Transaction | null;
  categories: Category[];
  banks: Bank[];
  derived: Derived;
  baseCurrency: string;
  onClose: () => void;
  onSave: (draft: SaveDraft) => void | Promise<void>;
  onDelete?: (localId: string) => void | Promise<void>;
}

export interface SaveDraft {
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  bankId: string | null;
  merchant: string | null;
  isIncome: boolean;
}

/**
 * Sanitise as the user types, on the STRING.
 *
 * Never `parseFloat(x) * 100`: 19.99 * 100 is 1998.9999999999998 and floors to
 * a penny short. `toMinor` parses the digits directly.
 */
function sanitise(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, '');
  const parts = v.split('.');
  if (parts.length > 2) v = `${parts[0]}.${parts.slice(1).join('')}`;
  const [whole = '', dec] = v.split('.');
  return dec !== undefined ? `${whole.slice(0, 7)}.${dec.slice(0, 2)}` : v.slice(0, 7);
}

export function AddSheet({
  open, editing, categories, banks, derived, baseCurrency, onClose, onSave, onDelete,
}: AddSheetProps): JSX.Element | null {
  const flex = useMemo(() => categories.filter((c) => !c.is_fixed && !c.deleted_at), [categories]);
  const fixedCats = useMemo(() => categories.filter((c) => c.is_fixed && !c.deleted_at), [categories]);
  /* Both kinds are selectable. Offering only day-to-day meant a rent payment
     could not be recorded at all, so the one spend that most needs to stay out
     of "safe to spend" had nowhere to go. */
  const selectable = useMemo(() => [...flex, ...fixedCats], [flex, fixedCats]);

  const [isIncome, setIsIncome] = useState(false);
  const [entry, setEntry] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [bankId, setBankId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setIsIncome(editing.is_income);
      setEntry((Math.abs(editing.amount_minor) / 100).toFixed(2).replace(/\.00$/, ''));
      setCategoryId(editing.category_id);
      setBankId(editing.bank_id);
      setMerchant(editing.merchant ?? '');
    } else {
      setIsIncome(false);
      setEntry('');
      setCategoryId(flex[0]?.local_id ?? null);
      setBankId(banks[0]?.local_id ?? null);
      setMerchant('');
    }
  }, [open, editing, flex, banks]);

  if (!open) return null;

  let amountMinor = 0;
  try {
    amountMinor = entry ? toMinor(entry, baseCurrency) : 0;
  } catch {
    amountMinor = 0;
  }

  const category = selectable.find((c) => c.local_id === categoryId) ?? null;
  const isFixedSpend = Boolean(category?.is_fixed);
  const canSave = amountMinor > 0 && (isIncome || categoryId !== null) && bankId !== null;
  const accent = isIncome ? 'var(--positive)' : (category?.colour ?? 'var(--brand)');

  /* The live consequence. When editing, the original amount is already counted
     in the month's totals, so it has to be added back before re-subtracting. */
  const prior = editing && !editing.is_income ? Math.abs(editing.amount_minor) : 0;
  const leftAfter = derived.leftMinor + prior - (isIncome ? 0 : amountMinor);
  const perDayAfter = derived.daysLeft > 0 ? Math.round(leftAfter / derived.daysLeft) : leftAfter;

  const impactTone =
    isIncome ? 'var(--positive)'
    : leftAfter < 0 ? 'var(--danger)'
    : perDayAfter < derived.evenPaceMinor * 0.75 ? 'var(--warning)'
    : 'var(--positive)';

  const impactText = isIncome
    ? (amountMinor > 0 ? `${formatMoney(amountMinor, baseCurrency)} added to income` : 'Money coming in')
    : leftAfter < 0
      ? `${formatMoney(Math.abs(leftAfter), baseCurrency)} over your budget`
      : `${formatMoney(leftAfter, baseCurrency)} left · ${formatMoney(perDayAfter, baseCurrency)} a day`;

  const catSpent = category ? (derived.byCategory.get(category.local_id) ?? 0) - (editing?.category_id === category.local_id ? prior : 0) : 0;
  const catLeft = category ? category.limit_minor - catSpent - amountMinor : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit transaction' : 'Add transaction'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(3,4,7,.74)',
        backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'flex-end',
      }}
    >
      <div style={{
        width: '100%', background: 'var(--surface)', borderTop: '1px solid var(--line-strong)',
        borderRadius: 'var(--r-xl) var(--r-xl) 0 0', padding: 'var(--s3) var(--s5) var(--s6)',
        maxHeight: '92%', overflowY: 'auto',
      }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--line-strong)', margin: '7px auto var(--s4)' }} />

        <div role="group" aria-label="Type" style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, background: 'var(--surface-2)',
          borderRadius: 'var(--r-pill)', padding: 3, margin: '0 auto var(--s5)', width: 186,
        }}>
          {([['Spend', false], ['Income', true]] as const).map(([label, income]) => (
            <button
              key={label}
              type="button"
              aria-pressed={isIncome === income}
              onClick={() => setIsIncome(income)}
              style={{
                fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '8px 0', border: 0, cursor: 'pointer',
                borderRadius: 'var(--r-pill)',
                background: isIncome === income ? 'var(--surface-3)' : 'transparent',
                color: isIncome === income ? 'var(--text)' : 'var(--text-dim)',
              }}
            >{label}</button>
          ))}
        </div>

        <div style={{ textAlign: 'center', paddingBottom: 'var(--s3)', marginBottom: 'var(--s3)', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 1 }}>
            <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-dim)' }}>
              {formatMoney(0, baseCurrency).replace(/[\d.,\s]/g, '')}
            </span>
            <input
              autoFocus
              inputMode="decimal"
              aria-label="Amount"
              placeholder="0"
              value={entry}
              onChange={(e) => setEntry(sanitise(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void submit(); }}
              size={Math.max(1, entry.length || 1)}
              style={{
                background: 'none', border: 0, outline: 'none', padding: 0,
                fontSize: 46, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1.1,
                fontVariantNumeric: 'tabular-nums', color: 'var(--text)', caretColor: accent,
                textAlign: 'left', minWidth: '1ch', maxWidth: '100%',
              }}
            />
          </div>
          <span style={{
            position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)',
            width: 112, height: 3, borderRadius: 2, background: accent, transition: 'background .25s ease',
          }} />
        </div>

        <div data-testid="impact" style={{
          background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)',
          padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s4)', minHeight: 62,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
        }}>
          <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: impactTone }}>{impactText}</p>
          <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-dim)' }}>
            {isIncome ? "Income isn't counted against your day-to-day budget."
              : catLeft === null ? 'Not tracked against a category budget'
              : catLeft >= 0 ? `${category!.name}: ${formatMoney(catLeft, baseCurrency)} left of ${formatMoney(category!.limit_minor, baseCurrency)}`
              : `${category!.name}: ${formatMoney(Math.abs(catLeft), baseCurrency)} over its limit`}
          </p>
        </div>

        {!isIncome && (
          <>
            <p style={labelStyle}>Day-to-day</p>
            <div role="group" aria-label="Day-to-day category" style={stripStyle}>
              {flex.map((c) => (
                <button
                  key={c.local_id}
                  type="button"
                  aria-pressed={categoryId === c.local_id}
                  onClick={() => setCategoryId(c.local_id)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    fontSize: 10, fontWeight: 700, padding: 'var(--s2) 4px', borderRadius: 'var(--r-md)',
                    minWidth: 60, flexShrink: 0, cursor: 'pointer',
                    border: `1px solid ${categoryId === c.local_id ? 'var(--line-strong)' : 'transparent'}`,
                    background: categoryId === c.local_id ? 'var(--surface-2)' : 'transparent',
                    color: categoryId === c.local_id ? 'var(--text)' : 'var(--text-dim)',
                  }}
                >
                  <Icon name={c.icon} size={30} colour={c.colour} />
                  <span style={{ maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                </button>
              ))}
            </div>

            {fixedCats.length > 0 && (
              <>
                <p style={labelStyle}>Bills &amp; fixed costs</p>
                <div role="group" aria-label="Fixed cost category" style={stripStyle}>
                  {fixedCats.map((c) => (
                    <button
                      key={c.local_id}
                      type="button"
                      aria-pressed={categoryId === c.local_id}
                      onClick={() => setCategoryId(c.local_id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        fontSize: 10, fontWeight: 700, padding: 'var(--s2) 4px', borderRadius: 'var(--r-md)',
                        minWidth: 60, flexShrink: 0, cursor: 'pointer',
                        border: `1px solid ${categoryId === c.local_id ? 'var(--line-strong)' : 'transparent'}`,
                        background: categoryId === c.local_id ? 'var(--surface-2)' : 'transparent',
                        color: categoryId === c.local_id ? 'var(--text)' : 'var(--text-dim)',
                      }}
                    >
                      <Icon name={c.icon} size={30} colour={c.colour} />
                      <span style={{ maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Say which pot this lands in, at the moment of choosing. The
                classification drives every figure on Home, so it should not be
                something the user has to infer afterwards. */}
            {category && (
              <p style={{
                display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--s1)',
                fontSize: 'var(--fs-2xs)', fontWeight: 700,
                color: isFixedSpend ? 'var(--text-muted)' : 'var(--brand-cyan)',
              }}>
                <i style={{
                  width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                  background: isFixedSpend ? 'var(--text-dim)' : 'var(--brand-cyan)',
                }} />
                {isFixedSpend
                  ? 'Counts as a bill — does not change what is safe to spend'
                  : 'Counts against your day-to-day budget'}
              </p>
            )}
          </>
        )}

        <p style={labelStyle}>Paid with</p>
        <div role="group" aria-label="Bank or card" style={stripStyle}>
          {banks.filter((b) => !b.deleted_at).map((b) => (
            <button
              key={b.local_id}
              type="button"
              aria-pressed={bankId === b.local_id}
              onClick={() => setBankId(b.local_id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, padding: '9px 14px',
                borderRadius: 'var(--r-pill)', fontSize: 'var(--fs-xs)', fontWeight: 700,
                whiteSpace: 'nowrap', cursor: 'pointer',
                border: `1px solid ${bankId === b.local_id ? 'var(--line-strong)' : 'transparent'}`,
                background: bankId === b.local_id ? 'var(--surface-3)' : 'var(--surface-2)',
                color: bankId === b.local_id ? 'var(--text)' : 'var(--text-dim)',
              }}
            >
              <i style={{
                width: 9, height: 9, borderRadius: '50%', background: b.colour, flexShrink: 0,
                transform: bankId === b.local_id ? 'scale(1.15)' : 'scale(.6)',
                opacity: bankId === b.local_id ? 1 : 0.5,
                transition: 'transform .22s cubic-bezier(.2,.9,.25,1), opacity .22s ease',
              }} />
              {b.name}
            </button>
          ))}
        </div>

        <input
          aria-label="Where"
          placeholder={isIncome ? 'Where from? (optional)' : 'Where? (optional)'}
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void submit(); }}
          style={{
            width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)', padding: '12px var(--s4)', fontSize: 'var(--fs-sm)',
            fontWeight: 600, outline: 'none', color: 'var(--text)',
          }}
        />

        <button
          type="button"
          disabled={!canSave}
          onClick={() => void submit()}
          style={{
            width: '100%', background: 'var(--brand)', color: '#fff', padding: 15, marginTop: 'var(--s4)',
            borderRadius: 'var(--r-md)', fontSize: 'var(--fs-md)', fontWeight: 800, border: 0,
            opacity: canSave ? 1 : 0.35, cursor: canSave ? 'pointer' : 'not-allowed',
          }}
        >
          {amountMinor > 0
            ? editing
              ? `Save changes · ${formatMoney(amountMinor, baseCurrency)}`
              : `Save ${formatMoney(amountMinor, baseCurrency)} ${isIncome ? 'as income' : `to ${category?.name ?? '…'}`}`
            : 'Enter an amount'}
        </button>

        {editing && onDelete && (
          <button
            type="button"
            onClick={() => void onDelete(editing.local_id)}
            style={{
              width: '100%', background: 'var(--danger-soft)', color: 'var(--danger)', padding: 13,
              marginTop: 'var(--s2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)',
              fontWeight: 700, border: 0, cursor: 'pointer',
            }}
          >Delete transaction</button>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%', background: 'transparent', color: 'var(--text-dim)', padding: 13,
            marginTop: 'var(--s2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)',
            fontWeight: 700, border: 0, cursor: 'pointer',
          }}
        >Cancel</button>
      </div>
    </div>
  );

  async function submit(): Promise<void> {
    if (!canSave) return;
    await onSave({
      amountMinor,
      currency: baseCurrency,
      categoryId: isIncome ? null : categoryId,
      bankId,
      merchant: merchant.trim() || null,
      isIncome,
    });
  }
}

const labelStyle = {
  fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.07em',
  textTransform: 'uppercase' as const, color: 'var(--text-dim)', margin: 'var(--s4) 0 var(--s2)',
};

const stripStyle = {
  display: 'flex', gap: 'var(--s2)', overflowX: 'auto' as const,
  padding: '2px 0 var(--s3)', scrollbarWidth: 'none' as const,
};
