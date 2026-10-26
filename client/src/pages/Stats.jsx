import { useState } from 'react';
import { Link } from 'react-router-dom';
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

export default function Stats() {
  const { user, memberById } = useSession();
  const [range, setRange] = useState(() => {
    try {
      return localStorage.getItem('hearth-stats-range') || '6';
    } catch {
      return '6';
    }
  });
  const [asTable, setAsTable] = useState(false);
  const { data } = useData(`/stats?range=${range}`);

  const pick = (r) => {
    setRange(r);
    try {
      localStorage.setItem('hearth-stats-range', r);
    } catch {
      /* storage blocked */
    }
  };

  const s = data?.summary;
  const delta = s ? s.thisMonthMyShareCents - s.lastMonthMyShareCents : 0;
  const periodLabel = range === 'all' ? 'since you started' : `in the last ${range} months`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Stats</h1>
          <p className="muted">Where the house's money goes, and your part of it.</p>
        </div>
        <div className="segmented range-picker" role="group" aria-label="Time range">
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={range === k} onClick={() => pick(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <Loading />
      ) : s.houseCents === 0 ? (
        <div className="empty">
          <h3>Nothing to chart yet</h3>
          <p>Once bills are added, you'll see spending by month and by category here.</p>
        </div>
      ) : (
        <>
          <section className="section">
            <div className="figures">
              <div className="figure">
                <span className="figure-label">Your share this month</span>
                <span className="figure-value">{money(s.thisMonthMyShareCents)}</span>
                <span className="figure-sub">
                  {s.lastMonthMyShareCents === 0 && s.thisMonthMyShareCents === 0
                    ? 'Nothing yet this month'
                    : delta === 0
                      ? 'Same as last month'
                      : `${money(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than last month`}
                </span>
              </div>
              <div className="figure">
                <span className="figure-label">Your average per month</span>
                <span className="figure-value">{money(s.avgMyShareCents)}</span>
                <span className="figure-sub">{money(s.myShareCents)} {periodLabel}</span>
              </div>
              <div className="figure">
                <span className="figure-label">House spent {periodLabel}</span>
                <span className="figure-value">{money(s.houseCents)}</span>
                <span className="figure-sub">About {money(s.avgHouseCents)} a month</span>
              </div>
              <div className="figure">
                <span className="figure-label">Your repeating bills</span>
                <span className="figure-value">{money(s.recurringMyMonthlyCents)}</span>
                <span className="figure-sub">
                  a month, of {money(s.recurringMonthlyCents)} for the house
                </span>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Spending by month</h2>
              <button className="btn-link" onClick={() => setAsTable((v) => !v)}>
                {asTable ? 'Show as chart' : 'Show as table'}
              </button>
            </div>
            <div className="legend" aria-hidden={asTable}>
              <span>
                <i className="key key-mine" /> Your share
              </span>
              <span>
                <i className="key key-others" /> Everyone else's
              </span>
            </div>
            {asTable ? (
              <div className="table-wrap">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="r">Your share</th>
                      <th className="r">Everyone else</th>
                      <th className="r">House total</th>
                      <th className="r">You paid up front</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map((m) => (
                      <tr key={m.month}>
                        <td>{monthLabel(m.month, true)}</td>
                        <td className="r">{money(m.myShareCents)}</td>
                        <td className="r">{money(m.houseCents - m.myShareCents)}</td>
                        <td className="r">{money(m.houseCents)}</td>
                        <td className="r">{money(m.iPaidCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <MonthlyChart months={data.months} />
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
                  sub: `yours ${money(c.myShareCents)}, ${c.bills} ${c.bills === 1 ? 'bill' : 'bills'}`,
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

          <section className="section">
            <div className="section-head">
              <h2>Who's been paying up front</h2>
            </div>
            <p className="faint" style={{ marginBottom: 12, maxWidth: '64ch' }}>
              "Paid for" is what each person put on their own card. "Their share" is what their part of those bills came to. A plus means they've
              been covering for the house; a minus means others have been covering for them (before any paying back).
            </p>
            <div className="table-wrap">
              <table className="ledger compact-sm">
                <thead>
                  <tr>
                    <th>Roommate</th>
                    <th className="r">Paid for</th>
                    <th className="r">Their share</th>
                    <th className="r">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPerson.map((p) => {
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
        </>
      )}
    </>
  );
}
