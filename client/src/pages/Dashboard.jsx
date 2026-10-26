import { Link } from 'react-router-dom';
import { Plus, ArrowRight, Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { PUBLIC_URL } from '../lib/platform.js';
import { useSession, useData } from '../lib/session.jsx';
import { money, shortDate, timeAgo } from '../lib/format.js';
import { useActions } from '../components/Layout.jsx';
import { Avatar, CategoryTag, Loading } from '../components/ui.jsx';

export default function Dashboard() {
  const { user, household, toast, memberById } = useSession();
  const actions = useActions();
  const { data: bal } = useData('/balances');
  const { data: bills } = useData('/bills?mine=1');
  const { data: act } = useData('/activity');

  if (!bal) return <Loading />;
  const { me, simplified } = bal;
  const alone = household.members.length < 2;
  const today = new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

  const remind = async (u) => {
    try {
      await api.post('/nudge', { userId: u.id });
      toast(`Reminder sent to ${u.name}`);
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <>
      <section className="section">
        <p className="statement-meta">
          <strong>{user.name}'s statement</strong>, {today}
        </p>

        {alone ? (
          <Invite code={household.inviteCode} toast={toast} />
        ) : (
          <table className="statement">
            <caption className="sr-only">What you and each roommate owe each other</caption>
            <tbody>
              {me.people.map(({ user: u, balanceCents: b }, i) => (
                <tr key={u.id} className={i === me.people.length - 1 ? 'before-total' : ''}>
                  <td>
                    <Link to={`/ledger?with=${u.id}`} className="who">
                      <Avatar user={u} />
                      <span className="who-name">{u.name}</span>
                    </Link>
                  </td>
                  <td className="what">{b > 0 ? 'owes you' : b < 0 ? 'you owe' : 'all square'}</td>
                  <td className={`amt ${b > 0 ? 'owed' : b < 0 ? 'owe' : 'muted'}`}>{b === 0 ? '—' : money(b)}</td>
                  <td className="act">
                    {b < 0 && (
                      <button className="btn btn-sm btn-primary" onClick={() => actions.recordPayment({ fromUser: user.id, toUser: u.id, amountCents: -b })}>
                        Pay back
                      </button>
                    )}
                    {b > 0 && (
                      <button className="btn btn-sm" onClick={() => remind(u)}>
                        Remind
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>
                  <span className="who">{me.netCents > 0 ? "Overall, you're owed" : me.netCents < 0 ? 'Overall, you owe' : "Overall, you're all square"}</span>
                </td>
                <td className="what" />
                <td className={`amt ${me.netCents > 0 ? 'owed' : me.netCents < 0 ? 'owe' : ''}`}>
                  <span>{money(me.netCents)}</span>
                </td>
                <td className="act" />
              </tr>
            </tbody>
          </table>
        )}

        <div className="statement-actions">
          <button className="btn btn-primary" onClick={actions.addBill}>
            <Plus size={18} /> Add a bill
          </button>
          {!alone && (
            <button className="btn" onClick={() => actions.recordPayment()}>
              Record a payment
            </button>
          )}
        </div>
      </section>

      <div className="two-col section">
        <div>
          {simplified.length > 0 && (
            <div style={{ marginBottom: 34 }}>
              <div className="section-head">
                <h2>Settle the whole house in {simplified.length} {simplified.length === 1 ? 'payment' : 'payments'}</h2>
              </div>
              {simplified.map((p, i) => (
                <div className="plan-item" key={i}>
                  <Avatar user={p.from} size="sm" />
                  <strong>{p.from.id === user.id ? 'You' : p.from.name}</strong>
                  <ArrowRight size={16} className="plan-arrow" aria-label="pays" />
                  <strong>{p.to.id === user.id ? 'you' : p.to.name}</strong>
                  <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(p.amountCents)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="section-head">
            <h2>Your recent bills</h2>
            <Link to="/bills">All bills</Link>
          </div>
          {!bills ? (
            <Loading />
          ) : bills.bills.length === 0 ? (
            <div className="empty">
              <h3>No bills yet</h3>
              <p>Add the first one: rent, hydro, that Costco run.</p>
            </div>
          ) : (
            <ul className="rows">
              {bills.bills.slice(0, 6).map((b) => {
                const mine = b.shares.find((s) => s.userId === user.id)?.shareCents || 0;
                const iPaid = b.paidBy === user.id;
                return (
                  <li key={b.id}>
                    <Link to={`/bills/${b.id}`} className="row">
                      <span className="row-date">{shortDate(b.date)}</span>
                      <span className="row-main">
                        <span className="row-title">
                          {b.title}
                          <CategoryTag category={b.category} />
                        </span>
                        <span className="row-meta">
                          {iPaid ? 'You paid' : `${memberById(b.paidBy)?.name || 'Someone'} paid`} {money(b.amountCents)}
                        </span>
                      </span>
                      <span className="row-amt">
                        {money(mine)}
                        <small>your share</small>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="aside">
          <div className="section-head">
            <h2>What's happened</h2>
          </div>
          {!act ? (
            <Loading />
          ) : (
            <ul className="log">
              {act.activity.slice(0, 10).map((a) => (
                <li key={a.id}>
                  {a.summary}
                  <time dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}

function Invite({ code, toast }) {
  const link = `${PUBLIC_URL}/?invite=${code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch {
      toast(`Invite code: ${code}`);
    }
  };
  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ marginBottom: 10 }}>Invite your roommates</h1>
      <p className="muted" style={{ marginBottom: 18 }}>
        Send them this link or code. Once they've joined, everyone's balances show up here.
      </p>
      <div className="code-box">
        <code>{code}</code>
        <button className="btn btn-sm" onClick={copy}>
          <Copy size={15} /> Copy invite link
        </button>
      </div>
    </div>
  );
}
