import { useState } from 'react';
import { Copy, Download, LogOut, KeyRound, UserMinus } from 'lucide-react';
import { api, downloadExport } from '../lib/api.js';
import { PUBLIC_URL } from '../lib/platform.js';
import { useSession } from '../lib/session.jsx';
import { Avatar, ThemeSwitch, ErrorNote, Modal, INK_COLORS, inkFor } from '../components/ui.jsx';

async function copyText(text, toast, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Copy it from the box instead');
  }
}

export default function Settings() {
  const { user, household, refresh, toast, bump } = useSession();
  const [name, setName] = useState(user.name);
  const [etransfer, setEtransfer] = useState(user.etransfer || '');
  const [houseName, setHouseName] = useState(household.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState(null);
  const [resetFor, setResetFor] = useState(null); // {member, link}
  const [removing, setRemoving] = useState(null); // member
  const [removeError, setRemoveError] = useState(null);

  const save = async (body, msg) => {
    setError(null);
    try {
      await api.patch('/me', body);
      await refresh();
      bump();
      toast(msg);
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  const makeResetLink = async (m) => {
    try {
      const r = await api.post(`/household/members/${m.id}/reset-link`);
      setResetFor({ member: m, link: `${PUBLIC_URL}${r.path}` });
    } catch (e) {
      toast(e.message);
    }
  };

  const confirmRemove = async () => {
    setRemoveError(null);
    try {
      await api.post(`/household/members/${removing.id}/remove`);
      const self = removing.id === user.id;
      setRemoving(null);
      toast(self ? 'You moved out of the house' : `${removing.name} was removed from the house`);
      await refresh();
      bump();
    } catch (e) {
      setRemoveError(e);
    }
  };

  const inviteLink = `${PUBLIC_URL}/?invite=${household.inviteCode}`;
  const me = inkFor(user.color);

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <ErrorNote error={error} />

      <div className="two-col" style={{ marginTop: error ? 16 : 0 }}>
        <div>
          <section className="section">
            <div className="section-head">
              <h2>{household.name}</h2>
            </div>
            <div className="month-label">Roommates</div>
            <ul className="rows" style={{ marginBottom: 28 }}>
              {household.members.map((m) => (
                <li key={m.id} className="row with-avatar">
                  <Avatar user={m} />
                  <span className="row-main">
                    <span className="row-title">{m.id === user.id ? `${m.name} (you)` : m.name}</span>
                    <span className="row-meta">{m.email}</span>
                  </span>
                  <span className="row-end">
                    {m.id !== user.id && (
                      <button className="btn btn-sm btn-ghost" onClick={() => makeResetLink(m)} title={`Make a password reset link for ${m.name}`}>
                        <KeyRound size={15} /> <span className="hide-xs">Reset password</span>
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => { setRemoveError(null); setRemoving(m); }} title={m.id === user.id ? 'Move out' : `Remove ${m.name}`}>
                      <UserMinus size={15} /> <span className="hide-xs">{m.id === user.id ? 'Move out' : 'Remove'}</span>
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            <div className="form-grid">
              <div className="field">
                <span>Invite a new roommate</span>
                <div className="code-box">
                  <code>{household.inviteCode}</code>
                  <button className="btn btn-sm" onClick={() => copyText(inviteLink, toast, 'Invite link copied')}>
                    <Copy size={15} /> Copy invite link
                  </button>
                  <span className="link-text">{inviteLink}</span>
                </div>
                <button
                  className="btn-link"
                  style={{ alignSelf: 'flex-start', marginTop: 6, fontSize: '0.875rem' }}
                  onClick={async () => {
                    await api.patch('/household', { regenerateCode: true });
                    await refresh();
                    toast('New invite code made. The old one no longer works.');
                  }}
                >
                  Make a new code (stops the old one working)
                </button>
              </div>
              <form
                className="form-grid"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await api.patch('/household', { name: houseName });
                  await refresh();
                  toast('House renamed');
                }}
              >
                <label className="field">
                  <span>House name</span>
                  <input className="input" value={houseName} onChange={(e) => setHouseName(e.target.value)} maxLength={60} />
                </label>
                <button className="btn" style={{ justifySelf: 'start' }} disabled={!houseName.trim() || houseName === household.name}>
                  Rename house
                </button>
              </form>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Back up or export</h2>
            </div>
            <p className="muted" style={{ marginBottom: 14, maxWidth: '60ch' }}>
              An Excel file with every bill and payment, how each bill was split, current balances, and your ledger with each roommate.
            </p>
            <button className="btn" onClick={() => downloadExport().catch((e) => toast(e.message))}>
              <Download size={18} /> Download Excel file
            </button>
          </section>
        </div>

        <aside className="aside">
          <section className="section form-grid">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Avatar user={{ ...user, name: name || user.name }} size="lg" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{user.name}</div>
                <div className="faint" style={{ overflowWrap: 'anywhere' }}>{user.email}</div>
              </div>
            </div>
            <div className="field">
              <span>Your colour</span>
              <div className="swatches" role="group" aria-label="Your colour">
                {INK_COLORS.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} aria-pressed={me === c} aria-label={`Colour ${c}`} onClick={() => save({ color: c }, 'Colour updated')} />
                ))}
              </div>
            </div>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                save({ name }, 'Name updated');
              }}
            >
              <label className="field">
                <span>Your name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
              </label>
              <button className="btn" style={{ justifySelf: 'start' }} disabled={!name.trim() || name === user.name}>
                Save name
              </button>
            </form>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                save({ etransfer }, etransfer.trim() ? 'Saved. Roommates will see it when they pay you.' : 'Removed');
              }}
            >
              <label className="field">
                <span>Where roommates should send money</span>
                <input
                  className="input"
                  value={etransfer}
                  onChange={(e) => setEtransfer(e.target.value)}
                  maxLength={120}
                  placeholder="e-Transfer email or phone number"
                />
              </label>
              <p className="faint" style={{ marginTop: -8 }}>
                Shown to your roommates when they pay you back, so nobody has to ask.
              </p>
              <button className="btn" style={{ justifySelf: 'start' }} disabled={etransfer.trim() === (user.etransfer || '')}>
                Save
              </button>
            </form>
          </section>

          <section className="section">
            <div className="switch">
              <div>
                <div style={{ fontWeight: 650 }}>Appearance</div>
                <div className="faint">Light, dark, or match your device</div>
              </div>
              <ThemeSwitch />
            </div>
            <label className="switch">
              <div>
                <div style={{ fontWeight: 650 }}>Email me about bills</div>
                <div className="faint">You'll always see them here too</div>
              </div>
              <input
                type="checkbox"
                checked={user.emailNotifications}
                onChange={(e) => save({ emailNotifications: e.target.checked }, e.target.checked ? 'Emails turned on' : 'Emails turned off')}
              />
            </label>
          </section>

          <section className="section">
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await save(pw, 'Password changed')) setPw({ currentPassword: '', newPassword: '' });
              }}
            >
              <h2>Change your password</h2>
              <label className="field">
                <span>Current password</span>
                <input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
              </label>
              <label className="field">
                <span>New password (8+ characters)</span>
                <input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
              </label>
              <button className="btn" style={{ justifySelf: 'start' }} disabled={!pw.currentPassword || pw.newPassword.length < 8}>
                Change password
              </button>
            </form>
          </section>

          <section className="section">
            <button
              className="btn"
              onClick={async () => {
                await api.post('/auth/logout');
                await refresh();
              }}
            >
              <LogOut size={18} /> Sign out
            </button>
          </section>
        </aside>
      </div>

      {resetFor && (
        <Modal
          title={`Reset link for ${resetFor.member.name}`}
          onClose={() => setResetFor(null)}
          footer={
            <button className="btn btn-primary" onClick={() => copyText(resetFor.link, toast, 'Reset link copied')}>
              <Copy size={16} /> Copy link
            </button>
          }
        >
          <div className="form-grid">
            <p>
              Send this to {resetFor.member.name} by text or chat. Opening it lets them choose a new password. It works once and expires in 3 days.
            </p>
            <div className="code-box">
              <span className="link-text" style={{ flexBasis: 'auto' }}>
                {resetFor.link}
              </span>
            </div>
            <p className="faint">Only share it with {resetFor.member.name}: anyone with the link can set their password.</p>
          </div>
        </Modal>
      )}

      {removing && (
        <Modal
          title={removing.id === user.id ? 'Move out of the house?' : `Remove ${removing.name}?`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmRemove}>
                {removing.id === user.id ? 'Move out' : `Remove ${removing.name}`}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <p>
              {removing.id === user.id ? "You'll" : `${removing.name} will`} leave {household.name}. Past bills and payments stay in the ledger with
              {removing.id === user.id ? ' your' : ' their'} name on them. Repeating bills that include {removing.id === user.id ? 'you' : 'them'} will stop.
            </p>
            <p className="note">This only works once {removing.id === user.id ? "you're" : 'they are'} all square with everyone, so nobody loses track of money.</p>
            <ErrorNote error={removeError} />
          </div>
        </Modal>
      )}
    </>
  );
}
