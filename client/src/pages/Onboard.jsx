import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Logo } from '../components/Layout.jsx';
import { ErrorNote, ThemeSwitch } from '../components/ui.jsx';
import { setHouse } from '../lib/house.js';

/** Join a house with its invite code, or start a new one. Used when you have no house yet, and to add another. */
function JoinOrCreate({ onDone }) {
  const { refresh } = useSession();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res?.household?.id) setHouse(res.household.id); // switch to the house you just made or joined
      await refresh();
      onDone?.();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <>
      <form className="sheet-box form-grid" onSubmit={run(() => api.post('/household/join', { code }))}>
        <h2>Joining roommates who already use Hearth?</h2>
        <label className="field">
          <span>Invite code</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="7F3A9C21" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }} />
        </label>
        <button className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={busy || !code.trim()}>
          Join house
        </button>
      </form>

      <div className="divider-text">
        or
      </div>

      <form className="sheet-box form-grid" onSubmit={run(() => api.post('/household', { name }))}>
        <h2>First one here? Start your house</h2>
        <label className="field">
          <span>House name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Emerson St place" maxLength={60} />
        </label>
        <button className="btn" style={{ justifySelf: 'start' }} disabled={busy}>
          Create house
        </button>
      </form>
      <div style={{ marginTop: 16 }}>
        <ErrorNote error={error} />
      </div>
    </>
  );
}

/** Shown when you're signed in but not in any house yet. */
export default function Onboard() {
  const { user } = useSession();
  const { refresh } = useSession();
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '40px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <span className="brand">
          <Logo />
          <span className="brand-text">
            <strong>Hearth</strong>
          </span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeSwitch />
          <button className="btn btn-sm btn-ghost" onClick={async () => { await api.post('/auth/logout'); refresh(); }}>
            Sign out
          </button>
        </div>
      </div>
      <h1>Hi {user.name}, let's set up your house</h1>
      <p className="muted" style={{ margin: '10px 0 28px' }}>
        One person creates the house and shares the code. Everyone else joins with it.
      </p>

      <JoinOrCreate />
    </div>
  );
}

/** Add another house, from the house menu. */
export function AddHouse() {
  const nav = useNavigate();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Add another house</h1>
          <p className="muted">Keep every place you split bills in one account. Use the house menu at the top to switch between them.</p>
        </div>
      </div>
      <div style={{ maxWidth: 520 }}>
        <JoinOrCreate onDone={() => nav('/')} />
      </div>
    </>
  );
}
