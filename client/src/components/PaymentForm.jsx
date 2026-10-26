import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { money, parseCents, today, METHOD_LABELS } from '../lib/format.js';
import { Modal, ErrorNote } from './ui.jsx';

export default function PaymentForm({ initial = {}, onClose }) {
  const { user, household, toast, bump } = useSession();
  const members = household.members;
  const firstOther = members.find((m) => m.id !== user.id)?.id;
  const [fromUser, setFrom] = useState(initial.fromUser || user.id);
  const [toUser, setTo] = useState(initial.toUser || firstOther);
  const [amount, setAmount] = useState(initial.amountCents ? (initial.amountCents / 100).toFixed(2) : '');
  const [method, setMethod] = useState('etransfer');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState(initial.note || '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const name = (id) => (id === user.id ? 'You' : members.find((m) => m.id === id)?.name);

  async function submit(e) {
    e.preventDefault();
    const cents = parseCents(amount);
    if (!cents || cents <= 0) return setError(new Error('Enter an amount more than $0'));
    if (fromUser === toUser) return setError(new Error('Pick two different people'));
    setSaving(true);
    try {
      await api.post('/payments', { fromUser, toUser, amountCents: cents, method, date, note });
      toast(`Recorded ${money(cents)} from ${name(fromUser)} to ${name(toUser)}`);
      bump();
      onClose();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Record a payment"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pay-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Record payment'}
          </button>
        </>
      }
    >
      <form id="pay-form" className="form-grid" onSubmit={submit} noValidate>
        <p className="muted">Log money that's already changed hands — e-Transfer, cash, whatever. Balances update right away.</p>
        <div className="row-2">
          <label className="field">
            <span>Who paid</span>
            <select className="select" value={fromUser} onChange={(e) => setFrom(Number(e.target.value))}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === user.id ? `${m.name} (you)` : m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Paid to</span>
            <select className="select" value={toUser} onChange={(e) => setTo(Number(e.target.value))}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === user.id ? `${m.name} (you)` : m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Amount</span>
          <div className="input-money amount-hero">
            <input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </label>
        <div className="row-2">
          <label className="field">
            <span>How</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Note (optional)</span>
          <input className="input" placeholder="October hydro" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
