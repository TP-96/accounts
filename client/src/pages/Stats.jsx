import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSession, useData } from '../lib/session.jsx';
import { money, shortDate, CATEGORY_LABELS } from '../lib/format.js';
import { MonthlyChart, HBarChart, monthLabel } from '../components/Charts.jsx';
import { Avatar, Loading } from '../components/ui.jsx';

const RANGES = [
  ['3', '3 months'],
  ['6', '6 months'],
  ['12', '1 year'],
  ['all', 'All time'],
];

const thisYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** "$40.00 more than September" / "Same as September" / null when there's nothing to compare. */
function versus(now, before, label) {
  if (before == null) return null;
  const d = now - before;
  if (d === 0) return `Same as ${label}`;
  return `${money(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than ${label}`;
}

export default function Stats() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'month' ? 'month' : 'overview';
  const go = (next) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Stats</h1>
          <p className="muted">Where the house's money goes, and your part of it.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Stats view">
        <button role="tab" aria-selected={tab === 'overview'} onClick={() => go({ tab: null, month: null })}>
          Overview
        </button>
        <button role="tab" aria-selected={tab === 'month'} onClick={() => go({ tab: 'month' })}>
          Month
        </button>
      </div>
      {tab === 'overview' ? <Overview openMonth={(ym) => go({ tab: 'month', month: ym })} /> : <MonthView ym={params.get('month') || thisYm()} setMonth={(ym) => go({ month: ym })} />}
    </>
  );
}

/* ---------------- Overview: spending over time ---------------- */

function Overview({ openMonth }) {
  const [range, setRange] = useState(() => {
    try {
      return localStorage.getItem('hearth-stats-range') || '6';
    } catch {
      return '6';
    }
  });
  const [asTable, setAsTable] = useState(false);
  const { data } = useData(`/stats?range=${range}`);
  const { user, memberById } = useSession();

  const pick = (r) => {
    setRange(r);
    try {
      localStorage.setItem('hearth-stats-range', r);
    } catch {
      /* storage blocked */
    }
  };

  const s = data?.summary;
  const many = data && data.months.length > 1;
  const span = data ? (data.months.length === 1 ? 'this month' : `over ${data.months.length} months`) : '';

  return (
    <>
      <div className="segmented range-picker" role="group" aria-label="Time range" style={{ margin: '4px 0 18px' }}>
        {RANGES.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={range === k} onClick={() => pick(k)}>
            {label}
          </button>
        ))}
      </div>

      {!data ? (
        <Loading />
      ) : s.houseCents === 0 ? (
        <div className="empty">
          <h3>Nothing to chart yet</h3>
          <p>Once bills are added, you'll see where the money goes here.</p>
        </div>
      ) : (
        <>
          <section className="section" style={{ paddingTop: 8 }}>
            <div className="figures figures-3">
              <div className="figure">
                <span className="figure-label">Your share</span>
                <span className="figure-value">{money(s.myShareCents)}</span>
                <span className="figure-sub">{span}</span>
              </div>
              <div className="figure">
                <span className="figure-label">{many ? 'Your average a month' : 'The house spent'}</span>
                <span className="figure-value">{many ? money(s.avgMyShareCents) : money(s.houseCents)}</span>
                <span className="figure-sub">
                  {many ? `This month so far: ${money(s.thisMonthMyShareCents)}` : `Your part is ${money(s.myShareCents)}`}
                </span>
              </div>
              <div className="figure">
                <span className="figure-label">{many ? 'The house spent' : 'Repeating bills'}</span>
                <span className="figure-value">{many ? money(s.houseCents) : money(s.recurringMonthlyCents)}</span>
                <span className="figure-sub">{many ? `About ${money(s.avgHouseCents)} a month` : 'a month, for the house'}</span>
              </div>
            </div>
            {s.recurringMonthlyCents > 0 && many && (
              <p className="faint" style={{ marginTop: 14 }}>
                Repeating bills (rent, internet and so on) come to {money(s.recurringMonthlyCents)} a month for the house, {money(s.recurringMyMonthlyCents)} of it yours.
              </p>
            )}
          </section>

          <section className="section">
            <div className="section-head">
              <h2>By month</h2>
              {many && (
                <button className="btn-link" onClick={() => setAsTable((v) => !v)}>
                  {asTable ? 'Show as chart' : 'Show as table'}
                </button>
              )}
            </div>
            {!many ? (
              <p className="muted" style={{ maxWidth: '58ch' }}>
                There's only one month of bills so far. The monthly chart appears once there's a second month, and you can open this month in detail on the Month tab.{' '}
                <button className="btn-link" onClick={() => openMonth(data.months[0].month)}>
                  See {monthLabel(data.months[0].month, true)}
                </button>
              </p>
            ) : asTable ? (
              <div className="table-wrap">
                <table className="ledger compact-sm">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="r">Your share</th>
                      <th className="r">House total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map((m) => (
                      <tr key={m.month}>
                        <td>
                          <button className="btn-link" onClick={() => openMonth(m.month)}>
                            {monthLabel(m.month, true)}
                          </button>
                        </td>
                        <td className="r">{money(m.myShareCents)}</td>
                        <td className="r">{money(m.houseCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <div className="legend">
                  <span>
                    <i className="key key-mine" /> Your share
                  </span>
                  <span>
                    <i className="key key-others" /> Everyone else's
                  </span>
                </div>
                <MonthlyChart months={data.months} onPick={openMonth} />
                <p className="faint" style={{ marginTop: 6 }}>Tap a month to see it in detail.</p>
              </>
            )}
          </section>

          <div className="two-col section">
            <div>
              <div className="section-head">
                <h2>Where the money goes</h2>
              </div>
              <HBarChart
                rows={data.byCategory.map((c) => ({
                  key: c.category,
                  label: CATEGORY_LABELS[c.category] || c.category,
                  sub: `yours ${money(c.myShareCents)}`,
                  value: c.totalCents,
                }))}
              />
            </div>
            <aside className="aside">
              <div className="section-head">
                <h2>Biggest bills</h2>
              </div>
              <ul className="rows">
                {data.biggest.map((b) => (
                  <li key={b.id}>
                    <Link to={`/bills/${b.id}`} className="row no-date">
                      <span className="row-main">
                        <span className="row-title">{b.title}</span>
                        <span className="row-meta">
                          {shortDate(b.date)}, paid by {b.paidBy === user.id ? 'you' : memberById(b.paidBy)?.name || 'a former roommate'}
                        </span>
                      </span>
                      <span className="row-amt">{money(b.amountCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          </div>

          <PeopleTable title="Who pays up front" people={data.byPerson} note="A plus means they've been covering for the house; a minus means others have been covering for them, before any paying back." />
        </>
      )}
    </>
  );
}

function PeopleTable({ title, people, note }) {
  const { user } = useSession();
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      {note && (
        <p className="faint" style={{ marginBottom: 12, maxWidth: '64ch' }}>
          {note}
        </p>
      )}
      <div className="table-wrap">
        <table className="ledger compact-sm">
          <thead>
            <tr>
              <th>Roommate</th>
              <th className="r">Paid</th>
              <th className="r">Their share</th>
              <th className="r">Difference</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const diff = p.paidCents - p.shareCents;
              return (
                <tr key={p.user.id}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <Avatar user={p.user} size="sm" />
                      {p.user.id === user.id ? `${p.user.name} (you)` : p.user.name}
                      {!p.current && <span className="faint">moved out</span>}
                    </span>
                  </td>
                  <td className="r">{money(p.paidCents)}</td>
                  <td className="r">{money(p.shareCents)}</td>
                  <td className={`r ${diff > 0 ? 'owed' : diff < 0 ? 'owe' : 'muted'}`}>{diff === 0 ? '—' : money(diff, { signed: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Month: one month in detail ---------------- */

function MonthView({ ym, setMonth }) {
  const { user, memberById } = useSession();
  const { data } = useData(`/stats/month?month=${ym}`);
  const longName = (m) => monthLabel(m, true);

  return (
    <>
      <div className="month-nav">
        <button className="btn icon-btn" disabled={!data?.prevMonth} onClick={() => setMonth(data.prevMonth)} aria-label="Previous month">
          <ChevronLeft size={20} />
        </button>
        <label className="month-pick">
          <span className="sr-only">Choose a month</span>
          <select className="select" value={ym} onChange={(e) => setMonth(e.target.value)}>
            {[...new Set([...(data?.availableMonths || [ym]), ym])].sort().reverse().map((m) => (
              <option key={m} value={m}>
                {longName(m)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn icon-btn" disabled={!data?.nextMonth} onClick={() => setMonth(data.nextMonth)} aria-label="Next month">
          <ChevronRight size={20} />
        </button>
      </div>

      {!data ? (
        <Loading />
      ) : data.summary.billCount === 0 ? (
        <div className="empty">
          <h3>No bills in {longName(ym)}</h3>
          <p>{data.nextMonth || data.prevMonth ? 'Use the arrows to look at another month.' : 'Add a bill and it shows up here.'}</p>
        </div>
      ) : (
        <>
          <section className="section" style={{ paddingTop: 8 }}>
            <div className="figures figures-3">
              <div className="figure">
                <span className="figure-label">The house spent</span>
                <span className="figure-value">{money(data.summary.houseCents)}</span>
                <span className="figure-sub">
                  {versus(data.summary.houseCents, data.previous?.houseCents, longName(data.previous?.month || ym).split(' ')[0]) || `${data.summary.billCount} ${data.summary.billCount === 1 ? 'bill' : 'bills'}`}
                </span>
              </div>
              <div className="figure">
                <span className="figure-label">Your share</span>
                <span className="figure-value">{money(data.summary.myShareCents)}</span>
                <span className="figure-sub">
                  {versus(data.summary.myShareCents, data.previous?.myShareCents, longName(data.previous?.month || ym).split(' ')[0]) || 'Your part of the bills'}
                </span>
              </div>
              <div className="figure">
                <span className="figure-label">You paid up front</span>
                <span className="figure-value">{money(data.summary.iPaidCents)}</span>
                <span className="figure-sub">
                  {data.summary.billCount} {data.summary.billCount === 1 ? 'bill' : 'bills'} this month
                </span>
              </div>
            </div>
          </section>

          <div className="two-col section">
            <div>
              <div className="section-head">
                <h2>Where it went</h2>
              </div>
              <HBarChart
                rows={data.byCategory.map((c) => ({
                  key: c.category,
                  label: CATEGORY_LABELS[c.category] || c.category,
                  sub: `yours ${money(c.myShareCents)}, ${c.bills} ${c.bills === 1 ? 'bill' : 'bills'}`,
                  value: c.totalCents,
                }))}
              />
            </div>
            <aside className="aside">
              <div className="section-head">
                <h2>Bills in {monthLabel(ym, true).split(' ')[0]}</h2>
              </div>
              <ul className="rows">
                {data.bills.map((b) => (
                  <li key={b.id}>
                    <Link to={`/bills/${b.id}`} className="row">
                      <span className="row-date">{shortDate(b.date)}</span>
                      <span className="row-main">
                        <span className="row-title">{b.title}</span>
                        <span className="row-meta">
                          {CATEGORY_LABELS[b.category] || b.category} · paid by {b.paidBy === user.id ? 'you' : memberById(b.paidBy)?.name || 'a former roommate'}
                        </span>
                      </span>
                      <span className="row-amt">
                        {money(b.amountCents)}
                        <small>{b.myShareCents ? `yours ${money(b.myShareCents)}` : 'not on it'}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          </div>

          <PeopleTable title={`Who paid in ${monthLabel(ym, true).split(' ')[0]}`} people={data.byPerson} />
        </>
      )}
    </>
  );
}
