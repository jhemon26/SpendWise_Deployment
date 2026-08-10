import { useState } from 'react';
import { formatMoney, formatSignedMoney, type Bank, type Category, type Transaction } from '@spendwise/shared-types';
import { Avatar, Bar, Card, CardHead, Chip, Empty, Gauge, Icon } from '../design-system/components.js';
import {
  billsFor, categoryBreakdown, dayLabel, derive, fixedCostsTotalMinor, groupByDay,
  historyAverageMinor, monthHistory, statusOf, STATUS_COLOUR,
  type Bill, type Derived,
} from '../features/insights/selectors.js';
import { verdictFor, verdictColour, VERDICT_ICON } from '../features/insights/verdict.js';

export interface ScreenData {
  transactions: Transaction[];
  categories: Category[];
  d: Derived;
  currency: string;
  now: Date;
  displayName: string;
  dayToDayMinor: number;
  savingsTargetMinor: number;
  /** Tap a transaction row to edit it. Absent in read-only contexts. */
  onEdit?: ((t: Transaction) => void) | undefined;
  /** Absent when running purely locally — there is no session to end. */
  onSignOut?: (() => void) | undefined;
  banks: Bank[];
  /** Jump to another tab, for the "See all" / "All bills" card actions. */
  onGoto?: ((tab: 'activity' | 'budgets') => void) | undefined;
  /** Activity filter, lifted so the tab header can show the count. */
  filter?: TxFilter | undefined;
  onFilter?: ((f: TxFilter) => void) | undefined;
  onAddCategory?: (() => void) | undefined;
  /** Open the single-value editor for one of the month settings. */
  onEditSetting?: ((which: 'budget' | 'savings' | 'name' | 'income') => void) | undefined;
  /** null opens the editor empty, for a new one. */
  onEditCategory?: ((c: Category | null) => void) | undefined;
  onEditBank?: ((b: Bank | null) => void) | undefined;
  onEditAvatar?: (() => void) | undefined;
  onDeleteAccount?: (() => void) | undefined;
  monthlyIncomeMinor?: number | undefined;
  avatarEmoji?: string | undefined;
  avatarColour?: string | undefined;
}

export type TxFilter = 'all' | 'spending' | 'income' | 'bills';

const money = (minor: number, cur: string): string => formatMoney(minor, cur);
/** Whole pounds, for figures where pence are noise (budgets, bills, totals). */
const money0 = (minor: number, cur: string): string =>
  formatMoney(minor, cur, 'en-GB').replace(/[.,]\d{2}$/, '');
/**
 * Piggy bank for the saving goal.
 *
 * Drawn without a background disc, unlike the verdict marks: those sit alone on
 * the card, this one sits inside a stat cell where a filled circle would read as
 * a badge competing with the number beside it.
 */
const PIGGY = `<circle cx="11.5" cy="4.2" r="3.1" fill="#FACC15"/>
  <circle cx="11.5" cy="4.2" r="1.5" fill="#EAB308"/>
  <path d="M6.4 8.6 5.2 4.9l3.9 2.2z" fill="#EC4899"/>
  <ellipse cx="11.3" cy="13.4" rx="8.1" ry="6.1" fill="#F472B6"/>
  <rect x="6.6" y="18.2" width="2.6" height="3" rx="1.2" fill="#EC4899"/>
  <rect x="13.4" y="18.2" width="2.6" height="3" rx="1.2" fill="#EC4899"/>
  <ellipse cx="19.1" cy="13.2" rx="2.7" ry="2.2" fill="#EC4899"/>
  <circle cx="18.3" cy="13.2" r=".55" fill="#831843"/>
  <circle cx="19.9" cy="13.2" r=".55" fill="#831843"/>
  <circle cx="14.2" cy="11.5" r="1.15" fill="#4A044E"/>
  <rect x="8.6" y="9.4" width="5.4" height="1.5" rx=".75" fill="#BE185D"/>`;

const monthName = (now: Date): string => now.toLocaleDateString('en-GB', { month: 'long' });
const monthShort = (now: Date): string => now.toLocaleDateString('en-GB', { month: 'short' });
/** Use for anything that shows a +/− sign. See formatSignedMoney. */
const signed = (minor: number, cur: string): string => formatSignedMoney(minor, cur);
const catOf = (cats: Category[], id: string | null): Category | undefined =>
  id ? cats.find((c) => c.local_id === id) : undefined;

/* ── Home ─────────────────────────────────────────────────────────────── */

export function Home({
  transactions, categories, banks, d, currency, dayToDayMinor, savingsTargetMinor,
  now, onEdit, onGoto, monthlyIncomeMinor = 0,
}: ScreenData): JSX.Element {
  const st = statusOf(d.spentPct);
  const over = d.deltaMinor > 0;
  const recent = transactions.filter((t) => !t.deleted_at)
    .slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 3);
  const bills = billsFor(categories, transactions, now);
  const due = bills.filter((b) => !b.paid).slice(0, 2);

  const v = verdictFor(d, dayToDayMinor, monthName(now));
  const todayDelta = d.todaySpentMinor - d.evenPaceMinor;
  /*
   * What is left of this month's income after everything spent so far —
   * day-to-day AND bills.
   *
   * This replaced a projected-savings figure that guessed what would be left IF
   * the budget held. That guess went negative the moment day-to-day spending
   * was under way, so it showed a large red "over budget" to people who were
   * perfectly fine, and there was no way to tell from the tile what it meant.
   * A plain subtraction cannot mislead in that way.
   */
  const leftOfIncome = monthlyIncomeMinor - d.monthTotalMinor;
  const leftTone = leftOfIncome < 0 ? 'var(--danger)'
    : leftOfIncome < monthlyIncomeMinor * 0.15 ? 'var(--warning)' : 'var(--positive)';

  return (
    <>
      <div style={{
        position: 'relative', overflow: 'hidden', background: 'var(--hero-bg)',
        border: '1px solid var(--line-brand)', borderRadius: 'var(--r-xl)',
        padding: 'var(--s4)', boxShadow: '0 16px 36px -14px rgba(0,0,0,.55)',
      }}>
        {/* Brand bloom in the top-right corner, as in the prototype. */}
        <div aria-hidden style={{
          position: 'absolute', top: -70, right: -60, width: 200, height: 200, pointerEvents: 'none',
          background: 'radial-gradient(circle, rgba(99,102,241,.22) 0%, transparent 70%)',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
            <p style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 'var(--fs-2xs)', fontWeight: 800, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--brand-cyan)',
            }}>
              <svg viewBox="0 0 24 24" aria-hidden width={14} height={14} fill="var(--brand-cyan)">
                <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
              Available to spend
            </p>
            <Chip tone={over ? 'warn' : 'ok'}>{over ? 'Spending fast' : 'On track'}</Chip>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s4)' }}>
            <div style={{ minWidth: 0 }}>
              <p className="num" data-testid="safe-to-spend" data-tour="safe-to-spend" style={{
                fontSize: 'clamp(26px, 8.5vw, var(--fs-hero))', fontWeight: 800, letterSpacing: '-.035em',
                lineHeight: 1.05, whiteSpace: 'nowrap', color: d.leftMinor < 0 ? 'var(--danger)' : undefined,
              }}>
                {money(d.leftMinor, currency)}
              </p>
              <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', marginTop: 'var(--s2)' }}>
                {d.leftMinor >= 0 ? (
                  <>
                    <strong className="num" style={{ color: 'var(--text)', fontWeight: 700 }}>{money(d.perDayMinor, currency)}</strong>
                    {' '}a day for {d.daysLeft} {d.daysLeft === 1 ? 'day' : 'days'}
                  </>
                ) : (
                  /* "−£6.97 a day" is nonsense once you are over: you cannot
                     un-spend. Say what actually happened instead. */
                  <>
                    <strong className="num" style={{ color: 'var(--text)', fontWeight: 700 }}>{money(Math.abs(d.leftMinor), currency)}</strong>
                    {' '}over with {d.daysLeft} {d.daysLeft === 1 ? 'day' : 'days'} to go
                  </>
                )}
              </p>
            </div>
            <Gauge pct={d.spentPct} datePct={d.datePct} colour={STATUS_COLOUR[st]} tourId="gauge" size={78} />
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--s2)',
            marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--line)',
          }}>
            {([['Budget', money0(dayToDayMinor + d.committedFixedMinor, currency), false],
               ['Spent', money(d.monthTotalMinor, currency), false],
               ['Saving goal', savingsTargetMinor > 0 ? money0(savingsTargetMinor, currency) : '—', true]] as const).map(([k, v, piggy]) => (
              <div key={k} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{k}</p>
                <p className="num" style={{
                  fontSize: 'var(--fs-sm)', fontWeight: 800, marginTop: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                }}>
                  {piggy && (
                    <svg viewBox="0 0 24 24" width={17} height={17} aria-hidden
                         style={{ flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: PIGGY }} />
                  )}
                  {v}
                </p>
              </div>
            ))}
          </div>

          <p style={{
            marginTop: 'var(--s3)', display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 'var(--fs-xs)', fontWeight: 700, color: verdictColour(v.tone),
          }}>
            <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden
                 style={{ flexShrink: 0 }}
                 dangerouslySetInnerHTML={{ __html: VERDICT_ICON[v.icon] }} />
            {v.line}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--s2)' }}>
        <Tile label="Today" value={money(d.todaySpentMinor, currency)}
              foot={`${money(Math.abs(todayDelta), currency)} ${todayDelta > 0 ? 'over' : 'under'}`}
              footTone={todayDelta > 0 ? 'var(--warning)' : 'var(--positive)'} />
        <Tile label="This month" value={money(d.monthTotalMinor, currency)}
              foot={`of ${money0(dayToDayMinor + d.committedFixedMinor, currency)}`} />
        {monthlyIncomeMinor > 0
          ? <Tile
              label="Left of income"
              value={money(leftOfIncome, currency)}
              foot={leftOfIncome < 0 ? 'more than you earned' : `of ${money0(monthlyIncomeMinor, currency)}`}
              tone={leftTone}
              {...(leftOfIncome < 0 ? { footTone: 'var(--danger)' } : {})}
            />
          : <Tile label="Left of income" value="—" foot="Add your income" />}
      </div>

      {/* Recent activity sits directly under the number it explains. Bills are
          a reference list, so they go last and stay compact. */}
      <Card>
        <CardHead title="Recent activity" action={onGoto && <CardAction onClick={() => onGoto('activity')}>See all</CardAction>} />
        {recent.length === 0
          ? <Empty icon="other" title="No activity yet" body="Tap + to record your first transaction." />
          : recent.map((t, i) => <Row key={t.local_id} t={t} cats={categories} banks={banks} onEdit={onEdit} divider={i > 0} />)}
      </Card>

      {due.length > 0 && (
        <Card style={{ padding: 'var(--s4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', marginBottom: 'var(--s2)' }}>
            <h2 style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, letterSpacing: '-.01em' }}>
              Coming up
              <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>
                {' '}· {money0(due.reduce((sum, b) => sum + b.amountMinor, 0), currency)}
              </span>
            </h2>
            {onGoto && <CardAction onClick={() => onGoto('budgets')}>All bills</CardAction>}
          </div>
          {due.map((b, i) => (
            <BillRow key={b.category.local_id} bill={b} currency={currency} now={now} divider={i > 0} compact />
          ))}
        </Card>
      )}
    </>
  );
}

/** The small brand-coloured link in a card header. */
function CardAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button type="button" onClick={onClick} style={{
      fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--brand)',
      background: 'none', border: 0, cursor: 'pointer', padding: 0,
      display: 'flex', alignItems: 'center', gap: 3,
    }}>{children}</button>
  );
}

function BillRow({ bill, currency, now, divider, showStatus = false, compact = false }: {
  bill: Bill; currency: string; now: Date; divider: boolean; showStatus?: boolean; compact?: boolean;
}): JSX.Element {
  const c = bill.category;
  const when = bill.paid
    ? `Paid ${bill.dueDay} ${monthShort(now)}`
    : bill.inDays <= 0
      ? 'Overdue'
      : `Due ${bill.dueDay} ${monthShort(now)} · ${bill.inDays} ${bill.inDays === 1 ? 'day' : 'days'}`;
  return (
    <>
      {divider && <div style={{ height: 1, background: 'var(--line)' }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: compact ? 'var(--s2) 0' : 'var(--s3) 0' }}>
        <Icon name={c.icon} size={compact ? 30 : 40} colour={c.colour} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bill.name}</p>
          <p style={{ fontSize: compact ? 'var(--fs-2xs)' : 'var(--fs-xs)', fontWeight: 500, color: 'var(--text-dim)', marginTop: compact ? 1 : 3 }}>{when}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 800 }}>{money0(bill.amountMinor, currency)}</p>
          {showStatus && (
            <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-dim)', marginTop: 3 }}>
              {bill.paid ? 'Paid' : 'Scheduled'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, foot, tone, footTone }: {
  label: string; value: string; foot: string; tone?: string; footTone?: string;
}): JSX.Element {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 'var(--s3) var(--s3) var(--s4)' }}>
      <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{label}</p>
      <p className="num" style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, letterSpacing: '-.03em', marginTop: 6, color: tone }}>{value}</p>
      <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: footTone ?? 'var(--text-dim)', marginTop: 3 }}>{foot}</p>
    </div>
  );
}

/**
 * A transaction renders in the currency it was SPENT in, not the reporting
 * currency — showing a €14 lunch as "£11.90" hides what the user actually paid.
 * The base-currency value is what feeds the budget totals (see selectors).
 */
function Row({ t, cats, banks, onEdit, divider = false }: {
  t: Transaction;
  cats: Category[];
  banks: Bank[];
  onEdit?: ((t: Transaction) => void) | undefined;
  divider?: boolean;
}): JSX.Element {
  const c = catOf(cats, t.category_id);
  const b = t.bank_id ? banks.find((x) => x.local_id === t.bank_id) : undefined;
  const label = t.is_income ? 'Income' : (c?.name ?? 'Uncategorised');
  const iconName = t.is_income ? 'income' : (c?.icon ?? 'other');
  const colour = t.is_income ? '#10B981' : (c?.colour ?? '#64748B');
  const time = new Date(t.occurred_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const Tag = onEdit ? 'button' : 'div';

  return (
    <>
      {divider && <div style={{ height: 1, background: 'var(--line)' }} />}
      <Tag
        {...(onEdit ? { type: 'button' as const, onClick: () => onEdit(t) } : {})}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s3)', width: '100%',
          textAlign: 'left', padding: 'var(--s3) 0', background: 'none', border: 0,
          borderRadius: 'var(--r-md)', color: 'inherit',
          cursor: onEdit ? 'pointer' : 'default',
        }}
      >
        <Icon name={iconName} size={40} colour={colour} />
        <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 700, letterSpacing: '-.01em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{t.merchant ?? label}</span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            fontSize: 'var(--fs-xs)', fontWeight: 500, color: 'var(--text-dim)', marginTop: 3,
          }}>
            <span>{label}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-dim)', flexShrink: 0 }} />
            <span className="num">{time}</span>
            {t.pending && (
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase',
                padding: '2px 6px', borderRadius: 5,
                background: 'var(--warning-soft)', color: 'var(--warning)',
              }}>Pending</span>
            )}
            {t.sync_status !== 'synced' && <span>· not yet synced</span>}
          </span>
        </span>
        <span style={{ display: 'block', textAlign: 'right', flexShrink: 0 }}>
          <span className="num" style={{
            display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 800,
            color: t.is_income ? 'var(--positive)' : undefined,
          }}>
            {signed(t.is_income ? Math.abs(t.amount_minor) : -Math.abs(t.amount_minor), t.currency)}
          </span>
          {b && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end',
              fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-dim)', marginTop: 3,
            }}>
              <i style={{ width: 7, height: 7, borderRadius: '50%', background: b.colour, flexShrink: 0 }} />
              {b.name}
            </span>
          )}
        </span>
      </Tag>
    </>
  );
}

/* ── Activity ─────────────────────────────────────────────────────────── */

export function Activity({
  transactions, categories, banks, currency, now, onEdit, filter = 'all', onFilter,
}: ScreenData): JSX.Element {
  const live = transactions.filter((t) => !t.deleted_at);
  const isBill = (t: Transaction): boolean => {
    const c = catOf(categories, t.category_id);
    return Boolean(c?.is_fixed);
  };
  const counts = {
    all: live.length,
    spending: live.filter((t) => !t.is_income).length,
    income: live.filter((t) => t.is_income).length,
    bills: live.filter(isBill).length,
  };
  const keep = (t: Transaction): boolean =>
    filter === 'all' ? true
      : filter === 'income' ? t.is_income
        : filter === 'bills' ? isBill(t)
          : !t.is_income;

  const groups = groupByDay(live.filter(keep), now);

  return (
    <>
      {onFilter && (
        <div role="group" aria-label="Filter activity" style={{
          display: 'flex', gap: 'var(--s2)', overflowX: 'auto',
          padding: 'var(--s1) 0 var(--s2)', scrollbarWidth: 'none',
        }}>
          {(['all', 'spending', 'income', 'bills'] as const).map((f) => {
            const on = filter === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => onFilter(f)}
                style={{
                  fontSize: 'var(--fs-xs)', fontWeight: 700, whiteSpace: 'nowrap',
                  padding: '8px 14px', borderRadius: 'var(--r-pill)', cursor: 'pointer',
                  background: on ? 'var(--text)' : 'var(--surface)',
                  color: on ? 'var(--bg)' : 'var(--text-muted)',
                  border: `1px solid ${on ? 'var(--text)' : 'var(--line)'}`,
                  transition: 'background .15s ease, color .15s ease, border-color .15s ease',
                }}
              >
                {f === 'all' ? 'All' : f === 'spending' ? 'Spending' : f === 'income' ? 'Income' : 'Bills'}
                <span className="num" style={{ opacity: .55, marginLeft: 5 }}>{counts[f]}</span>
              </button>
            );
          })}
        </div>
      )}

      {groups.length === 0
        ? (
          <Card>
            <Empty
              icon="other"
              title="Nothing here yet"
              body={`No ${filter === 'all' ? 'transactions' : filter} recorded this month. Tap + to add one.`}
            />
          </Card>
        )
        : groups.map((g) => (
          <div key={g.label}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: 'var(--s4) 0 var(--s2)', position: 'sticky', top: 0, zIndex: 5,
              background: 'var(--bg)',
            }}>
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.label}</span>
              <span className="num" style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: g.netMinor > 0 ? 'var(--positive)' : 'var(--text-dim)' }}>
                {signed(g.netMinor, currency)}
              </span>
            </div>
            <Card style={{ padding: 'var(--s1) var(--s4)' }}>
              {g.items.map((t, i) => (
                <Row key={t.local_id} t={t} cats={categories} banks={banks} onEdit={onEdit} divider={i > 0} />
              ))}
            </Card>
          </div>
        ))}
    </>
  );
}

/* ── Budgets ──────────────────────────────────────────────────────────── */

export function Budgets({
  categories, transactions, d, currency, dayToDayMinor, now, onAddCategory,
}: ScreenData): JSX.Element {
  const flex = categories.filter((c) => !c.is_fixed && !c.deleted_at);
  const total = statusOf(d.spentPct);
  const bills = billsFor(categories, transactions, now);

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
          <div>
            <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              {monthName(now)} day-to-day
            </p>
            <p className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-.035em', marginTop: 6, color: d.leftMinor < 0 ? 'var(--danger)' : undefined }}>
              {money(Math.abs(d.leftMinor), currency)} {d.leftMinor < 0 ? 'over' : 'left'}
            </p>
          </div>
          <Chip tone="neutral">{d.dayOfMonth} of {d.daysInMonth} days</Chip>
        </div>
        <Bar pct={d.spentPct} colour={STATUS_COLOUR[total]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', marginTop: 'var(--s2)', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)' }}>
          <span className="num">{money(d.flexSpentMinor, currency)} spent</span>
          <span className="num">{money0(dayToDayMinor, currency)} budget</span>
        </div>
      </Card>

      <Card>
        <CardHead
          title="Day-to-day"
          action={onAddCategory && (
            <CardAction onClick={onAddCategory}>
              <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" strokeWidth={2.4}
                   fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              New
            </CardAction>
          )}
        />
        {flex.length === 0
          ? <Empty icon="other" title="No categories yet" body="Add one to start tracking day-to-day spending." />
          : flex.map((c, i) => {
              const spent = d.byCategory.get(c.local_id) ?? 0;
              const pct = c.limit_minor > 0 ? (spent / c.limit_minor) * 100 : 0;
              const cst = statusOf(pct);
              const remaining = c.limit_minor - spent;
              return (
                <div key={c.local_id} style={{ padding: 'var(--s4) 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                    <Icon name={c.icon} size={30} colour={c.colour} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                    <span className="num" style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-dim)', flexShrink: 0 }}>
                      <strong style={{ color: 'var(--text)' }}>{money(spent, currency)}</strong> of {money0(c.limit_minor, currency)}
                    </span>
                  </div>
                  <Bar pct={pct} colour={STATUS_COLOUR[cst]} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', marginTop: 'var(--s2)', fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
                    <span className="num" style={{ color: cst === 'ok' ? 'var(--text-dim)' : STATUS_COLOUR[cst] }}>
                      {money(Math.abs(remaining), currency)} {remaining >= 0 ? 'left' : 'over'}
                    </span>
                    <span className="num" style={{ color: 'var(--text-dim)' }}>{Math.round(pct)}%</span>
                  </div>
                </div>
              );
            })}
      </Card>

      <Card>
        <CardHead
          title="Fixed costs"
          action={
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              {money0(fixedCostsTotalMinor(bills), currency)} / month
            </span>
          }
        />
        {bills.length === 0
          ? <Empty icon="bills" title="No fixed costs" body="Rent, bills and subscriptions will appear here." />
          : bills.map((b, i) => (
              <BillRow key={b.category.local_id} bill={b} currency={currency} now={now} divider={i > 0} showStatus />
            ))}
      </Card>
    </>
  );
}

/* ── Insights ─────────────────────────────────────────────────────────── */

export function Insights({ categories, transactions, d, currency, now }: ScreenData): JSX.Element {
  const rows = categoryBreakdown(d, categories);
  const series = monthHistory(transactions, now, 6);
  const maxMinor = Math.max(...series.map((m) => m.totalMinor), 1);
  const avgMinor = historyAverageMinor(series);

  const stops = rows.length
    ? rows.reduce<{ acc: number; parts: string[] }>((s2, r) => {
        const from = s2.acc;
        const to = s2.acc + r.pct;
        s2.parts.push(`${r.category.colour} ${from}% ${to}%`);
        return { acc: to, parts: s2.parts };
      }, { acc: 0, parts: [] }).parts.join(',')
    : '';

  return (
    <>
      <Card>
        <CardHead title="Spending, last 6 months" />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s2)', height: 132, marginBottom: 'var(--s3)' }}>
          {series.map((m) => (
            <div key={m.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{
                width: '100%', minHeight: 3, borderRadius: 8,
                height: `${(m.totalMinor / maxMinor) * 100}%`,
                background: m.current ? 'var(--brand)' : 'var(--surface-3)',
                transition: 'height .5s ease',
              }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s2)' }}>
          {series.map((m) => (
            <div key={m.label} style={{ flex: 1 }}>
              <p style={{
                fontSize: 'var(--fs-2xs)', fontWeight: 700, textAlign: 'center',
                color: m.current ? 'var(--text)' : 'var(--text-dim)',
              }}>{m.label}</p>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', marginTop: 'var(--s4)', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)' }}>
          <span className="num">Average {money0(avgMinor, currency)}</span>
          <span className="num">{monthName(now)} so far {money(d.monthTotalMinor, currency)}</span>
        </div>
      </Card>

      <Card>
        <CardHead title={`Where ${monthName(now)} went`} />
        {rows.length === 0
          ? <Empty icon="other" title="Nothing to chart yet" body="Add a transaction and this fills in." />
          : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s5)' }}>
              <div style={{ position: 'relative', width: 116, height: 116, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                <div style={{
                  width: 116, height: 116, borderRadius: '50%',
                  background: `conic-gradient(${stops})`,
                  WebkitMaskImage: 'radial-gradient(farthest-side,transparent 63%,#000 64%)',
                  maskImage: 'radial-gradient(farthest-side,transparent 63%,#000 64%)',
                }} />
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
                  <p className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 800, letterSpacing: '-.03em' }}>{money0(d.monthTotalMinor, currency)}</p>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginTop: 2 }}>Total</p>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--s3)', minWidth: 0 }}>
                {rows.slice(0, 6).map((r) => (
                  <div key={r.category.local_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-xs)' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: r.category.colour, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.category.name}</span>
                    <span className="num" style={{ fontWeight: 800 }}>{r.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
      </Card>

      <Card>
        <CardHead title="Key numbers" />
        {([
          ['Average day', `Day-to-day across ${d.dayOfMonth} ${d.dayOfMonth === 1 ? 'day' : 'days'}`, money(d.avgDayMinor, currency)],
          ['Biggest single spend',
           d.biggest
             ? `${catOf(categories, d.biggest.category_id)?.name ?? 'Uncategorised'} · ${dayLabel(d.biggest.occurred_at, now)}`
             : 'Nothing yet',
           d.biggest ? money(Math.abs(d.biggest.amount_minor), currency) : '—'],
          ['Spend-free days', `So far in ${monthName(now)}`, String(d.spendFreeDays)],
          ['Fixed vs flexible', 'Share of the month locked in', `${Math.round(d.fixedSharePct)}%`],
        ] as const).map(([k, sub, v], i) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', padding: 'var(--s3) 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
            <div>
              <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{k}</p>
              <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 500, marginTop: 2 }}>{sub}</p>
            </div>
            <p className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 800, flexShrink: 0 }}>{v}</p>
          </div>
        ))}
      </Card>
    </>
  );
}

/* ── Profile ──────────────────────────────────────────────────────────── */

export function Profile({
  categories, banks, transactions, currency, displayName, dayToDayMinor,
  savingsTargetMinor, d, now, onSignOut, onEditSetting, onEditCategory, onEditBank,
  onEditAvatar, avatarEmoji = '', avatarColour = '#6366F1', onDeleteAccount,
  monthlyIncomeMinor = 0,
}: ScreenData): JSX.Element {
  const flex = categories.filter((c) => !c.deleted_at && !c.is_fixed);
  const fixed = categories.filter((c) => !c.deleted_at && c.is_fixed);
  const liveBanks = banks.filter((b) => !b.deleted_at);

  return (
    <>
      {/* You ─ identity only. Money and lists live in their own sections so
          this card stays a single glance. */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
          <button
            type="button"
            onClick={onEditAvatar}
            aria-label="Change your avatar"
            style={{ background: 'none', border: 0, padding: 0, cursor: onEditAvatar ? 'pointer' : 'default', position: 'relative' }}
          >
            <Avatar emoji={avatarEmoji} colour={avatarColour} name={displayName} size={62} />
            {onEditAvatar && (
              <span aria-hidden style={{
                position: 'absolute', right: -2, bottom: -2, width: 22, height: 22,
                borderRadius: 999, background: 'var(--brand)', color: '#fff',
                display: 'grid', placeItems: 'center', border: '2px solid var(--surface)',
              }}>
                <svg viewBox="0 0 24 24" width={11} height={11} stroke="currentColor" strokeWidth={3}
                     fill="none" strokeLinecap="round"><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
              </span>
            )}
          </button>

          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-.03em', color: displayName.trim() ? undefined : 'var(--text-dim)' }}>
              {displayName.trim() || 'Add your name'}
            </p>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 3 }}>
              {monthName(now)} · {money0(dayToDayMinor, currency)} day-to-day
            </p>
          </div>

          {onEditSetting && (
            <button type="button" onClick={() => onEditSetting('name')} aria-label="Edit your name"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '8px 14px', cursor: 'pointer', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
              Edit
            </button>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title="Your money" />
        <SettingRow
          icon={<SettingIcon bg="var(--brand-purple)" path="M12 3v18M8 7h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6" />}
          name="Monthly income"
          sub={monthlyIncomeMinor > 0 ? 'Take-home pay, after tax' : 'Not set'}
          value={monthlyIncomeMinor > 0 ? money0(monthlyIncomeMinor, currency) : '—'}
          onClick={onEditSetting && (() => onEditSetting('income'))}
        />
        <SettingRow
          divider
          icon={<SettingIcon bg="var(--brand)" path="M3 10.5h18M6 6h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />}
          name="Day-to-day budget" sub="Your monthly spending money"
          value={money0(dayToDayMinor, currency)}
          onClick={onEditSetting && (() => onEditSetting('budget'))}
        />
        <SettingRow
          divider
          icon={<SettingIcon bg="var(--positive)" path="M4 11.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5c0 2-1.1 3.8-2.8 5V19h-3v-1.6a11 11 0 0 1-4.4 0V19h-3v-2.5C5.1 15.3 4 13.5 4 11.5z" />}
          name="Savings target" sub="What you aim to keep each month"
          value={money0(savingsTargetMinor, currency)}
          onClick={onEditSetting && (() => onEditSetting('savings'))}
        />
      </Card>

      {/* Collapsed by default. Three open lists filled the screen and buried
          sign-out; the counts carry the information without the height. */}
      <Section title="Day-to-day categories" count={flex.length}
               onAdd={onEditCategory && (() => onEditCategory(null))}>
        {flex.map((c, i) => (
          <SettingRow
            key={c.local_id}
            divider={i > 0}
            icon={<Icon name={c.icon} size={30} colour={c.colour} />}
            name={c.name}
            sub={`${money(d.byCategory.get(c.local_id) ?? 0, currency)} of ${money0(c.limit_minor, currency)} used`}
            value={money0(c.limit_minor, currency)}
            onClick={onEditCategory && (() => onEditCategory(c))}
          />
        ))}
      </Section>

      <Section title="Fixed costs" count={fixed.length}
               onAdd={onEditCategory && (() => onEditCategory(null))}>
        {fixed.map((c, i) => (
          <SettingRow
            key={c.local_id}
            divider={i > 0}
            icon={<Icon name={c.icon} size={30} colour={c.colour} />}
            name={c.name}
            sub={c.due_day ? `Due on the ${ordinal(c.due_day)}` : 'No due day set'}
            value={money0(c.limit_minor, currency)}
            onClick={onEditCategory && (() => onEditCategory(c))}
          />
        ))}
      </Section>

      <Section title="Banks & cards" count={liveBanks.length}
               onAdd={onEditBank && (() => onEditBank(null))}>
        {liveBanks.map((b, i) => {
          const used = transactions.filter((t) => !t.deleted_at && t.bank_id === b.local_id).length;
          return (
            <SettingRow
              key={b.local_id}
              divider={i > 0}
              icon={<SettingIcon bg={b.colour} path="M3 10.5h18M6 6h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />}
              name={b.name}
              sub={`${used} ${used === 1 ? 'transaction' : 'transactions'}`}
              onClick={onEditBank && (() => onEditBank(b))}
            />
          );
        })}
      </Section>

      {onSignOut && (
        <Card>
          <button
            type="button"
            onClick={onSignOut}
            style={{
              width: '100%', minHeight: 48, border: 0, borderRadius: 'var(--r-md)', cursor: 'pointer',
              background: 'var(--danger-soft)', color: 'var(--danger)',
              fontSize: 'var(--fs-sm)', fontWeight: 700,
            }}
          >
            Sign out
          </button>
        </Card>
      )}

      {onDeleteAccount && (
        <Card style={{ borderColor: 'var(--danger-soft)' }}>
          <CardHead title="Danger zone" />
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 'var(--s3)' }}>
            Permanently delete your account and everything in it.
          </p>
          <button
            type="button"
            onClick={onDeleteAccount}
            style={{
              width: '100%', minHeight: 48, borderRadius: 'var(--r-md)', cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--danger)',
              color: 'var(--danger)', fontSize: 'var(--fs-sm)', fontWeight: 700,
            }}
          >
            Delete account
          </button>
        </Card>
      )}
    </>
  );
}

/** A card that opens on tap. Closed it costs one row; open it is a full list. */
function Section({ title, count, onAdd, children }: {
  title: string; count: number; onAdd?: (() => void) | undefined; children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ padding: 'var(--s4) var(--s5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--s2)',
            background: 'none', border: 0, padding: 0, cursor: 'pointer',
            color: 'inherit', textAlign: 'left', minHeight: 32,
          }}
        >
          <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, letterSpacing: '-.02em' }}>{title}</h2>
          <span className="num" style={{
            fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-muted)',
            background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: '2px 8px',
          }}>{count}</span>
          <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden stroke="currentColor" strokeWidth={2.4}
               fill="none" strokeLinecap="round" strokeLinejoin="round"
               style={{ marginLeft: 'auto', color: 'var(--text-dim)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .18s ease' }}>
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {open && onAdd && <CardAction onClick={onAdd}><PlusGlyph />New</CardAction>}
      </div>
      {open && (
        <div style={{ marginTop: 'var(--s2)' }}>
          {count === 0
            ? <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', fontWeight: 600, padding: 'var(--s2) 0' }}>Nothing here yet.</p>
            : children}
        </div>
      )}
    </Card>
  );
}

/** 1st, 2nd, 3rd, 4th… 11th-13th are the exceptions that catch naive rules. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function PlusGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" strokeWidth={2.4}
         fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
  );
}

function SettingIcon({ bg, path, circle }: { bg: string; path: string; circle?: boolean }): JSX.Element {
  return (
    <span aria-hidden style={{
      width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center',
      flexShrink: 0, color: '#fff', background: bg,
    }}>
      <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={2}
           fill="none" strokeLinecap="round" strokeLinejoin="round">
        {circle && <circle cx="12" cy="8.5" r="3.5" />}
        <path d={path} />
      </svg>
    </span>
  );
}

/**
 * A tappable settings line. Renders as a real <button> only when it does
 * something — a div that looks tappable but is not is worse than a plain row.
 */
function SettingRow({ icon, name, sub, value, onClick, divider }: {
  icon: React.ReactNode; name: string; sub: string;
  value?: string; onClick?: (() => void) | undefined; divider?: boolean;
}): JSX.Element {
  const Tag = onClick ? 'button' : 'div';
  return (
    <>
      {divider && <div style={{ height: 1, background: 'var(--line)' }} />}
      <Tag
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s3)', width: '100%',
          textAlign: 'left', padding: 'var(--s3) 0', background: 'none', border: 0,
          borderRadius: 'var(--r-md)', color: 'inherit', cursor: onClick ? 'pointer' : 'default',
        }}
      >
        {icon}
        <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{name}</span>
          <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 3 }}>{sub}</span>
        </span>
        {value !== undefined && (
          <span className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>{value}</span>
        )}
        {onClick && (
          <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden stroke="currentColor" strokeWidth={2.2}
               fill="none" strokeLinecap="round" strokeLinejoin="round"
               style={{ color: 'var(--text-dim)', flexShrink: 0 }}><path d="M9 5l7 7-7 7" /></svg>
        )}
      </Tag>
    </>
  );
}

export { derive };
