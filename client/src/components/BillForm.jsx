import { useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { money, parseCents, today, CATEGORY_LABELS } from '../lib/format.js';
import { Avatar, Modal, ErrorNote } from './ui.jsx';
import ReceiptScanner from './ReceiptScanner.jsx';

const SPLITS = [
  ['equal', 'Equally'],
  ['exact', 'By amount'],
  ['percent', 'By percent'],
];

/** Mirror of the server's split maths so people see exactly what each person will owe. */
function preview(splitType, totalCents, rows) {
  const on = rows.filter((r) => r.on);
  if (!on.length || !totalCents) return { shares: {}, ok: false, msg: on.length ? 'Enter an amount' : 'Pick at least one person' };
  if (splitType === 'equal') {
    const base = Math.floor(totalCents / on.length);
    let rem = totalCents - base * on.length;
    const shares = {};
    on.forEach((r) => {
      shares[r.userId] = base + (rem-- > 0 ? 1 : 0);
    });
    return { shares, ok: true, msg: `${money(base)} each${totalCents % on.length ? ' (a cent or two extra for some)' : ''}` };
  }
  if (splitType === 'exact') {
    const shares = {};
    let sum = 0;
    for (const r of on) {
      const c = parseCents(r.value) ?? 0;
      shares[r.userId] = c;
      sum += c;
    }
    const left = totalCents - sum;
    if (left === 0) return { shares, ok: true, msg: 'Adds up to the total' };
    return { shares, ok: false, msg: left > 0 ? `${money(left)} left to assign` : `${money(-left)} over the total` };
  }
  let pctSum = 0;
  const shares = {};
  for (const r of on) {
    const p = Number(r.value) || 0;
    pctSum += p;
    shares[r.userId] = Math.round((totalCents * p) / 100);
  }
  const left = Math.round((100 - pctSum) * 100) / 100;
  if (Math.abs(left) < 0.001) return { shares, ok: true, msg: 'Adds up to 100%' };
  return { shares, ok: false, msg: left > 0 ? `${left}% left to assign` : `${-left}% over 100%` };
}

export default function BillForm({ bill, onClose, onSaved }) {
  const { user, household, toast, bump } = useSession();
  const members = household.members;
  const editing = !!bill;

  const [amount, setAmount] = useState(bill ? (bill.amountCents / 100).toFixed(2) : '');
  const [title, setTitle] = useState(bill?.title || '');
  const [description, setDescription] = useState(bill?.description || '');
  const [category, setCategory] = useState(bill?.category || 'utilities');
  const [date, setDate] = useState(bill?.date || today());
  const [paidBy, setPaidBy] = useState(bill?.paidBy || user.id);
  const [splitType, setSplitType] = useState(bill?.splitType || 'equal');
  const [repeat, setRepeat] = useState('none');
  const [rows, setRows] = useState(() =>
    members.map((m) => {
      const s = bill?.shares.find((x) => x.userId === m.id);
      return {
        userId: m.id,
        on: bill ? !!s : true,
        value: s ? (bill.splitType === 'percent' ? String(s.percent ?? '') : (s.shareCents / 100).toFixed(2)) : '',
      };
    })
  );
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Fields filled from a scanned receipt -> confidence; cleared as soon as the person edits that field.
  const [filled, setFilled] = useState({});
  const touched = useRef(new Set());

  const edit = (field, setter) => (e) => {
    touched.current.add(field);
    setFilled((f) => {
      if (!(field in f)) return f;
      const n = { ...f };
      delete n[field];
      return n;
    });
    setter(e.target.value);
  };

  function applyScan(r) {
    const next = {};
    const put = (field, value, confidence, setter) => {
      if (value == null || value === '') return;
      if (touched.current.has(field)) return; // never overwrite something the person typed
      setter(value);
      next[field] = confidence;
    };
    put('amount', r.totalCents != null ? (r.totalCents / 100).toFixed(2) : null, r.confidence.total, setAmount);
    put('title', r.title, r.confidence.merchant, setTitle);
    put('date', r.date, r.confidence.date, setDate);
    put('category', r.category, 'medium', setCategory);
    put('description', r.description, 'medium', setDescription);
    setFilled(next);
    const n = Object.keys(next).length;
    toast(n ? `Filled ${n} field${n === 1 ? '' : 's'} from the receipt — give them a quick check` : 'Nothing new to fill in');
  }

  const fillNote = (field) =>
    filled[field] ? (
      <small className={`fill-note ${filled[field] === 'low' ? 'warn' : ''}`}>
        {filled[field] === 'low' ? 'From receipt, please double-check' : 'From receipt'}
      </small>
    ) : null;
  const fc = (field) => (filled[field] ? (filled[field] === 'low' ? 'autofilled low' : 'autofilled') : '');

  const totalCents = parseCents(amount) || 0;
  const pv = useMemo(() => preview(splitType, totalCents, rows), [splitType, totalCents, rows]);

  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.userId === id ? { ...r, ...patch } : r)));

  const switchSplit = (t) => {
    setSplitType(t);
    const on = rows.filter((r) => r.on);
    if (t === 'percent') {
      const each = on.length ? Math.floor((10000 / on.length)) / 100 : 0;
      const last = Math.round((100 - each * (on.length - 1)) * 100) / 100;
      let i = 0;
      setRows(rows.map((r) => (r.on ? { ...r, value: String(++i === on.length ? last : each) } : r)));
    } else if (t === 'exact') {
      const p = preview('equal', totalCents, rows).shares;
      setRows(rows.map((r) => (r.on ? { ...r, value: p[r.userId] != null ? (p[r.userId] / 100).toFixed(2) : '' } : r)));
    }
  };

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError(new Error('Give the bill a name'));
    if (!totalCents || totalCents <= 0) return setError(new Error('Enter an amount more than $0'));
    if (!pv.ok) return setError(new Error(pv.msg));
    setSaving(true);
    const body = {
      title,
      description,
      category,
      date,
      paidBy,
      splitType,
      amountCents: totalCents,
      repeat: editing ? undefined : repeat,
      participants: rows
        .filter((r) => r.on)
        .map((r) =>
          splitType === 'exact' ? { userId: r.userId, amount: r.value || '0' } : splitType === 'percent' ? { userId: r.userId, percent: Number(r.value) || 0 } : { userId: r.userId }
        ),
    };
    try {
      const res = editing ? await api.put(`/bills/${bill.id}`, body) : await api.post('/bills', body);
      toast(editing ? 'Bill updated' : `Added ${title} — roommates notified`);
      bump();
      onSaved?.(res.bill);
      onClose();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? 'Edit bill' : 'Add a bill'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="bill-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add bill'}
          </button>
        </>
      }
    >
      <form id="bill-form" className="form-grid" onSubmit={submit} noValidate>
        {!editing && <ReceiptScanner onResult={applyScan} />}
        <label className={`field ${fc('amount')}`}>
          <span>Total amount {fillNote('amount')}</span>
          <div className="input-money amount-hero">
            <input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={edit('amount', setAmount)} aria-label="Total amount in dollars" />
          </div>
        </label>
        <div className="row-2">
          <label className={`field ${fc('title')}`}>
            <span>Name {fillNote('title')}</span>
            <input className="input" placeholder="Hydro — October" value={title} onChange={edit('title', setTitle)} maxLength={120} />
          </label>
          <label className={`field ${fc('category')}`}>
            <span>Category {fillNote('category')}</span>
            <select className="select" value={category} onChange={edit('category', setCategory)}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={`field ${fc('description')}`}>
          <span>Description (optional) {fillNote('description')}</span>
          <textarea className="textarea" placeholder="Billing period, account number, anything roommates should know" value={description} onChange={edit('description', setDescription)} maxLength={1000} rows={filled.description ? 5 : undefined} />
        </label>
        <div className="row-2">
          <label className="field">
            <span>Paid by</span>
            <select className="select" value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === user.id ? `${m.name} (you)` : m.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`field ${fc('date')}`}>
            <span>Date {fillNote('date')}</span>
            <input className="input" type="date" value={date} onChange={edit('date', setDate)} />
          </label>
        </div>

        <div className="field">
          <span id="split-label">Who's on this bill</span>
          <div className="segmented" role="group" aria-labelledby="split-label" style={{ alignSelf: 'flex-start', marginBottom: 6 }}>
            {SPLITS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={splitType === k} onClick={() => switchSplit(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="people-pick">
            {members.map((m) => {
              const r = rows.find((x) => x.userId === m.id);
              const share = pv.shares[m.id];
              return (
                <div key={m.id} className={`person-row ${r.on ? '' : 'off'}`}>
                  <label className="check">
                    <input type="checkbox" checked={r.on} onChange={(e) => setRow(m.id, { on: e.target.checked })} />
                    <Avatar user={m} size="sm" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.id === user.id ? 'You' : m.name}</span>
                  </label>
                  {r.on && splitType === 'exact' && (
                    <div className="input-money share-input">
                      <input className="input num" inputMode="decimal" placeholder="0.00" value={r.value} onChange={(e) => setRow(m.id, { value: e.target.value })} aria-label={`${m.name}'s amount`} />
                    </div>
                  )}
                  {r.on && splitType === 'percent' && (
                    <div className="pct-input share-input">
                      <input className="input num" inputMode="decimal" placeholder="0" value={r.value} onChange={(e) => setRow(m.id, { value: e.target.value })} aria-label={`${m.name}'s percent`} />
                    </div>
                  )}
                  {r.on && splitType !== 'exact' && <span className="share-calc">{share != null ? money(share) : '—'}</span>}
                </div>
              );
            })}
            <div className="split-status" aria-live="polite">
              <span className={pv.ok ? 'owed' : 'owe'}>{pv.msg}</span>
              <span className="num muted">{money(totalCents)}</span>
            </div>
          </div>
        </div>

        {!editing && (
          <label className="field">
            <span>Repeats</span>
            <select className="select" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
              <option value="none">Just once</option>
              <option value="monthly">Every month</option>
              <option value="weekly">Every week</option>
            </select>
          </label>
        )}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
