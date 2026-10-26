import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Repeat } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession, useData } from '../lib/session.jsx';
import { money, shortDate, CATEGORY_LABELS } from '../lib/format.js';
import { useActions } from '../components/Layout.jsx';
import { CategoryTag, Loading } from '../components/ui.jsx';

export default function Bills() {
  const { user, memberById, toast, bump } = useSession();
  const actions = useActions();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [mine, setMine] = useState(false);
  const qs = new URLSearchParams({ search, category, mine: mine ? '1' : '' }).toString();
  const { data } = useData(`/bills?${qs}`);
  const { data: rec } = useData('/recurring');

  const grouped = useMemo(() => {
    const g = new Map();
    for (const b of data?.bills || []) {
      const key = b.date.slice(0, 7);
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(b);
    }
    return [...g.entries()];
  }, [data]);

  const monthName = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  };
  const monthTotal = (bills) => bills.reduce((s, b) => s + b.amountCents, 0);

  const stopRecurring = async (r) => {
    await api.del(`/recurring/${r.id}`);
    toast(`"${r.template.title}" will no longer repeat`);
    bump();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bills</h1>
          <p className="muted">Everything the house has split, newest first.</p>
        </div>
        <button className="btn btn-primary" onClick={actions.addBill}>
          <Plus size={18} /> Add a bill
        </button>
      </div>

      {rec?.recurring.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Repeating bills</h2>
          </div>
          <ul className="rows">
            {rec.recurring.map((r) => (
              <li key={r.id} className="row">
                <span className="row-date">
                  <Repeat size={15} aria-label="Repeats" />
                </span>
                <span className="row-main">
                  <span className="row-title">{r.template.title}</span>
                  <span className="row-meta">
                    {r.frequency === 'monthly' ? 'Every month' : 'Every week'}, next on {shortDate(r.nextDate)}
                  </span>
                </span>
                <span className="row-end">
                  <span className="row-amt">{money(r.template.amountCents)}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => stopRecurring(r)}>
                    Stop
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <div className="toolbar">
          <input className="input grow" type="search" placeholder="Search bills" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bills" />
          <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Show">
            <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
              Everyone's
            </button>
            <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
              Just mine
            </button>
          </div>
        </div>

        {!data ? (
          <Loading />
        ) : data.bills.length === 0 ? (
          <div className="empty">
            <h3>{search || category ? 'No bills match' : 'No bills yet'}</h3>
            <p>{search || category ? 'Try a different search or category.' : 'Add your first shared expense to get started.'}</p>
          </div>
        ) : (
          grouped.map(([ym, bills]) => (
            <div key={ym}>
              <div className="month-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{monthName(ym)}</span>
                <span className="muted" style={{ fontWeight: 600 }}>
                  {money(monthTotal(bills))}
                </span>
              </div>
              <ul className="rows">
                {bills.map((b) => {
                  const myShare = b.shares.find((s) => s.userId === user.id)?.shareCents;
                  const payer = memberById(b.paidBy);
                  return (
                    <li key={b.id}>
                      <Link to={`/bills/${b.id}`} className="row">
                        <span className="row-date">{shortDate(b.date)}</span>
                        <span className="row-main">
                          <span className="row-title">
                            {b.title}
                            {b.recurringId && <Repeat size={13} style={{ marginLeft: 6, verticalAlign: '-1px', color: 'var(--ink-3)' }} aria-label="repeating" />}
                            <CategoryTag category={b.category} />
                          </span>
                          <span className="row-meta">
                            {b.paidBy === user.id ? 'You paid' : `${payer?.name || 'Someone'} paid`}, split between {b.shares.length}
                          </span>
                        </span>
                        <span className="row-amt">
                          {money(b.amountCents)}
                          <small>{myShare != null ? `yours ${money(myShare)}` : 'not on it'}</small>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
