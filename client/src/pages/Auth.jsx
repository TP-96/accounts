import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Logo } from '../components/Layout.jsx';
import { ErrorNote, ThemeSwitch } from '../components/ui.jsx';

export default function Auth() {
  const { refresh } = useSession();
  const [params] = useSearchParams();
  const invite = params.get('invite') || '';
  const [mode, setMode] = useState(invite ? 'register' : 'login'); // login | register | forgot
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: invite });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const go = (m) => {
    setMode(m);
    setError(null);
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await api.post('/auth/login', { email: form.email, password: form.password });
      else await api.post('/auth/register', form);
      await refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <section className="auth-side">
        <div className="brand" style={{ justifyContent: 'space-between' }}>
          <span className="brand">
            <Logo />
            <span className="brand-text">
              <strong>Hearth</strong>
            </span>
          </span>
          <ThemeSwitch />
        </div>
        <div>
          <h1>The house account book.</h1>
          <p>Write down what you paid for, split it with the people it's for, and always know who owes who. No limits, no ads.</p>
        </div>
        <div className="sample" aria-hidden="true">
          <div className="sample-head">Maya's statement</div>
          <div className="sample-row">
            <span>Jon owes you</span>
            <span className="owed">$24.45</span>
          </div>
          <div className="sample-row">
            <span>You owe Sam</span>
            <span className="owe">$7.72</span>
          </div>
          <div className="sample-row">
            <span>Hydro, October</span>
            <span>$134.62</span>
          </div>
          <div className="sample-row total">
            <span>Overall, you're owed</span>
            <span className="owed">$16.73</span>
          </div>
        </div>
      </section>

      <section className="auth-form">
        <div className="auth-card">
          {mode === 'forgot' ? (
            <>
              <h2>Forgot your password?</h2>
              <p className="muted" style={{ margin: '10px 0 18px' }}>
                Ask any roommate to open <strong>Settings</strong> in Hearth, find your name under Roommates, and tap <strong>Reset password</strong>. They'll
                get a link to send you. Open it and choose a new password.
              </p>
              <p className="faint" style={{ marginBottom: 24 }}>
                Living alone in Hearth, or no one can help? Whoever set up Hearth for your house can reset it for you (see the owner guide).
              </p>
              <button className="btn btn-block" onClick={() => go('login')}>
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
              <p className="muted" style={{ marginBottom: 24 }}>
                {mode === 'login' ? 'Welcome back.' : invite ? "You've been invited to a house. Takes about 20 seconds." : 'Takes about 20 seconds.'}
              </p>
              <form className="form-grid" onSubmit={submit}>
                {mode === 'register' && (
                  <label className="field">
                    <span>Your first name</span>
                    <input className="input" autoComplete="given-name" value={form.name} onChange={set('name')} required maxLength={40} />
                  </label>
                )}
                <label className="field">
                  <span>Email</span>
                  <input className="input" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} required />
                </label>
                <label className="field">
                  <span>{mode === 'register' ? 'Password (8+ characters)' : 'Password'}</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={form.password}
                    onChange={set('password')}
                    required
                    minLength={mode === 'register' ? 8 : undefined}
                  />
                </label>
                {mode === 'register' && (
                  <label className="field">
                    <span>House invite code (if you have one)</span>
                    <input className="input" value={form.inviteCode} onChange={set('inviteCode')} placeholder="e.g. 7F3A9C21" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }} />
                  </label>
                )}
                <ErrorNote error={error} />
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
                </button>
              </form>
              <div style={{ marginTop: 22, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span className="muted">
                  {mode === 'login' ? 'New here? ' : 'Have an account? '}
                  <button type="button" className="btn-link" onClick={() => go(mode === 'login' ? 'register' : 'login')}>
                    {mode === 'login' ? 'Create an account' : 'Sign in'}
                  </button>
                </span>
                {mode === 'login' && (
                  <button type="button" className="btn-link" onClick={() => go('forgot')}>
                    Forgot password?
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
