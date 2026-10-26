import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession, useData } from '../lib/session.jsx';
import { money, shortDate, METHOD_LABELS } from '../lib/format.js';
import { useActions } from '../components/Layout.jsx';
import { Avatar, Loading } from '../components/ui.jsx';

export default function Settle() {
  const { user, memberById, toast, bump } = useSession();
  const actions = useActions();
  const { data: bal } = useData('/balances');
  const { data: pay } = useData('/payments');

  if (!bal) return <Loading />;
  const name = (id) => (id === user.id ? 'You' : memberById(id)?.name || 'A former roommate');

  const remove = async (p) => {
    if (!window.confirm(`Remove the ${money(p.amountCents)} payment from ${name(p.fromUser)} to ${name(p.toUser)}?`)) return;
    await api.del(`/payments/${p.id}`);
    toast('Payment removed, balances recalculated');
    bump();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settle up</h1>
          <p className="muted">Paid someone back? Record it here and everyone's balance updates.</p>
        </div>
        <button className="btn btn-primary" onClick={() => actions.recordPayment()}>
          <Plus size={18} /> Record a payment
        </button>
      </div>

      <div className="two-col">
        <div>
          <section className="section">
            <div className="section-head">
              <h2>You and each roommate</h2>
            </div>
            <ul className="rows">
              {bal.me.people.map(({ user: u, balanceCents: b }) => (
                <li key={u.id} className="row with-avatar">
                  <Avatar user={u} />
                  <span className="row-main">
                    <span className="row-title">{u.name}</span>
                    <span className={`row-meta ${b > 0 ? 'owed' : b < 0 ? 'owe' : ''}`}>
                      {b === 0 ? 'All square' : b > 0 ? `Owes you ${money(b)}` : `You owe ${money(b)}`}
                    </span>
                  </span>
                  <span className="row-end">
                    {b < 0 && (
                      <button className="btn btn-sm btn-primary" onClick={() => actions.recordPayment({ fromUser: user.id, toUser: u.id, amountCents: -b })}>
                        I paid {money(b)}
                      </button>
                    )}
                    {b > 0 && (
                      <button className="btn btn-sm" onClick={() => actions.recordPayment({ fromUser: u.id, toUser: user.id, amountCents: b })}>
                        They paid me
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Payments so far</h2>
            </div>
            {!pay ? (
              <Loading />
            ) : pay.payments.length === 0 ? (
              <p className="muted">No payments recorded yet.</p>
            ) : (
              <ul className="rows">
                {pay.payments.map((p) => (
                  <li key={p.id} className="row">
                    <span className="row-date">{shortDate(p.date)}</span>
                    <span className="row-main">
                      <span className="row-title">
                        {name(p.fromUser)} paid {name(p.toUser).replace(/^You$/, 'you')}
                      </span>
                      <span className="row-meta">
                        {METHOD_LABELS[p.method]}
                        {p.note ? `, ${p.note}` : ''}
                      </span>
                    </span>
                    <span className="row-end">
                      <span className="row-amt">{money(p.amountCents)}</span>
                      <button className="btn btn-sm btn-ghost icon-btn" onClick={() => remove(p)} aria-label="Remove this payment" title="Remove">
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="aside section">
          <div className="section-head">
            <h2>Simplest way to clear everything</h2>
          </div>
          <p className="faint" style={{ marginBottom: 10 }}>
            Instead of everyone paying everyone, these payments clear every balance in the house. Send each one (e-Transfer, cash), then tap Record.
          </p>
          {bal.simplified.length === 0 ? (
            <p className="muted">Everyone's settled up.</p>
          ) : (
            bal.simplified.map((p, i) => (
              <div className="plan-item" key={i}>
                <Avatar user={p.from} size="sm" />
                <strong>{name(p.from.id)}</strong>
                <ArrowRight size={16} className="plan-arrow" aria-label="pays" />
                <strong>{name(p.to.id).replace(/^You$/, 'you')}</strong>
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(p.amountCents)}</span>
                <button className="btn btn-sm" onClick={() => actions.recordPayment({ fromUser: p.from.id, toUser: p.to.id, amountCents: p.amountCents })}>
                  Record
                </button>
              </div>
            ))
          )}
        </aside>
      </div>
    </>
  );
}
