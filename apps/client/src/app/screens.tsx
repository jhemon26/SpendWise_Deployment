import { formatMoney, type Category, type Transaction } from '@spendwise/shared-types';
import { Bar, Card, CardHead, Chip, Empty, Gauge, Icon } from '../design-system/components.js';
import {
  categoryBreakdown, derive, groupByDay, statusOf, STATUS_COLOUR, type Derived,
} from '../features/insights/selectors.js';

export interface ScreenData {
  transactions: Transaction[];
  categories: Category[];
  d: Derived;
  currency: string;
  now: Date;
  displayName: string;
  dayToDayMinor: number;
  /** Tap a transaction row to edit it. Absent in read-only contexts. */
  onEdit?: ((t: Transaction) => void) | undefined;
  /** Absent when running purely locally — there is no session to end. */
  onSignOut?: (() => void) | undefined;
}

const money = (minor: number, cur: string): string => formatMoney(minor, cur);
const catOf = (cats: Category[], id: string | null): Category | undefined =>
  id ? cats.find((c) => c.local_id === id) : undefined;

/* ── Home ─────────────────────────────────────────────────────────────── */

export function Home({ transactions, categories, d, currency, dayToDayMinor, onEdit }: ScreenData): JSX.Element {
  const st = statusOf(d.spentPct);
  const over = d.deltaMinor > 0;
  const recent = transactions.filter((t) => !t.deleted_at)
    .slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 3);

  return (
    <>
      <div style={{
        position: 'relative', overflow: 'hidden', background: 'var(--hero-bg)',
        border: '1px solid var(--line-brand)', borderRadius: 'var(--r-xl)',
        padding: 'var(--s5)', boxShadow: '0 16px 36px -14px rgba(0,0,0,.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s4)' }}>
          <p style={{
            fontSize: 'var(--fs-2xs)', fontWeight: 800, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--brand-cyan)',
          }}>Safe to spend</p>
          <Chip tone={over ? 'warn' : 'ok'}>{over ? 'Spending fast' : 'On track'}</Chip>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s4)' }}>
          <div style={{ minWidth: 0 }}>
            <p className="num" data-testid="safe-to-spend" data-tour="safe-to-spend" style={{
              fontSize: 'var(--fs-hero)', fontWeight: 800, letterSpacing: '-.035em',
              lineHeight: 1.05, color: d.leftMinor < 0 ? 'var(--danger)' : undefined,
            }}>
              {d.leftMinor < 0 ? '−' : ''}{money(d.leftMinor, currency)}
            </p>
            <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)', marginTop: 'var(--s2)' }}>
              <strong className="num" style={{ color: 'var(--text)' }}>{money(d.perDayMinor, currency)}</strong>
              {' '}a day for {d.daysLeft} {d.daysLeft === 1 ? 'day' : 'days'}
            </p>
          </div>
          <Gauge pct={d.spentPct} datePct={d.datePct} colour={STATUS_COLOUR[st]} tourId="gauge" />
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--s2)',
          marginTop: 'var(--s5)', paddingTop: 'var(--s4)', borderTop: '1px solid rgba(255,255,255,.07)',
        }}>
          {([['Budget', money(dayToDayMinor, currency)],
             ['Spent', money(d.flexSpentMinor, currency)],
             ['Days left', String(d.daysLeft)]] as const).map(([k, v]) => (
            <div key={k} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>{k}</p>
              <p className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, marginTop: 4 }}>{v}</p>
            </div>
          ))}
        </div>

        <p style={{ marginTop: 'var(--s4)', fontSize: 'var(--fs-xs)', fontWeight: 700 }}>
          <span style={{ color: over ? 'var(--warning)' : 'var(--positive)' }}>
            {money(Math.abs(d.deltaMinor), currency)} {over ? 'over' : 'under'} pace
          </span>
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--s2)' }}>
        <Tile label="Today" value={money(d.todaySpentMinor, currency)}
              foot={`${money(Math.abs(d.todaySpentMinor - d.evenPaceMinor), currency)} ${d.todaySpentMinor > d.evenPaceMinor ? 'over' : 'under'}`} />
        <Tile label="This month" value={money(d.monthTotalMinor, currency)} foot={`of ${money(dayToDayMinor + d.fixedSpentMinor, currency)}`} />
        <Tile label="To save" value={`${d.projectedSavingsMinor < 0 ? '−' : ''}${money(d.projectedSavingsMinor, currency)}`}
              foot={d.projectedSavingsMinor >= 0 ? 'on track' : 'over budget'}
              tone={d.projectedSavingsMinor >= 0 ? 'var(--positive)' : 'var(--danger)'} />
      </div>

      <Card>
        <CardHead title="Recent activity" />
        {recent.length === 0
          ? <Empty icon="other" title="No activity yet" body="Tap + to record your first transaction." />
          : recent.map((t) => <Row key={t.local_id} t={t} cats={categories} onEdit={onEdit} />)}
      </Card>
    </>
  );
}

function Tile({ label, value, foot, tone }: { label: string; value: string; foot: string; tone?: string }): JSX.Element {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: 'var(--s3) var(--s3) var(--s4)' }}>
      <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{label}</p>
      <p className="num" style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, letterSpacing: '-.03em', marginTop: 6, color: tone }}>{value}</p>
      <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-dim)', marginTop: 3 }}>{foot}</p>
    </div>
  );
}

/**
 * A transaction renders in the currency it was SPENT in, not the reporting
 * currency — showing a €14 lunch as "£11.90" hides what the user actually paid.
 * The base-currency value is what feeds the budget totals (see selectors).
 */
function Row({ t, cats, onEdit }: { t: Transaction; cats: Category[]; onEdit?: ((t: Transaction) => void) | undefined }): JSX.Element {
  const c = catOf(cats, t.category_id);
  const Tag = onEdit ? 'button' : 'div';
  return (
    <Tag
      {...(onEdit ? { onClick: () => onEdit(t), type: 'button' as const } : {})}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3) 0',
        width: '100%', textAlign: 'left', background: 'none', border: 0,
        color: 'inherit', font: 'inherit', cursor: onEdit ? 'pointer' : 'default',
      }}>
      <Icon name={t.is_income ? 'income' : (c?.icon ?? 'other')} colour={t.is_income ? '#10B981' : (c?.colour ?? '#64748B')} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.merchant ?? c?.name ?? 'Transaction'}
        </p>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginTop: 3 }}>
          {t.is_income ? 'Income' : (c?.name ?? 'Uncategorised')}
          {t.sync_status !== 'synced' && ' · pending sync'}
        </p>
      </div>
      <p className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 800, color: t.is_income ? 'var(--positive)' : undefined }}>
        {t.is_income ? '+' : '−'}{money(t.amount_minor, t.currency)}
      </p>
    </Tag>
  );
}

/* ── Activity ─────────────────────────────────────────────────────────── */

export function Activity({ transactions, categories, currency, now, onEdit }: ScreenData): JSX.Element {
  const groups = groupByDay(transactions, now);
  if (groups.length === 0) {
    return <Card><Empty icon="other" title="Nothing here yet" body="No transactions recorded this month." /></Card>;
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: 'var(--s4) 0 var(--s2)' }}>
            <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{g.label}</span>
            <span className="num" style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: g.netMinor > 0 ? 'var(--positive)' : 'var(--text-dim)' }}>
              {g.netMinor > 0 ? '+' : '−'}{money(g.netMinor, currency)}
            </span>
          </div>
          <Card style={{ padding: 'var(--s1) var(--s4)' }}>
            {g.items.map((t) => <Row key={t.local_id} t={t} cats={categories} onEdit={onEdit} />)}
          </Card>
        </div>
      ))}
    </>
  );
}

/* ── Budgets ──────────────────────────────────────────────────────────── */

export function Budgets({ categories, d, currency, dayToDayMinor }: ScreenData): JSX.Element {
  const flex = categories.filter((c) => !c.is_fixed && !c.deleted_at);
  const total = statusOf(d.spentPct);
  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--s3)' }}>
          <div>
            <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Day-to-day</p>
            <p className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, marginTop: 6, color: d.leftMinor < 0 ? 'var(--danger)' : undefined }}>
              {money(Math.abs(d.leftMinor), currency)} {d.leftMinor < 0 ? 'over' : 'left'}
            </p>
          </div>
          <Chip tone="neutral">{d.dayOfMonth} of {d.daysInMonth} days</Chip>
        </div>
        <Bar pct={d.spentPct} colour={STATUS_COLOUR[total]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--s2)', fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)' }}>
          <span className="num">{money(d.flexSpentMinor, currency)} spent</span>
          <span className="num">{money(dayToDayMinor, currency)} budget</span>
        </div>
      </Card>

      <Card>
        <CardHead title="Categories" />
        {flex.length === 0
          ? <Empty icon="other" title="No categories yet" body="Add one to start tracking day-to-day spending." />
          : flex.map((c) => {
              const spent = d.byCategory.get(c.local_id) ?? 0;
              const pct = c.limit_minor > 0 ? (spent / c.limit_minor) * 100 : 0;
              const st = statusOf(pct);
              const remaining = c.limit_minor - spent;
              return (
                <div key={c.local_id} style={{ padding: 'var(--s4) 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                    <Icon name={c.icon} size={30} colour={c.colour} />
                    <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{c.name}</span>
                    <span className="num" style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-dim)' }}>
                      <strong style={{ color: 'var(--text)' }}>{money(spent, currency)}</strong> of {money(c.limit_minor, currency)}
                    </span>
                  </div>
                  <Bar pct={pct} colour={STATUS_COLOUR[st]} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--s2)', fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
                    <span className="num" style={{ color: st === 'ok' ? 'var(--text-dim)' : STATUS_COLOUR[st] }}>
                      {money(Math.abs(remaining), currency)} {remaining >= 0 ? 'left' : 'over'}
                    </span>
                    <span className="num" style={{ color: 'var(--text-dim)' }}>{Math.round(pct)}%</span>
                  </div>
                </div>
              );
            })}
      </Card>
    </>
  );
}

/* ── Insights ─────────────────────────────────────────────────────────── */

export function Insights({ categories, d, currency }: ScreenData): JSX.Element {
  const rows = categoryBreakdown(d, categories);
  const stops = rows.length
    ? rows.reduce<{ acc: number; parts: string[] }>((s, r) => {
        const from = s.acc;
        const to = s.acc + r.pct;
        s.parts.push(`${r.category.colour} ${from}% ${to}%`);
        return { acc: to, parts: s.parts };
      }, { acc: 0, parts: [] }).parts.join(',')
    : '';

  return (
    <>
      <Card>
        <CardHead title={`Where the money went`} />
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
                  <p className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 800 }}>{money(d.monthTotalMinor, currency)}</p>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Total</p>
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
          ['Biggest single spend', d.biggest ? (d.biggest.merchant ?? 'Uncategorised') : 'Nothing yet', d.biggest ? money(d.biggest.amount_minor, currency) : '—'],
          ['Spend-free days', 'So far this month', String(d.spendFreeDays)],
          ['Fixed vs flexible', 'Share of the month locked in', `${Math.round(d.fixedSharePct)}%`],
        ] as const).map(([k, sub, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', padding: 'var(--s3) 0', borderTop: '1px solid var(--line)' }}>
            <div>
              <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{k}</p>
              <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 2 }}>{sub}</p>
            </div>
            <p className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 800 }}>{v}</p>
          </div>
        ))}
      </Card>
    </>
  );
}

/* ── Profile ──────────────────────────────────────────────────────────── */

export function Profile({ categories, currency, displayName, dayToDayMinor, d, onSignOut }: ScreenData): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', padding: 'var(--s2) 0 var(--s5)' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 'var(--r-pill)', padding: 2.5, flexShrink: 0,
          background: 'linear-gradient(135deg,var(--brand-cyan),var(--brand),var(--brand-purple))',
        }}>
          <span style={{
            width: '100%', height: '100%', borderRadius: 'var(--r-pill)', background: 'var(--surface)',
            display: 'grid', placeItems: 'center', fontSize: 'var(--fs-xl)', fontWeight: 800,
          }}>{displayName.slice(0, 1).toUpperCase()}</span>
        </div>
        <div>
          <p style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-.03em' }}>{displayName}</p>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 3 }}>
            {money(dayToDayMinor, currency)} day-to-day
          </p>
        </div>
      </div>

      <Card>
        <CardHead title="Categories" />
        {categories.filter((c) => !c.deleted_at).map((c) => (
          <div key={c.local_id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3) 0', borderTop: '1px solid var(--line)' }}>
            <Icon name={c.icon} size={30} colour={c.colour} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{c.name}</p>
              <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 3 }}>
                {c.is_fixed ? 'Fixed cost' : 'Day-to-day'} · {money(d.byCategory.get(c.local_id) ?? 0, currency)} used
              </p>
            </div>
            <span className="num" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)' }}>
              {money(c.limit_minor, currency)}
            </span>
          </div>
        ))}
      </Card>

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
    </>
  );
}

export { derive };
