import { useState } from 'react';
import { formatMoney, formatSignedMoney, type Bank, type Category, type Transaction } from '@spendwise/shared-types';
import { Avatar, Bar, Card, CardHead, Chip, Dot, Empty, Icon } from '../design-system/components.js';
import { labelFor, PROVIDER_NAME, type Identity } from '../core/auth/identities.js';
import {
  derive, groupByDay, statusOf, STATUS_COLOUR, type Derived,
} from '../features/insights/selectors.js';
import { chalk } from '../design-system/hues.js';
import { incomeTimeline } from '../features/insights/income.js';
import { spentInCycle, usagePct } from '../features/budget/spend.js';
import { monthOutlook } from '../features/budget/outlook.js';
import { cycleSettingsOf } from '../features/budget/model.js';
import { SwipeRow } from '../design-system/SwipeRow.js';

import { nextDuePot, type Budget } from '../features/budget/model.js';
import { type Cycle } from '../features/budget/cycle.js';
import { report, monthPeriod, prevMonthPeriod, windowPeriod } from '../features/budget/report.js';
import { isoDay } from '../features/budget/cycle.js';
import type { PotState } from '../features/budget/pots.js';

export interface ScreenData {
  /**
   * The cycle model: pay-cycle boundaries, pot balances, flow allowances and
   * the summary. Home and Analytics read this; the older month-scoped `d` is
   * still here for the screens not yet migrated.
   */
  budget: Budget;
  transactions: Transaction[];
  categories: Category[];
  /**
   * The legacy calendar-month derivation.
   *
   * Optional and unread: every screen now takes its figures from `budget`,
   * which runs on the pay cycle. Two engines computing the same things is what
   * produced a header saying "12 days left" above a card saying "3 days to
   * go", and a day-to-day budget of £570 in one place and £830 in another.
   * Kept on the type only so existing callers and fixtures still compile.
   */
  d?: Derived;
  currency: string;
  now: Date;
  displayName: string;
  dayToDayMinor: number;
  savingsTargetMinor: number;
  /** Tap a transaction row to edit it. Absent in read-only contexts. */
  onEdit?: ((t: Transaction) => void) | undefined;
  /** Delete lives on the row's swipe action, not in the edit sheet. */
  onDeleteTx?: ((localId: string) => void | Promise<void>) | undefined;
  /** Open the set-aside sheet for a pot. */
  onPutAside?: ((potId: string) => void) | undefined;
  /**
   * Record that a reservation was physically moved. One tap, no sheet — Home
   * confirms what the app already decided; changing the amount belongs on
   * Budgets, where the pot itself lives.
   */
  onConfirmMove?: ((potId: string, amountMinor: number) => void | Promise<void>) | undefined;
  /** Absent when running purely locally — there is no session to end. */
  onSignOut?: (() => void) | undefined;
  banks: Bank[];
  /** Jump to another tab, for the "See all" / "All bills" card actions. */
  onGoto?: ((tab: 'activity' | 'budgets' | 'profile' | 'insights') => void) | undefined;
  /** Activity filter, lifted so the tab header can show the count. */
  filter?: TxFilter | undefined;
  onFilter?: ((f: TxFilter) => void) | undefined;
  /** Open the single-value editor for one of the month settings. */
  onEditSetting?: ((which: 'budget' | 'savings' | 'name' | 'income' | 'cash') => void) | undefined;
  /** null opens the editor empty, for a new one. */
  onEditCategory?: ((c: Category | null) => void) | undefined;
  onEditBank?: ((b: Bank | null) => void) | undefined;
  onEditAvatar?: (() => void) | undefined;
  onDeleteAccount?: (() => void) | undefined;
  identities?: Identity[] | undefined;
  monthlyIncomeMinor?: number | undefined;
  avatarEmoji?: string | undefined;
  avatarColour?: string | undefined;
}

export type TxFilter = 'all' | 'spending' | 'income' | 'bills';

const money = (minor: number, cur: string): string => formatMoney(minor, cur);
/** Whole pounds, for figures where pence are noise (budgets, bills, totals). */
const money0 = (minor: number, cur: string): string =>
  formatMoney(minor, cur, 'en-GB').replace(/[.,]\d{2}$/, '');

const monthName = (now: Date): string => now.toLocaleDateString('en-GB', { month: 'long' });
/** Use for anything that shows a +/− sign. See formatSignedMoney. */
const signed = (minor: number, cur: string): string => formatSignedMoney(minor, cur);
const catOf = (cats: Category[], id: string | null): Category | undefined =>
  id ? cats.find((c) => c.local_id === id) : undefined;

/* ── Home ─────────────────────────────────────────────────────────────── */

export function Home({
  transactions, categories, banks, budget, currency, now, onGoto, onConfirmMove,
}: ScreenData): JSX.Element {
  const { cycle, pots, summary } = budget;
  const next = nextDuePot(pots);
  /*
   * Short of money, or overspent? They look identical in the arithmetic —
   * availableMinor below zero — and mean opposite things to the person
   * reading it. `short` is the money simply not being here yet; `over` is
   * having spent past the budget. Short wins, because it is the kinder and
   * the more common cause early in a cycle.
   */
  const short = summary.cashShortfallMinor > 0;
  const over = !short && summary.availableMinor < 0;

  const recent = transactions.filter((t) => !t.deleted_at)
    .slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 3);

  /* The next cycle begins the day the next wage lands. */
  const payday = cycle.end.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  /* Pots whose reservation this cycle has not been physically moved yet. */
  const toMove = pots.filter((p) => p.outstandingMinor > 0);
  const toMoveTotal = toMove.reduce((n, p) => n + p.outstandingMinor, 0);

  return (
    <>
      {/* The spine. perDayMinor already nets out this morning's coffee and
          self-corrects tomorrow, so it is the one figure that cannot flatter. */}
      {/*
        A plain card, not the old gradient panel with its corner bloom. The
        gradient was there to make one number feel important; under this
        palette the number is 50px of mono against everything else at 13, and
        the decoration only added noise around it.
      */}
      <Card style={{ padding: '22px 20px' }}>
        <div>
          {/*
            Over budget is its own state, not zero.
            
            Clamping at £0 produced "£0.00 yours to spend today" directly above
            "-£136.85 left", which says two different things at once. When the
            money is gone the honest headline is how far past it you are.
          */}
          {/*
            Three states, not two.

            Being short of money is not the same as having overspent, and they
            cannot share wording. Someone who has spent £30 of a £430 budget
            but holds £153 against £159 of bill contributions is early in the
            cycle with wages still to come — telling them they are "over your
            week" is false, and it is the most alarming thing this screen can
            say. `short` is that case; `over` is genuine overspending.
          */}
          <p className="num" data-testid="safe-to-spend" data-tour="safe-to-spend" style={{
            fontSize: 50, fontWeight: 600, letterSpacing: '-.045em', lineHeight: 1,
            /* White unless it is genuinely bad. Amber sat badly against the
               charcoal — muddy rather than urgent — and "waiting for payday"
               is not a warning anyway. Red is kept for actually overspent. */
            color: over ? 'var(--danger)' : undefined,
          }}>
            {money(over ? -summary.availableMinor : short ? 0 : summary.perDayMinor, currency)}
          </p>
          <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 650, color: 'var(--text-muted)', marginTop: 9 }}>
            {/* Same three words in every state: the question is always "what
                can I spend today". Only the number and the reason change. */}
            {over ? `over budget this ${cycleWord(cycle)}` : 'to spend today'}
          </p>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 13 }}>
            {/*
              One sentence, in the order a person asks it.

              This read "£0.00 / to spend until you are paid" above "£1,037.60
              spent this month · 1 day still to go" above "Bills need £868.06
              this month and you have £79.25. Your next pay covers it." Three
              figures with no stated relationship, and the reader left to work
              out that the second minus the third is why the first is zero.
              Say what is held, why it cannot be spent, and when that changes.
            */}
            {short
              ? (summary.cashShortfallMinor > 0
                ? <>
                    <strong className="num" style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                      {money(summary.cashShortfallMinor, currency)}
                    </strong>
                    {' short for bills · next pay '}{payday}
                  </>
                : <>
                    Your{' '}
                    <strong className="num" style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                      {money(Math.max(0, summary.cashTotalMinor), currency)}
                    </strong>
                    {' is held for bills · next pay '}{payday}
                  </>)
              : (
                <>
                  {money(summary.flowSpentMinor, currency)} spent this {cycleWord(cycle)}
                  {' · '}
                  {/*
                    Over budget still has to say what is in the bank. `available`
                    is the smaller of "budget left" and "cash free", so once the
                    categories are overspent it pins to the overspend and stops
                    responding — someone could set their balance from £150 to
                    £2,000 and watch every figure stay identical.
                  */}
                  {over && summary.cashKnown && summary.freeCashMinor > 0
                    ? <>
                        <strong className="num" style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                          {money(summary.freeCashMinor, currency)}
                        </strong>
                        {' not spoken for'}
                      </>
                    : over
                      ? <>{cycle.daysLeft} {cycle.daysLeft === 1 ? 'day' : 'days'} still to go</>
                      : <>
                          <strong className="num" style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                            {money(summary.availableMinor, currency)}
                          </strong>
                          {' left with '}{cycle.daysLeft} {cycle.daysLeft === 1 ? 'day' : 'days'} to go
                        </>}
                </>
              )}
          </p>

          {/*
            Plain arithmetic, in the order a person would say it.

            This used to read "Your limits add up to £169.00 more than is left
            once bills and savings are set aside" — every word true and the
            whole sentence unreadable, because it names no actual figures and
            asks the reader to hold three abstractions at once. Say what you
            have, what is owed, and what to do.
          */}
          {!short && summary.overcommittedMinor > 0 && (
            <p style={{
              fontSize: 'var(--fs-xs)', fontWeight: 650, color: 'var(--text-muted)',
              marginTop: 'var(--s3)', lineHeight: 1.5,
            }}>
              You have set <strong className="num">{money(summary.flowAllowanceMinor, currency)}</strong> of
              {' '}{cycleWord(cycle)}ly budgets, but only
              {' '}<strong className="num">{money(summary.spendableMinor, currency)}</strong> is free after bills.
              {' '}Lower them by <strong className="num">{money(summary.overcommittedMinor, currency)}</strong>.
            </p>
          )}
          {summary.billsUnfundedMinor > 0 && (
            <p style={{
              fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--danger)', marginTop: 'var(--s3)',
            }}>
              {money(summary.billsUnfundedMinor, currency)} of bills is not covered by this
              {' '}{cycleWord(cycle)}&rsquo;s income.
            </p>
          )}
        </div>
      </Card>

      {/*
        Until we know what is held, every figure above is worked out from the
        limits alone. Say so once, at the top, rather than quietly presenting a
        guess as a fact.
      */}
      {!summary.cashKnown && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
            <SettingGlyph bg="var(--positive)" text={currencySymbol(currency)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>How much have you got?</p>
              <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 3 }}>
                Profile &rsaquo; Your money. These figures follow it once you do.
              </p>
            </div>
            <span style={{
              flexShrink: 0, fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)',
            }}>
              Profile
            </span>
          </div>
        </Card>
      )}

      {/*
        Have you actually moved it?

        The money is already reserved — held back from the daily allowance —
        so this changes no arithmetic. It exists because a reservation the app
        makes on your behalf is only real if the cash is somewhere you will
        not spend it by accident. One card, dismissable by doing the thing,
        never a blocking prompt.
      */}
      {/*
        One line, not a list.
        
        This was a card with a row and a button per pot — six bills made it the
        tallest thing on Home, above the figure people actually open the app
        for. The money is already reserved, so this is a reminder, and a
        reminder does not need a table. One total, one button; the breakdown
        is on Budgets where the pots live.
      */}
      {toMove.length > 0 && onConfirmMove && (
        <Card style={{ padding: 'var(--s3) var(--s4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
            <span aria-hidden style={{
              width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: 'var(--brand)',
            }} />
            <p style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', fontWeight: 650, color: 'var(--text-muted)' }}>
              Move <strong className="num" style={{ color: 'var(--text)' }}>{money(toMoveTotal, currency)}</strong>
              {' '}aside for {toMove.length === 1 ? toMove[0]!.pot.name.toLowerCase() : `${toMove.length} bills`}
            </p>
            <button
              type="button"
              onClick={() => { for (const p of toMove) void onConfirmMove(p.pot.id, p.outstandingMinor); }}
              style={{
                flexShrink: 0, padding: '7px 13px', borderRadius: 'var(--r-pill)',
                border: '1px solid var(--line-strong)', background: 'var(--surface-2)',
                color: 'var(--text)', fontSize: 'var(--fs-2xs)', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </Card>
      )}

      {/*
        One slot, and only while it is still asking for something.
        
        It used to sit there reading "nothing more to find" once the bill was
        covered — a card taking up the top of the screen to tell you about
        something already handled. When it is funded it has nothing left to
        say, so it goes.
      */}
      {next && next.neededMinor > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              Coming up
            </span>
            <Chip tone={next.outstandingMinor === 0 ? 'ok' : 'neutral'}>
              {next.outstandingMinor === 0
                ? (next.contributedMinor > 0 ? `${money(next.contributedMinor, currency)} put by` : 'nothing needed')
                : `${money(next.outstandingMinor, currency)} this ${cycleWord(cycle)}`}
            </Chip>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
            <Dot colour={colourFor(categories, next.pot.id)} size={10} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>{next.pot.name}</p>
              <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 3 }}>
                {dueLabel(next.nextDue, now)}
              </p>
            </div>
            <p className="num" style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
              {money0(next.pot.amountMinor, currency)}
            </p>
          </div>
          <div style={{ marginTop: 'var(--s4)' }}>
            <Bar
              pct={next.pot.amountMinor > 0 ? (next.backedMinor / next.pot.amountMinor) * 100 : 0}
              colour="var(--positive)"
            />
          </div>
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 9 }}>
            {/* Backed, not accrued. The plan says what should be by; only cash
                says what is. Claiming money set aside on an empty account was
                the loudest thing this screen got wrong. */}
            <strong className="num" style={{ color: 'var(--text-muted)' }}>
              {money(next.backedMinor, currency)}
            </strong>
            {' set aside'}
            {next.pot.amountMinor - next.backedMinor > 0
              ? ` · ${money(next.pot.amountMinor - next.backedMinor, currency)} to go`
              : ' · nothing more to find'}
          </p>

        </Card>
      )}

      {/*
        No "Where it went" here.
        
        Home answers "how am I doing"; a per-category breakdown is a different
        question, it was the tallest thing on the screen, and Analytics already
        does it properly with period switching and comparisons.
      */}
      <Card>
        <CardHead title="Recent" action={onGoto && <CardAction onClick={() => onGoto('activity')}>See all</CardAction>} />
        {recent.length === 0
          ? <Empty icon="other" title="No activity yet" body="Tap + to record your first transaction." />
          : recent.map((t, i) => (
            /* Read-only on purpose. Home is a summary; changing a transaction
               from a three-row preview invites edits made without the context
               of the day around them. Editing lives in History. */
            <Row key={t.local_id} t={t} cats={categories} banks={banks} divider={i > 0} />
          ))}
      </Card>
    </>
  );
}

/** "week" for a 7-day cycle, "month" for monthly, "period" for the rest. */
function cycleWord(c: Cycle): string {
  if (c.daysTotal === 7) return 'week';
  if (c.daysTotal === 14) return 'fortnight';
  if (c.daysTotal >= 28 && c.daysTotal <= 31) return 'month';
  return 'period';
}

function dueLabel(due: Date | null, now: Date): string {
  if (!due) return 'No date set';
  const days = Math.round((due.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const when = due.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (days < 0) return `${when} · overdue`;
  if (days === 0) return `${when} · today`;
  return `${when} · in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** The icon a pot's category carries, for screens that show pots not categories. */
const iconFor = (cats: Category[], id: string): string =>
  cats.find((c) => c.local_id === id)?.icon ?? 'other';
/** Raw category colour — Icon translates it itself, unlike Dot. */
const colourOf = (cats: Category[], id: string): string =>
  cats.find((c) => c.local_id === id)?.colour ?? '#8A8A99';

const colourFor = (cats: Category[], id: string): string =>
  chalk(cats.find((c) => c.local_id === id)?.colour ?? null);

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

/*
 * A fixed cost, dated by the pot engine rather than the calendar month.
 *
 * This row used to read `billsFor()`, which measures `dueDay - dayOfMonth`
 * inside the current month only. Past the due day that is always negative, so
 * every bill in the back half of every month was stamped "Overdue" — while
 * the Setting-aside card directly above, which asks the pot engine, said the
 * same bill was due in 15 days. One screen, one bill, two answers.
 *
 * `nextDue` is the occurrence the money actually leaves on, so it rolls into
 * next month by itself and "overdue" once again means overdue.
 */
function BillRow({ pot, cats, currency, now, divider, showStatus = false, compact = false }: {
  pot: PotState; cats: Category[]; currency: string; now: Date;
  divider: boolean; showStatus?: boolean; compact?: boolean;
}): JSX.Element {
  const c = { icon: iconFor(cats, pot.pot.id), colour: colourOf(cats, pot.pot.id) };
  const when = dueLabel(pot.nextDue, now);
  return (
    <>
      {divider && <div style={{ height: 1, background: 'var(--line)' }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: compact ? 'var(--s2) 0' : '9px 0' }}>
        <Icon name={c.icon} size={compact ? 34 : 44} colour={c.colour} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pot.pot.name}</p>
          <p style={{ fontSize: compact ? 'var(--fs-2xs)' : 'var(--fs-xs)', fontWeight: 500, color: 'var(--text-dim)', marginTop: compact ? 1 : 3 }}>{when}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 800 }}>{money0(pot.pot.amountMinor, currency)}</p>
          {showStatus && (
            <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-dim)', marginTop: 3 }}>
              {pot.neededMinor === 0 ? 'Funded' : 'Scheduled'}
            </p>
          )}
        </div>
      </div>
    </>
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
  /** Delete lives on the row's swipe action, not in the edit sheet. */
  onDeleteTx?: ((localId: string) => void | Promise<void>) | undefined;
  divider?: boolean;
}): JSX.Element {
  const c = catOf(cats, t.category_id);
  const b = t.bank_id ? banks.find((x) => x.local_id === t.bank_id) : undefined;
  /* A transfer is money set aside, not spent — it has to read differently or
     the list shows saving for a bill as though it were a purchase. */
  const label = t.is_income ? 'Income'
    : t.is_transfer ? `Set aside · ${c?.name ?? 'pot'}`
      : (c?.name ?? 'Uncategorised');
  const iconName = t.is_income ? 'income' : (c?.icon ?? 'other');
  const colour = t.is_income ? 'var(--positive)' : (c?.colour ?? 'var(--surface-3)');
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
        <Icon name={iconName} size={44} colour={colour} />
        <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 700, letterSpacing: '-.01em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{t.merchant?.trim() || label}</span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            fontSize: 'var(--fs-xs)', fontWeight: 500, color: 'var(--text-dim)', marginTop: 3,
          }}>
            {/* Only when the line above is showing something else. Without a
                merchant the title already falls back to the category, and it
                was printed twice: "Groceries / Groceries · 10:00". */}
            {t.merchant?.trim() ? <>
              <span>{label}</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-dim)', flexShrink: 0 }} />
            </> : null}
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
            color: t.is_income ? 'var(--positive)' : t.is_transfer ? 'var(--text-dim)' : undefined,
          }}>
            {t.is_transfer
              ? money(Math.abs(t.amount_minor), t.currency)
              : signed(t.is_income ? Math.abs(t.amount_minor) : -Math.abs(t.amount_minor), t.currency)}
          </span>
          {b && (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end',
              fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-dim)', marginTop: 3,
            }}>
              <i style={{ width: 7, height: 7, borderRadius: '50%', background: chalk(b.colour), flexShrink: 0 }} />
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
  transactions, categories, banks, currency, now, onEdit, onDeleteTx,
  filter = 'all', onFilter,
}: ScreenData): JSX.Element {
  const live = transactions.filter((t) => !t.deleted_at);
  const isBill = (t: Transaction): boolean => {
    const c = catOf(categories, t.category_id);
    return Boolean(c?.is_fixed);
  };
  /* Setting money aside is a movement between your own pockets, not spending
     and not a bill being paid. It belongs in neither count. */
  const counts = {
    all: live.length,
    spending: live.filter((t) => !t.is_income && !t.is_transfer).length,
    income: live.filter((t) => t.is_income).length,
    bills: live.filter((t) => isBill(t) && !t.is_transfer).length,
  };
  const keep = (t: Transaction): boolean =>
    filter === 'all' ? true
      : filter === 'income' ? t.is_income
        : filter === 'bills' ? (isBill(t) && !t.is_transfer)
          : (!t.is_income && !t.is_transfer);

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
              padding: 'var(--s4) 0 var(--s2)',
            }}>
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.label}</span>
              <span className="num" style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: g.netMinor > 0 ? 'var(--positive)' : 'var(--text-dim)' }}>
                {signed(g.netMinor, currency)}
              </span>
            </div>
            <Card style={{ padding: 'var(--s1) var(--s4)' }}>
              {g.items.map((t, i) => (
                <SwipeRow
                  key={t.local_id}
                  onEdit={onEdit ? () => onEdit(t) : undefined}
                  onDelete={onDeleteTx ? () => void onDeleteTx(t.local_id) : undefined}
                >
                  {/* No onEdit: a tap must not open anything. Scrolling a list
                      with a thumb should never be able to open an editor. */}
                  <Row t={t} cats={categories} banks={banks} divider={i > 0} />
                </SwipeRow>
              ))}
            </Card>
          </div>
        ))}
    </>
  );
}

/* ── Budgets ──────────────────────────────────────────────────────────── */

export function Budgets({
  categories, transactions, currency, now, budget, onPutAside,
}: ScreenData): JSX.Element {
  const flex = categories.filter((c) => !c.is_fixed && !c.deleted_at);
  /* Everything on this screen is measured over the pay cycle, because that is
     the period the limits refill on. */
  const headlinePct = usagePct(budget.summary.flowSpentMinor, budget.summary.flowAllowanceMinor);
  const available = budget.summary.availableMinor;
  const total = statusOf(headlinePct);
  /* Bills, in the order they actually fall due — same engine as the card above. */
  const billPots = budget.pots
    .filter((p) => p.pot.kind === 'bill')
    .sort((a, b) => (a.nextDue?.getTime() ?? Infinity) - (b.nextDue?.getTime() ?? Infinity));

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
          <div>
            <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              This {cycleWord(budget.cycle)} day-to-day
            </p>
            <p className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-.035em', marginTop: 6, color: available < 0 ? 'var(--danger)' : undefined }}>
              {money(Math.abs(available), currency)} {available < 0 ? 'over' : 'left'}
            </p>
          </div>
          <Chip tone="neutral">{budget.cycle.daysLeft} {budget.cycle.daysLeft === 1 ? 'day' : 'days'} left</Chip>
        </div>
        <Bar pct={headlinePct} colour={STATUS_COLOUR[total]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', marginTop: 'var(--s2)', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)' }}>
          <span className="num">{money(budget.summary.flowSpentMinor, currency)} spent</span>
          <span className="num">{money0(budget.summary.flowAllowanceMinor, currency)} budget</span>
        </div>
      </Card>

      <Card>
        <CardHead title="Day-to-day" />
        {flex.length === 0
          ? <Empty icon="other" title="No categories yet" body="Add one to start tracking day-to-day spending." />
          : flex.map((c, i) => {
              /* The limit refills each cycle, so the spend measured against
                 it must be this cycle's — not the calendar month's. */
              const spent = spentInCycle(transactions, c.local_id, budget.cycle);
              const pct = usagePct(spent, c.limit_minor);
              const cst = statusOf(pct);
              const remaining = c.limit_minor - spent;
              return (
                <div key={c.local_id} style={{ padding: 'var(--s4) 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                    <Icon name={c.icon} size={34} colour={c.colour} />
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
        {/*
          Setting money aside lives here, not on Home.

          Home is a dashboard — it answers "how am I doing" and nothing on it
          should change anything. Budgets is the screen about commitments, so
          the one action that funds them belongs beside them.
        */}
        <CardHead title="Setting aside" />
        {budget.pots.length === 0
          ? <Empty icon="savings" title="Nothing to save for" body="Bills and goals you add will show here." />
          : budget.pots.map((p, i) => {
              const pct = p.pot.amountMinor > 0 ? (p.backedMinor / p.pot.amountMinor) * 100 : 0;
              return (
                <div key={p.pot.id} style={{ padding: 'var(--s4) 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                    <Icon name={iconFor(categories, p.pot.id)} size={34} colour={colourOf(categories, p.pot.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{p.pot.name}</p>
                      <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 3 }}>
                        {dueLabel(p.nextDue, now)} · {money0(p.pot.amountMinor, currency)}
                      </p>
                    </div>
                    <p className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--positive)' }}>
                      {money(p.backedMinor, currency)}
                    </p>
                  </div>
                  <Bar pct={pct} colour="var(--positive)" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
                    <p style={{ flex: 1, fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600 }}>
                      {p.outstandingMinor > 0
                        ? <>{money(p.outstandingMinor, currency)} to put by this {cycleWord(budget.cycle)}</>
                        : p.contributedMinor > 0
                          ? <>{money(p.contributedMinor, currency)} put by this {cycleWord(budget.cycle)}</>
                          : <>nothing needed this {cycleWord(budget.cycle)}</>}
                    </p>
                    {onPutAside && (
                      <button
                        type="button"
                        onClick={() => onPutAside(p.pot.id)}
                        style={{
                          flexShrink: 0, padding: '9px 15px', borderRadius: 'var(--r-pill)',
                          border: '1px solid var(--line-strong)', background: 'var(--surface-2)',
                          color: 'var(--text)', fontSize: 'var(--fs-2xs)', fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        Set aside
                      </button>
                    )}
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
              {money0(billPots.reduce((t, p) => t + p.pot.amountMinor, 0), currency)} / month
            </span>
          }
        />
        {billPots.length === 0
          ? <Empty icon="bills" title="No fixed costs" body="Rent, bills and subscriptions will appear here." />
          : billPots.map((b, i) => (
              <BillRow key={b.pot.id} pot={b} cats={categories} currency={currency} now={now} divider={i > 0} showStatus />
            ))}
      </Card>
    </>
  );
}

/* ── Insights ─────────────────────────────────────────────────────────── */

export function Insights({
  transactions, categories, budget, currency, now,
}: ScreenData): JSX.Element {
  const [scope, setScope] = useState<'cycle' | 'month'>('cycle');

  /*
   * Budgeting runs on the pay cycle; reporting can run on whatever period you
   * want to look at. Keeping them separate is the whole point — the old screen
   * divided a weekly earner's money by a calendar month and called it insight.
   */
  const period = scope === 'cycle'
    ? windowPeriod(budget.cycle.start, budget.cycle.end, 'This ' + periodWord(budget.cycle))
    : monthPeriod(now);
  const previous = scope === 'cycle'
    ? windowPeriod(budget.prevCycle.start, budget.prevCycle.end, 'Last ' + periodWord(budget.cycle))
    : prevMonthPeriod(period);

  const r = report(transactions, categories, period, previous);

  /*
   * "In" showed £0 for anyone who has not logged a salary transaction — which
   * is most people, since wages arrive in a bank account rather than through
   * this app. Reporting zero income to someone who told onboarding they earn
   * £500 a week reads as broken, because the app plainly knows better.
   *
   * So it falls back to the expectation and says so.
   *
   * A calendar month holds a variable number of pay packets, so there is no
   * honest way to scale one weekly figure up to a month — 52 ÷ 12 is 4.33 and
   * no month has 4.33 paydays. This scope therefore used to fall back to
   * nothing at all, and "August" reported In £0.00 directly beneath a card
   * reading "Expected in £1,800.00", with the sibling tab one tap away
   * reading £450.00. Three answers, one screen, same money.
   *
   * monthOutlook already counts the paydays instead of averaging them, so the
   * honest figure exists: paydays PASSED times the packet. Passed, not total,
   * because this card reports a period against a bar chart of days gone by —
   * pairing money not yet earned with spending not yet done would overstate
   * the month every time you opened it before the last payday.
   */
  /*
   * The month, for people whose pay does not run on one.
   *
   * Everything else here is per pay cycle, which is right — but bills are
   * monthly, and a weekly earner cannot add four or five cycles together in
   * their head to answer "does this month cover itself". Shown only when the
   * pay cycle is NOT already a calendar month, since otherwise it repeats the
   * card above it.
   *
   * Computed before the In/Out/Net figures because they now read its honest
   * payday count rather than reaching for an average.
   */
  const outlook = monthOutlook(
    cycleSettingsOf({
      cycleKind: budget.cycle.daysTotal >= 28 ? 'monthly' : 'days',
      cycleLengthDays: budget.cycle.daysTotal < 28 ? budget.cycle.daysTotal : null,
      cycleAnchorDate: isoDay(budget.cycle.start),
      cycleAnchorDay: budget.cycle.start.getDate(),
      expectedIncomeMinor: budget.summary.expectedIncomeMinor,
      budgetStartDate: null, openingCashMinor: 0,
    }),
    budget.summary.expectedIncomeMinor, categories, transactions, now,
  );

  const expectedIn = scope === 'cycle'
    ? budget.summary.expectedIncomeMinor
    : outlook.paydaysSoFar * budget.summary.expectedIncomeMinor;
  const inMinor = r.incomeMinor > 0 ? r.incomeMinor : expectedIn;
  const inIsExpected = r.incomeMinor === 0 && expectedIn > 0;
  const netMinor = inMinor - r.spentMinor;
  const maxDay = Math.max(1, ...r.dailyMinor);
  const maxCat = Math.max(1, ...r.byCategory.map((c) => Math.max(c.nowMinor, c.prevMinor)));
  /* Nothing to compare against on a first period: every row would read "+" its
     own full amount, which is the same number twice, not a comparison. */
  const hasPrevData = transactions.some((t) => !t.deleted_at
    && new Date(t.occurred_at) >= r.previous.start && new Date(t.occurred_at) < r.previous.end);

  /*
   * Is the pay cycle already a calendar month?
   *
   * For anyone paid monthly on the 1st the two windows are the same days, and
   * the toggle offered a choice between a thing and itself — labelled
   * "month | month", because periodWord() returns "month" for a 31-day cycle
   * and the other button was the literal string. Nothing to switch between,
   * so there is nothing to show.
   */
  const cycleIsCalendarMonth = budget.cycle.start.getDate() === 1
    && budget.cycle.daysTotal >= 28 && budget.cycle.daysTotal <= 31;
  const setAside = budget.summary.potDemandMinor;

  return (
    <>
      {/*
        Does this month cover itself?
        
        Per-cycle figures cannot be added up in your head, and a weekly earner
        has four paydays in some months and five in others — counted here, not
        averaged, because no month has 4.33 paydays. Only shown when the pay
        cycle is not already a calendar month; otherwise it would repeat the
        card above.
      */}
      {!cycleIsCalendarMonth && outlook.paydaysTotal > 0 && (
        <Card>
          <CardHead
            title={`${outlook.label} overall`}
            action={
              <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)' }}>
                {outlook.paydaysSoFar} of {outlook.paydaysTotal} paydays in
              </span>
            }
          />
          <div style={{ display: 'grid', gap: 'var(--s3)' }}>
            {([
              ['Expected in', outlook.expectedMinor, `${outlook.paydaysTotal} × ${money0(budget.summary.expectedIncomeMinor, currency)}`],
              ['Received so far', outlook.receivedMinor, null],
              ['Bills this month', outlook.billsDueMinor, null],
            ] as const).map(([label, value, note]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--s3)' }}>
                <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 650, color: 'var(--text-muted)' }}>
                  {label}
                  {note && <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>{' · '}{note}</span>}
                </span>
                <span className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, flexShrink: 0 }}>
                  {money(value, currency)}
                </span>
              </div>
            ))}
          </div>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--s3)',
            borderTop: '1px solid var(--line)', marginTop: 'var(--s3)', paddingTop: 'var(--s3)',
          }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
              {outlook.afterBillsMinor >= 0 ? 'Left after bills' : 'Short for bills'}
            </span>
            <span className="num" style={{
              fontSize: 'var(--fs-lg)', fontWeight: 700,
              color: outlook.afterBillsMinor < 0 ? 'var(--danger)' : undefined,
            }}>
              {money(Math.abs(outlook.afterBillsMinor), currency)}
            </span>
          </div>
        </Card>
      )}

      {!cycleIsCalendarMonth && (
        <div role="group" aria-label="Reporting period" style={{
          display: 'inline-flex', gap: 3, padding: 3, alignSelf: 'flex-start',
          background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)',
        }}>
          {/* Named, not word-classed. "Your week" against "August" says which
              is which; "week | month" left the reader guessing whether the
              second one meant their pay month or the calendar's. */}
          {([
            ['cycle', `Your ${periodWord(budget.cycle)}`],
            ['month', now.toLocaleDateString('en-GB', { month: 'long' })],
          ] as const).map(([k, label]) => (
            <button
              key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)}
              style={{
                fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '7px 15px', border: 0,
                borderRadius: 'var(--r-pill)', cursor: 'pointer',
                background: scope === k ? 'var(--brand)' : 'transparent',
                color: scope === k ? 'var(--on-accent)' : 'var(--text-dim)',
              }}
            >{label}</button>
          ))}
        </div>
      )}

      <Card>
        <CardHead title={period.label} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--s3)' }}>
          {([['In', inMinor, 'var(--positive)'],
             ['Out', r.spentMinor, undefined],
             ['Net', netMinor, netMinor < 0 ? 'var(--danger)' : undefined]] as const).map(([k, v, tone]) => (
            <div key={k}>
              <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{k}</p>
              <p className="num" style={{ fontSize: 19, fontWeight: 600, marginTop: 5, letterSpacing: '-.03em', color: tone }}>
                {k === 'Net' && inIsExpected ? '≈' : ''}{k === 'Net' && v > 0 ? '+' : ''}{money(v, currency)}
              </p>
              {/*
                Net is a projection whenever In is.

                With no salary logged, In falls back to the expected figure —
                and Net was then printed as a plain "+£493.15", which reads as
                money in hand. A caption under In alone did not stop the eye
                treating the total as fact, so both cells say so.
              */}
              {((k === 'In' && inIsExpected) || (k === 'Net' && inIsExpected)) && (
                <p style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, marginTop: 2 }}>
                  {k === 'In' ? 'expected' : 'if it lands'}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* One bar per day, zero-filled. A day with nothing spent is a fact. */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 52, marginTop: 'var(--s5)' }}>
          {r.dailyMinor.map((v, i) => (
            <i key={i} style={{
              flex: 1, minHeight: 3, borderRadius: 3, display: 'block',
              height: v > 0 ? `${(v / maxDay) * 100}%` : 3,
              background: v > 0 ? 'var(--brand)' : 'var(--surface-3)',
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9.5, fontWeight: 700, color: 'var(--text-dim)' }}>
          <span>{r.period.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          <span>{new Date(r.period.end.getTime() - 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        </div>

        {scope === 'cycle' && setAside > 0 && (
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 'var(--s4)' }}>
            {/* Deliberately stated: it is committed even though it has not
                left the account, and hiding it is how people spend the rent. */}
            A further <strong className="num" style={{ color: 'var(--text-muted)' }}>{money(setAside, currency)}</strong>
            {' '}is set aside for bills and savings this {periodWord(budget.cycle)}.
          </p>
        )}
      </Card>

      <Card>
        {/* Named differently from Home on purpose. Home's "Where it went" is
            day-to-day only; this is every pound that left, bills included, and
            calling both the same thing made them look contradictory. */}
        <CardHead title="Everything that left" />
        {r.byCategory.length === 0
          ? <Empty icon="other" title="Nothing yet" body="Spending in this period will break down here." />
          : (
            <div style={{ display: 'grid', gap: 'var(--s4)' }}>
              {r.byCategory.slice(0, 8).map((c) => {
                const delta = c.nowMinor - c.prevMinor;
                const colour = chalk(c.colour);
                return (
                  <div key={c.categoryId ?? 'none'} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 'var(--s3)', alignItems: 'center' }}>
                    <Dot colour={colour} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{c.name}</p>
                      <div style={{ position: 'relative', height: 9, borderRadius: 999, background: 'var(--surface-3)', marginTop: 6 }}>
                        <i style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999,
                          width: `${(c.nowMinor / maxCat) * 100}%`, background: colour,
                        }} />
                        {/* Only when there is something to compare with, and
                            centred on its value so a mark at the far end is
                            not half-clipped by the rounded corner. */}
                        {c.prevMinor > 0 && (
                          <i
                            aria-hidden
                            title={`${r.previous.label}: ${money(c.prevMinor, currency)}`}
                            style={{
                              position: 'absolute', top: -4, width: 2, height: 17, borderRadius: 2,
                              left: `calc(${Math.min(100, (c.prevMinor / maxCat) * 100)}% - 1px)`,
                              background: 'var(--text)', opacity: .7,
                            }}
                          />
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{money(c.nowMinor, currency)}</p>
                      {hasPrevData && (
                        <p style={{
                          fontSize: 10.5, fontWeight: 700, marginTop: 3,
                          /* Spending more than last month is a change, not a
                             warning — amber made every ordinary month look
                             like an alert. Green still marks a real drop. */
                          color: delta < 0 ? 'var(--positive)' : 'var(--text-dim)',
                        }}>
                          {delta === 0 ? 'same' : `${delta > 0 ? '+' : '−'}${money(Math.abs(delta), currency)}`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        {r.byCategory.length > 0 && (
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 'var(--s4)' }}>
            Bar is {r.period.label.toLowerCase()}.{hasPrevData && <> The pale mark is {r.previous.label.toLowerCase()}.</>}
          </p>
        )}
      </Card>

      <Card>
        <CardHead title="Set aside" />
        {budget.pots.length === 0
          ? <Empty icon="bills" title="No commitments yet" body="Bills and savings appear here once you add them." />
          : budget.pots.map((p, i) => (
            <div key={p.pot.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3) 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
              <Dot colour={colourFor(categories, p.pot.id)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{p.pot.name}</p>
                <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 2 }}>
                  {p.pot.kind === 'saving'
                    ? `${money(p.perCycleMinor, currency)} a ${periodWord(budget.cycle)}`
                    : p.neededMinor === 0 ? 'fully set aside' : `${money(p.perCycleMinor, currency)} a ${periodWord(budget.cycle)}`}
                </p>
              </div>
              <p className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{money(p.backedMinor, currency)}</p>
            </div>
          ))}
      </Card>
    </>
  );
}

const periodWord = (c: { daysTotal: number }): string =>
  c.daysTotal === 7 ? 'week' : c.daysTotal === 14 ? 'fortnight'
  : c.daysTotal >= 28 && c.daysTotal <= 31 ? 'month' : 'period';

/* ── Profile ──────────────────────────────────────────────────────────── */

export function Profile({
  categories, banks, transactions, currency, displayName,
  savingsTargetMinor, budget, now, onSignOut, onEditSetting, onEditCategory, onEditBank,
  onEditAvatar, avatarEmoji = '', avatarColour = '#6366F1', onDeleteAccount,
  monthlyIncomeMinor = 0, identities = [],
}: ScreenData): JSX.Element {
  const income = incomeTimeline(transactions, now);
  /* Locked from the first wage: after that the ledger owns the balance. */
  const cashLocked = transactions.some((t) => !t.deleted_at && t.is_income);

  const flex = categories.filter((c) => !c.deleted_at && !c.is_fixed);
  const fixed = categories.filter((c) => !c.deleted_at && c.is_fixed);
  const liveBanks = banks.filter((b) => !b.deleted_at);

  return (
    <>
      {/*
        Who you are.

        Deliberately not a Card. Every other section on this screen is one, so
        making the person another bordered box put their name at the same
        weight as "Banks & cards". This sits on the page itself, which is what
        makes the rest read as a list of settings underneath it.
      */}
      <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--s3)', padding: 'var(--s3) 0 var(--s5)' }}>
        <button
          type="button"
          onClick={onEditAvatar}
          aria-label="Change your avatar"
          style={{ background: 'none', border: 0, padding: 0, cursor: onEditAvatar ? 'pointer' : 'default', position: 'relative' }}
        >
          <Avatar emoji={avatarEmoji} colour={avatarColour} name={displayName} size={84} />
          {onEditAvatar && (
            <span aria-hidden style={{
              position: 'absolute', right: 0, bottom: 0, width: 26, height: 26,
              borderRadius: 999, background: 'var(--brand)', color: 'var(--on-accent)',
              display: 'grid', placeItems: 'center', border: '3px solid var(--bg)',
            }}>
              <svg viewBox="0 0 24 24" width={12} height={12} stroke="currentColor" strokeWidth={3}
                   fill="none" strokeLinecap="round"><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onEditSetting && (() => onEditSetting('name'))}
          disabled={!onEditSetting}
          style={{
            background: 'none', border: 0, padding: 0, cursor: onEditSetting ? 'pointer' : 'default',
            color: 'inherit', display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%',
          }}
        >
          <span style={{
            fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-.035em',
            color: displayName.trim() ? 'var(--text)' : 'var(--text-dim)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {displayName.trim() || 'Add your name'}
          </span>
          {onEditSetting && (
            <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden stroke="var(--text-dim)"
                 strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round"
                 style={{ flexShrink: 0 }}><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
          )}
        </button>

      </div>

      <GroupLabel>Money</GroupLabel>
      <Card>
        <CardHead title="Your money" />
        <SettingRow
          icon={<SettingGlyph bg="var(--brand-purple)" text={currencySymbol(currency)} />}
          name="Income"
          sub={monthlyIncomeMinor > 0 ? 'Take-home pay each time you are paid' : 'Not set'}
          value={monthlyIncomeMinor > 0 ? money0(monthlyIncomeMinor, currency) : '—'}
          onClick={onEditSetting && (() => onEditSetting('income'))}
        />
        {/*
          The opening balance is a starting point, not a setting.
          
          Once a wage has landed the ledger has been running on it — income in,
          spending out, cycle after cycle. Editing the figure it started from
          at that point does not correct anything; it silently rewrites history
          and every number downstream of it. So it is editable until the first
          payday and locked after, with the reason on screen rather than a
          control that quietly stops working.
        */}
        <SettingRow
          divider
          icon={<SettingGlyph bg="var(--positive)" text={currencySymbol(currency)} />}
          name="Money you have now"
          sub={cashLocked
            ? 'Tracked from your pay and spending now'
            : budget.summary.cashKnown ? 'What you hold today' : 'Not set — tap to tell us'}
          value={budget.summary.cashKnown ? money0(budget.summary.cashTotalMinor, currency) : '—'}
          onClick={!cashLocked && onEditSetting ? (() => onEditSetting('cash')) : undefined}
        />
        {/*
          No day-to-day budget row.
          
          It was never a figure anyone set here — it is the sum of the category
          limits, and editing it did nothing to them. Two places claiming to
          own the same number, one of which could not change it.
        */}
        <SettingRow
          divider
          icon={<SettingIcon bg="var(--positive)" path="M4 11.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5c0 2-1.1 3.8-2.8 5V19h-3v-1.6a11 11 0 0 1-4.4 0V19h-3v-2.5C5.1 15.3 4 13.5 4 11.5z" />}
          name="Savings target" sub={`What you aim to keep each ${cycleWord(budget.cycle)}`}
          value={money0(savingsTargetMinor, currency)}
          onClick={onEditSetting && (() => onEditSetting('savings'))}
        />
      </Card>

      {/*
        Income logged against the account.

        Adding income used to change nothing anyone could see: it fed the totals
        and then vanished. A timeline is the right shape because income arrives
        in events — a payday, a refund, a side job — and what matters is when
        the last one landed.
      */}
      <Card>
        <CardHead title="Income" />
        {income.entries.length === 0
          ? (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', fontWeight: 600, padding: 'var(--s2) 0' }}>
              No income logged yet. Tap + and choose Income to record a payday.
            </p>
          )
          : (
            <div>
              {income.entries.map((e, i) => {
                const last = i === income.entries.length - 1;
                return (
                  <div key={e.local_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, auto) 18px 1fr', gap: 'var(--s3)' }}>
                    <p className="num" style={{
                      textAlign: 'right', fontSize: 'var(--fs-md)', fontWeight: 600,
                      color: 'var(--positive)', paddingTop: 1,
                    }}>
                      {money(e.amountMinor, e.currency)}
                    </p>

                    {/* The thread runs through every dot and stops at the last,
                        so it reads as a sequence rather than a stray rule. */}
                    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                      {!last && (
                        <span aria-hidden style={{
                          position: 'absolute', top: 12, bottom: -6, width: 2,
                          background: 'var(--line-strong)', borderRadius: 2,
                        }} />
                      )}
                      <span aria-hidden style={{
                        position: 'relative', width: 10, height: 10, borderRadius: 999,
                        background: 'var(--positive)', marginTop: 4,
                        boxShadow: '0 0 0 3px var(--surface)',
                      }} />
                    </div>

                    <div style={{ paddingBottom: last ? 0 : 'var(--s4)' }}>
                      <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{e.label}</p>
                      <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 2 }}>
                        {new Date(e.occurredAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div style={{ borderTop: '1px solid var(--line)', marginTop: 'var(--s4)', paddingTop: 'var(--s3)' }}>
                <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600 }}>
                  {monthName(now)} so far{' '}
                  <strong className="num" style={{ color: 'var(--text-muted)' }}>
                    {money(income.monthTotalMinor, currency)}
                  </strong>
                  {monthlyIncomeMinor > 0 && (
                    <> · expected <span className="num">{money0(monthlyIncomeMinor, currency)}</span> each time you are paid</>
                  )}
                  {income.hiddenCount > 0 && <> · {income.hiddenCount} older not shown</>}
                </p>
              </div>
            </div>
          )}
      </Card>

      <GroupLabel>What you spend on</GroupLabel>
      {/* Open when there is little to show, folded when the list would push
          everything below it off the screen. */}
      <Section title="Day-to-day categories" count={flex.length} defaultOpen={flex.length <= 6}
               onAdd={onEditCategory && (() => onEditCategory(null))}>
        {flex.map((c, i) => {
          const spent = spentInCycle(transactions, c.local_id, budget.cycle);
          const pct = usagePct(spent, c.limit_minor);
          const over = spent > c.limit_minor && c.limit_minor > 0;
          return (
            <BudgetRow
              key={c.local_id}
              divider={i > 0}
              icon={<Icon name={c.icon} size={34} colour={c.colour} />}
              name={c.name}
              left={`${money(spent, currency)} of ${money0(c.limit_minor, currency)}`}
              right={over ? `${money(spent - c.limit_minor, currency)} over` : `${money0(Math.max(0, c.limit_minor - spent), currency)} left`}
              tone={over ? 'var(--danger)' : 'var(--text-dim)'}
              pct={pct}
              barColour={over ? 'var(--danger)' : chalk(c.colour)}
              onClick={onEditCategory && (() => onEditCategory(c))}
            />
          );
        })}
      </Section>

      <Section title="Fixed costs" count={fixed.length} defaultOpen={fixed.length <= 6}
               onAdd={onEditCategory && (() => onEditCategory(null))}>
        {fixed.map((c, i) => (
          <SettingRow
            key={c.local_id}
            divider={i > 0}
            icon={<Icon name={c.icon} size={34} colour={c.colour} />}
            name={c.name}
            sub={c.due_day ? `Due on the ${ordinal(c.due_day)}` : 'No due day set'}
            value={money0(c.limit_minor, currency)}
            onClick={onEditCategory && (() => onEditCategory(c))}
          />
        ))}
      </Section>

      <Section title="Banks & cards" count={liveBanks.length} defaultOpen={liveBanks.length <= 6}
               onAdd={onEditBank && (() => onEditBank(null))}>
        {liveBanks.map((b, i) => {
          const used = transactions.filter((t) => !t.deleted_at && t.bank_id === b.local_id).length;
          return (
            <SettingRow
              key={b.local_id}
              divider={i > 0}
              icon={<SettingIcon bg={chalk(b.colour)} path="M3 10.5h18M6 6h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />}
              name={b.name}
              sub={`${used} ${used === 1 ? 'transaction' : 'transactions'}`}
              onClick={onEditBank && (() => onEditBank(b))}
            />
          );
        })}
      </Section>

      <GroupLabel>Account</GroupLabel>
      {/*
        Always rendered.

        This card used to be behind `onSignOut || onDeleteAccount || identities.length`,
        so a build with no API base — or one bad identities fetch — silently
        removed the only route to sign out or delete an account, with nothing on
        screen to say why. A disabled row that explains itself beats a section
        that is simply not there.
      */}
      <Card>
        {identities.length > 0
          ? identities.map((i, n) => (
            <SettingRow
              key={`${i.provider}-${labelFor(i)}`}
              divider={n > 0}
              icon={<SettingGlyph bg="var(--surface-3)" text={(PROVIDER_NAME[i.provider] ?? '?').slice(0, 1)} />}
              name={labelFor(i)}
              sub={`Signed in with ${PROVIDER_NAME[i.provider] ?? i.provider}`}
            />
          ))
          : (
            <SettingRow
              icon={<SettingGlyph bg="var(--surface-3)" text="?" />}
              name="Account details unavailable"
              sub="Reconnect to see the email you signed in with"
            />
          )}

        {onSignOut && (
          <SettingRow
            divider
            icon={<SettingIcon bg="var(--surface-3)" path="M15 12H4m7-4-4 4 4 4M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4" />}
            name="Sign out"
            sub="Your data stays on this device"
            onClick={onSignOut}
          />
        )}

        {onDeleteAccount && (
          <>
            <div style={{ height: 1, background: 'var(--line)' }} />
            <button
              type="button"
              onClick={onDeleteAccount}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--s3)', width: '100%',
                textAlign: 'left', padding: 'var(--s3) 0', background: 'none', border: 0,
                cursor: 'pointer', color: 'inherit',
              }}
            >
              <SettingIcon bg="var(--danger-soft)" path="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" />
              <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--danger)' }}>
                  Delete account
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 3 }}>
                  Permanent, and cannot be undone
                </span>
              </span>
            </button>
          </>
        )}

        {!onSignOut && !onDeleteAccount && (
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, paddingTop: 'var(--s3)' }}>
            Signing out and deleting your account need a connection. Reopen the
            app once you are back online.
          </p>
        )}
      </Card>
    </>
  );
}

/** A card that opens on tap. Closed it costs one row; open it is a full list. */
function Section({ title, count, onAdd, children, defaultOpen = false }: {
  title: string; count: number; onAdd?: (() => void) | undefined;
  children: React.ReactNode; defaultOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
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
        {onAdd && <CardAction onClick={onAdd}><PlusGlyph />New</CardAction>}
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

/** The symbol Intl uses for this currency — £, $, €, JP¥ — never a hardcoded one. */
function currencySymbol(code: string): string {
  return formatMoney(0, code, 'en-GB').replace(/[\d.,\s]/g, '') || code;
}

/** A settings icon whose content is text rather than a path. */
function SettingGlyph({ bg, text }: { bg: string; text: string }): JSX.Element {
  return (
    <span aria-hidden style={{
      width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center',
      flexShrink: 0, color: 'var(--on-accent)', background: bg,
      fontSize: text.length > 1 ? 11 : 15, fontWeight: 800, letterSpacing: '-.02em',
    }}>{text}</span>
  );
}

function SettingIcon({ bg, path, circle }: { bg: string; path: string; circle?: boolean }): JSX.Element {
  return (
    <span aria-hidden style={{
      width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center',
      flexShrink: 0, color: 'var(--on-accent)', background: bg,
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
/** A quiet heading above a group of cards. Gives the screen a spine. */
function GroupLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2 style={{
      fontSize: 'var(--fs-2xs)', fontWeight: 800, letterSpacing: '.12em',
      textTransform: 'uppercase', color: 'var(--text-dim)',
      padding: 'var(--s4) var(--s2) 0',
    }}>{children}</h2>
  );
}

function BudgetRow({ icon, name, left, right, tone, pct, barColour, onClick, divider }: {
  icon: React.ReactNode; name: string; left: string; right: string; tone: string;
  pct: number; barColour: string; onClick?: (() => void) | undefined; divider?: boolean;
}): JSX.Element {
  const Tag = onClick ? 'button' : 'div';
  return (
    <>
      {divider && <div style={{ height: 1, background: 'var(--line)' }} />}
      <Tag
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        style={{
          display: 'block', width: '100%', textAlign: 'left', padding: 'var(--s3) 0',
          background: 'none', border: 0, color: 'inherit', cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          {icon}
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          {onClick && (
            <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden stroke="currentColor" strokeWidth={2.2}
                 fill="none" strokeLinecap="round" strokeLinejoin="round"
                 style={{ color: 'var(--text-dim)', flexShrink: 0 }}><path d="M9 5l7 7-7 7" /></svg>
          )}
        </span>
        <span style={{ display: 'block', marginTop: 8, paddingLeft: 42 }}>
          <Bar pct={pct} colour={barColour} />
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)', marginTop: 5 }}>
            <span className="num" style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-dim)' }}>{left}</span>
            <span className="num" style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: tone }}>{right}</span>
          </span>
        </span>
      </Tag>
    </>
  );
}

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
