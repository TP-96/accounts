import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Logo } from '../components/Layout.jsx';
import { ErrorNote, ThemeSwitch } from '../components/ui.jsx';

/**
 * Sign in / create account.
 * With email set up: an emailed 6-digit code is the main way in; a password is optional and secondary.
 * Without email (local dev): plain email + password, so nobody gets locked out.
 */
export default function Auth() {
  const { refresh, emailEnabled } = useSession();
  const [params] = useSearchParams();
  const invite = params.get('invite') || '';
  const [mode, setMode] = useState(invite ? 'register' : 'login'); // login | register
  // start: ask for email · code: type the emailed code · password: secondary sign-in
  // forgot: ask for email to reset · reset: code + new password
  const [step, setStep] = useState(emailEnabled ? 'start' : 'password');
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: invite, code: '', newPassword: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0); // seconds until another code can be requested
  const codeBox = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const go = (st, m = mode) => {
    setStep(st);
    setMode(m);
    setError(null);
    setForm((f) => ({ ...f, code: '', newPassword: '' }));
  };

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if ((step === 'code' || step === 'reset') && codeBox.current) codeBox.current.focus();
  }, [step]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  }

  const sendCode = () =>
    run(async () => {
      await api.post('/auth/code/request', { mode, email: form.email, name: form.name, inviteCode: form.inviteCode });
      setStep('code');
      setWait(30);
    });
  const verify = (code) =>
    run(async () => {
      await api.post('/auth/code/verify', { mode, email: form.email, code });
      await refresh();
    });
  const sendReset = () =>
    run(async () => {
      await api.post('/auth/password-reset/request', { email: form.email });
      setStep('reset');
      setWait(30);
    });
  const confirmReset = () =>
    run(async () => {
      await api.post('/auth/password-reset/confirm', { email: form.email, code: form.code, password: form.newPassword });
      await refresh();
    });
  const passwordSignIn = () =>
    run(async () => {
      if (mode === 'login' || emailEnabled) await api.post('/auth/login', { email: form.email, password: form.password });
      else await api.post('/auth/register', form);
      await refresh();
    });

  const typeCode = (e) => {
    const code = e.target.value.replace(/\D/g, '').slice(0, 6);
    setForm({ ...form, code });
    if (code.length === 6 && step === 'code' && !busy) verify(code); // submits itself on the 6th digit
  };
  const onSubmit = (fn) => (e) => {
    e.preventDefault();
    fn();
  };
  const resendLabel = wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code';

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
          {step === 'start' && (
            <>
              <div className="segmented auth-tabs" role="group" aria-label="Sign in or create an account">
                <button type="button" aria-pressed={mode === 'login'} onClick={() => go('start', 'login')}>
                  Sign in
                </button>
                <button type="button" aria-pressed={mode === 'register'} onClick={() => go('start', 'register')}>
                  Create account
                </button>
              </div>
              <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
              <p className="muted" style={{ marginBottom: 24 }}>
                {mode === 'login'
                  ? "We'll email you a 6-digit code. No password needed."
                  : invite
                    ? "You've been invited to a house. We'll email a code to confirm it's you."
                    : "Takes about 20 seconds. We'll email a code to confirm it's you."}
              </p>
              <form className="form-grid" onSubmit={onSubmit(sendCode)}>
                {mode === 'register' && (
                  <label className="field">
                    <span>Your first name</span>
                    <input className="input" autoComplete="given-name" value={form.name} onChange={set('name')} required maxLength={40} />
                  </label>
                )}
                <label className="field">
                  <span>Email</span>
                  <input className="input" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} required autoFocus={mode === 'login'} />
                </label>
                {mode === 'register' && (
                  <label className="field">
                    <span>House invite code (if you have one)</span>
                    <input className="input" value={form.inviteCode} onChange={set('inviteCode')} placeholder="e.g. 7F3A9C21" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }} />
                  </label>
                )}
                <ErrorNote error={error} />
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? 'Sending…' : 'Email me a code'}
                </button>
              </form>
              {mode === 'login' && (
                <p className="auth-alt">
                  <button type="button" className="btn-link" onClick={() => go('password')}>
                    Use a password instead
                  </button>
                </p>
              )}
            </>
          )}

          {step === 'code' && (
            <>
              <h2>Check your email</h2>
              <p className="muted" style={{ marginBottom: 24 }}>
                We sent a 6-digit code to <strong>{form.email}</strong>. It works for 10 minutes.
              </p>
              <form className="form-grid" onSubmit={onSubmit(() => verify(form.code))}>
                <label className="field">
                  <span>Your code</span>
                  <input
                    ref={codeBox}
                    className="input code-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={form.code}
                    onChange={typeCode}
                    aria-label="6-digit code"
                  />
                </label>
                <ErrorNote error={error} />
                <button className="btn btn-primary btn-block" disabled={busy || form.code.length !== 6}>
                  {busy ? 'Checking…' : mode === 'register' ? 'Create my account' : 'Sign in'}
                </button>
              </form>
              <p className="auth-alt">
                <button type="button" className="btn-link" disabled={wait > 0 || busy} onClick={sendCode}>
                  {resendLabel}
                </button>
                <button type="button" className="btn-link" onClick={() => go('start')}>
                  Use a different email
                </button>
              </p>
              <p className="faint" style={{ marginTop: 14 }}>
                Nothing yet? Check your spam folder. It can take a minute.
              </p>
            </>
          )}

          {step === 'password' && (
            <>
              <h2>{emailEnabled ? 'Sign in with a password' : mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
              <p className="muted" style={{ marginBottom: 24 }}>
                {emailEnabled ? 'If you set a password in Settings, you can use it here.' : mode === 'login' ? 'Welcome back.' : 'Takes about 20 seconds.'}
              </p>
              <form className="form-grid" onSubmit={onSubmit(passwordSignIn)}>
                {!emailEnabled && mode === 'register' && (
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
                  <span>{!emailEnabled && mode === 'register' ? 'Password (8+ characters)' : 'Password'}</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={form.password}
                    onChange={set('password')}
                    required
                    minLength={!emailEnabled && mode === 'register' ? 8 : undefined}
                  />
                </label>
                {!emailEnabled && mode === 'register' && (
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
              <p className="auth-alt">
                {emailEnabled ? (
                  <>
                    <button type="button" className="btn-link" onClick={() => go('start', 'login')}>
                      Email me a code instead
                    </button>
                    <button type="button" className="btn-link" onClick={() => go('forgot')}>
                      Forgot password?
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-link" onClick={() => go('password', mode === 'login' ? 'register' : 'login')}>
                    {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
                  </button>
                )}
              </p>
              {!emailEnabled && mode === 'login' && (
                <p className="faint" style={{ marginTop: 14 }}>
                  Forgot your password? Passwords can only be reset by email, and email isn't set up on this Hearth yet. Ask whoever looks after it.
                </p>
              )}
            </>
          )}

          {step === 'forgot' && (
            <>
              <h2>Forgot your password?</h2>
              <p className="muted" style={{ marginBottom: 24 }}>
                Enter your email and we'll send a code so you can choose a new one. (Or skip the password and{' '}
                <button type="button" className="btn-link" onClick={() => go('start', 'login')}>
                  sign in with a code
                </button>
                .)
              </p>
              <form className="form-grid" onSubmit={onSubmit(sendReset)}>
                <label className="field">
                  <span>Email</span>
                  <input className="input" type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} required autoFocus />
                </label>
                <ErrorNote error={error} />
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? 'Sending…' : 'Email me a code'}
                </button>
              </form>
              <p className="auth-alt">
                <button type="button" className="btn-link" onClick={() => go('password')}>
                  Back to sign in
                </button>
              </p>
            </>
          )}

          {step === 'reset' && (
            <>
              <h2>Choose a new password</h2>
              <p className="muted" style={{ marginBottom: 24 }}>
                If <strong>{form.email}</strong> has an account, we sent it a 6-digit code. Enter it below with your new password.
              </p>
              <form className="form-grid" onSubmit={onSubmit(confirmReset)}>
                <label className="field">
                  <span>Your code</span>
                  <input
                    ref={codeBox}
                    className="input code-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    aria-label="6-digit code"
                  />
                </label>
                <label className="field">
                  <span>New password (8+ characters)</span>
                  <input className="input" type="password" autoComplete="new-password" minLength={8} value={form.newPassword} onChange={set('newPassword')} />
                </label>
                <ErrorNote error={error} />
                <button className="btn btn-primary btn-block" disabled={busy || form.code.length !== 6 || form.newPassword.length < 8}>
                  {busy ? 'Saving…' : 'Save password and sign in'}
                </button>
              </form>
              <p className="auth-alt">
                <button type="button" className="btn-link" disabled={wait > 0 || busy} onClick={sendReset}>
                  {resendLabel}
                </button>
                <button type="button" className="btn-link" onClick={() => go('password')}>
                  Back to sign in
                </button>
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
