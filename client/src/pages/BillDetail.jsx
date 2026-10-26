import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Check, Repeat } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession, useData } from '../lib/session.jsx';
import { money, shortDate, CATEGORY_LABELS, timeAgo } from '../lib/format.js';
import { useActions } from '../components/Layout.jsx';
import { Avatar, Loading, Modal } from '../components/ui.jsx';

const SPLIT_LABEL = { equal: 'Split equally', exact: 'Split by amount', percent: 'Split by percent' };

export default function BillDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, memberById, toast, bump } = useSession();
  const actions = useActions();
  const { data, error } = useData(`/bills/${id}`);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(null);

  if (error)
    return (
      <div className="empty">
        <h3>That bill doesn't exist anymore</h3>
        <p>It may have been deleted.</p>
        <Link to="/bills" className="btn">
          Back to bills
        </Link>
      </div>
    );
  if (!data) return <Loading />;
  const b = data.bill;
  const payer = memberById(b.paidBy);
  const creator = memberById(b.createdBy);

  const payShare = async (userId) => {
    setBusy(userId);
    try {
      await api.post(`/bills/${b.id}/pay-share`, { userId, method: 'etransfer' });
      const who = userId === user.id ? 'Your' : `${memberById(userId).name}'s`;
      toast(`${who} share is marked as paid`);
      bump();
    } catch (e) {
      toast(e.message);
    }
    setBusy(null);
  };

  const remove = async () => {
    await api.del(`/bills/${b.id}`);
    toast(`Deleted "${b.title}"`);
    bump();
    nav('/bills');
  };

  return (
    <>
      <Link to="/bills" className="btn btn-ghost btn-sm" style={{ marginBottom: 16, paddingLeft: 4 }}>
        <ArrowLeft size={16} /> Bills
      </Link>

      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h1>{b.title}</h1>
          <p className="muted">
            {CATEGORY_LABELS[b.category]}, {shortDate(b.date)}
            {b.recurringId && (
              <>
                {', '}
                <Repeat size={13} style={{ verticalAlign: '-1px' }} /> repeats
              </>
            )}
          </p>
        </div>
        <div className="inline-actions">
          <button className="btn btn-sm" onClick={() => actions.editBill(b)}>
            <Pencil size={15} /> Edit
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>

      <div className="two-col">
        <section>
          <div className="bill-amt">{money(b.amountCents)}</div>
          <p className="muted" style={{ margin: '6px 0 20px' }}>
            Paid by <strong>{b.paidBy === user.id ? 'you' : payer?.name || 'a former roommate'}</strong>. {SPLIT_LABEL[b.splitType]} between {b.shares.length}.
          </p>
          {b.description && <p className="desc" style={{ marginBottom: 24 }}>{b.description}</p>}

          <div className="month-label">Who owes what</div>
          <ul className="rows">
            {b.shares.map((s) => {
              const isPayer = s.userId === b.paidBy;
              const outstanding = s.shareCents - s.paidCents;
              const settled = isPayer || outstanding <= 0;
              const canPay = !settled && (s.userId === user.id || b.paidBy === user.id);
              return (
                <li key={s.userId} className="row with-avatar">
                  <Avatar user={{ name: s.name, color: s.color }} />
                  <span className="row-main">
                    <span className="row-title">{s.userId === user.id ? `${s.name} (you)` : s.name}</span>
                    <span className="row-meta">
                      Share {money(s.shareCents)}
                      {s.percent != null ? `, ${s.percent}%` : ''}
                    </span>
                  </span>
                  <span className="row-end">
                    {isPayer ? (
                      <span className="tag tag-neutral">Paid the bill</span>
                    ) : settled ? (
                      <span className="tag tag-paid">
                        <Check size={14} /> Paid back
                      </span>
                    ) : canPay ? (
                      <button className="btn btn-sm btn-primary" disabled={busy === s.userId} onClick={() => payShare(s.userId)}>
                        {s.userId === user.id ? `I paid ${money(outstanding)}` : `Got ${money(outstanding)} from them`}
                      </button>
                    ) : (
                      <span className="tag tag-due">Owes {money(outstanding)}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <aside className="aside">
          <h3 style={{ marginBottom: 8 }}>About this bill</h3>
          <p className="faint">
            Added by {creator?.name || 'a former roommate'} {timeAgo(b.createdAt)}
            {b.updatedAt && `, edited ${timeAgo(b.updatedAt)}`}.
          </p>
          <p className="faint" style={{ marginTop: 10 }}>
            "I paid" records that you paid {payer?.name || 'them'} back for your share, and everyone's balance updates. Paid a different amount, or
            in one go for several bills? Use Record a payment on the Settle up page instead.
          </p>
        </aside>
      </div>

      {confirmDelete && (
        <Modal
          title="Delete this bill?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button className="btn btn-danger" onClick={remove}>
                Delete bill
              </button>
            </>
          }
        >
          <p>
            "{b.title}" ({money(b.amountCents)}) will stop counting toward balances. Everyone on it gets notified. Payments already recorded stay in the ledger.
          </p>
        </Modal>
      )}
    </>
  );
}
