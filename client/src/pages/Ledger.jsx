import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useSession, useData } from '../lib/session.jsx';
import { downloadExport } from '../lib/api.js';
import { money, shortDate } from '../lib/format.js';
import MoneyTabs from '../components/MoneyTabs.jsx';
import { Avatar, Loading } from '../components/ui.jsx';

export default function Ledger() {
  const { user, household, memberById, toast } = useSession();
  const [params, setParams] = useSearchParams();
  const as = Number(params.get('as')) || user.id;
  const withId = Number(params.get('with')) || null;
  const viewer = memberById(as);
  const others = household.members.filter((m) => m.id !== as);

  const { data } = useData(`/ledger?as=${as}${withId ? `&with=${withId}` : ''}`);
  // Balances for the pair tabs, computed from the viewer's full ledger.
  const { data: all } = useData(`/ledger?as=${as}`);

  const pairTotals = new Map();
  for (const r of all?.rows || []) pairTotals.set(r.counterpart.id, (pairTotals.get(r.counterpart.id) || 0) + r.effectCents);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  const you = as === user.id;
  const rows = data?.rows || [];
  const final = rows.at(-1)?.runningCents || 0;
  const counterpart = withId ? memberById(withId) : null;
  const runningLabel = counterpart ? `${counterpart.name} owes ${you ? 'you' : viewer.name}` : 'Running net';

  return (
    <>
      <MoneyTabs />
      <div className="page-head">
        <div>
          <h1>Ledger</h1>
          <p className="muted">Every bill and payment, as it affects one person's balance.</p>
        </div>
        <button className="btn" onClick={() => downloadExport().catch((e) => toast(e.message))}>
          <Download size={18} /> Export to Excel
        </button>
      </div>

      <section>
        <div className="toolbar" style={{ alignItems: 'center' }}>
          <label htmlFor="viewas" className="muted" style={{ fontWeight: 600 }}>
            Viewing as
          </label>
          <select id="viewas" className="select" style={{ width: 'auto' }} value={as} onChange={(e) => set({ as: e.target.value, with: '' })}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === user.id ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="pair-tabs" role="group" aria-label="Filter by roommate">
          <button className="pair-tab" aria-pressed={!withId} onClick={() => set({ with: '' })}>
            Everyone
          </button>
          {others.map((m) => {
            const t = pairTotals.get(m.id) || 0;
            return (
              <button key={m.id} className="pair-tab" aria-pressed={withId === m.id} onClick={() => set({ with: m.id })}>
                <Avatar user={m} size="sm" />
                {m.name}
                <span className={`sub ${t > 0 ? 'owed' : t < 0 ? 'owe' : 'faint'}`}>{t === 0 ? 'square' : money(t, { signed: true })}</span>
              </button>
            );
          })}
        </div>

        {!data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div className="empty">
            <h3>Nothing here yet</h3>
            <p>Bills and payments between {counterpart ? `${you ? 'you' : viewer.name} and ${counterpart.name}` : 'roommates'} will show up here.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  {!withId && <th className="col-with">With</th>}
                  <th className="r">Effect</th>
                  <th className="r col-run">{runningLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.refId}-${r.counterpart.id}`}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {shortDate(r.date)}
                    </td>
                    <td>
                      <span className="kind">{r.kind === 'bill' ? 'Bill' : 'Payment'}</span>
                      {r.kind === 'bill' ? <Link to={`/bills/${r.refId}`}>{r.title}</Link> : <span>{r.title}</span>}
                      <div className="faint">{you ? r.detail : r.detail.replace(/\byou\b/gi, viewer.name).replace(/\bYour\b/, `${viewer.name}'s`)}</div>
                    </td>
                    {!withId && <td className="col-with">{r.counterpart.name}</td>}
                    <td className={`r ${r.effectCents > 0 ? 'owed' : 'owe'}`}>
                      {money(r.effectCents, { signed: true })}
                      <div className="faint show-sm run-sm">Balance {money(r.runningCents, { signed: true })}</div>
                    </td>
                    <td className="r col-run">{money(r.runningCents, { signed: true })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="foot-label">
                    {final === 0
                      ? 'All square'
                      : counterpart
                        ? final > 0
                          ? `${counterpart.name} owes ${you ? 'you' : viewer.name} ${money(final)}`
                          : `${you ? 'You owe' : `${viewer.name} owes`} ${counterpart.name} ${money(final)}`
                        : final > 0
                          ? `The house owes ${you ? 'you' : viewer.name} ${money(final)}`
                          : `${you ? 'You owe' : `${viewer.name} owes`} the house ${money(final)}`}
                  </td>
                  {!withId && <td className="col-with" />}
                  <td className={`r ${final > 0 ? 'owed' : final < 0 ? 'owe' : ''}`}>
                    <span className="show-sm-inline">{money(final, { signed: true })}</span>
                  </td>
                  <td className={`r col-run ${final > 0 ? 'owed' : final < 0 ? 'owe' : ''}`}>
                    <span>{money(final, { signed: true })}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="faint" style={{ marginTop: 16 }}>
          Positive means money is coming to {you ? 'you' : viewer.name}; negative means {you ? 'you owe' : `${viewer.name} owes`} it.
        </p>
      </section>
    </>
  );
}
