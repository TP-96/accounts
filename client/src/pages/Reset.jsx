import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Logo } from '../components/Layout.jsx';
import { ErrorNote, Loading } from '../components/ui.jsx';

/** Opened from a reset link a roommate made in Settings. */
export default function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const nav = useNavigate();
  const { refresh, toast } = useSession();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get(`/auth/reset-info?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(setError);
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset', { token, password });
      await refresh();
      toast('Password changed. You are signed in.');
      nav('/', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: 'max(48px, env(safe-area-inset-top)) 16px 48px' }}>
      <span className="brand" style={{ marginBottom: 40 }}>
        <Logo />
        <span className="brand-text">
          <strong>Hearth</strong>
        </span>
      </span>
      {!info && !error ? (
        <Loading />
      ) : !info ? (
        <>
          <h1 style={{ marginBottom: 12 }}>This link doesn't work</h1>
          <ErrorNote error={error} />
          <button className="btn" style={{ marginTop: 20 }} onClick={() => nav('/', { replace: true })}>
            Go to sign in
          </button>
        </>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <div>
            <h1>New password for {info.name}</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              For the account {info.email}. Choose something you'll remember.
            </p>
          </div>
          <label className="field">
            <span>New password (8+ characters)</span>
            <input className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || password.length < 8}>
            {busy ? 'Saving…' : 'Save password and sign in'}
          </button>
        </form>
      )}
    </div>
  );
}
