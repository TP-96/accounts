import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, Copy, Database, Download, Home, KeyRound, LogOut, Palette, RefreshCw, User, UserMinus } from 'lucide-react';
import { api, downloadExport } from '../lib/api.js';
import { PUBLIC_URL } from '../lib/platform.js';
import { useSession, usePalette, PALETTES } from '../lib/session.jsx';
import { Avatar, ThemeSwitch, ErrorNote, Modal, INK_COLORS, inkFor } from '../components/ui.jsx';
import { HouseTile } from '../components/HouseSwitcher.jsx';

const HOUSE_COLORS = ['#2f7a55', '#3b5b92', '#9a3d63', '#9a6a1c', '#2b7f8f', '#6a4c93', '#a8452d', '#5a6b2e'];

const SECTIONS = [
  ['profile', 'Profile', User],
  ['house', 'House', Home],
  ['notifications', 'Notifications', Bell],
  ['appearance', 'Appearance', Palette],
  ['security', 'Sign-in', KeyRound],
  ['data', 'Your data', Database],
];

async function copyText(text, toast, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Copy it from the box instead');
  }
}

/** One setting: what it is on the left, the control on the right (stacked on phones). */
function Row({ title, hint, children, stack }) {
  return (
    <div className={`set-row${stack ? ' stack' : ''}`}>
      <div className="set-label">
        <div className="set-title">{title}</div>
        {hint && <div className="faint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

export default function Settings() {
  const { user, household } = useSession();
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.some(([k]) => k === params.get('s')) ? params.get('s') : 'profile';
  const go = (k) => setParams(k === 'profile' ? {} : { s: k }, { replace: true });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Signed in as <strong>{user.name}</strong> ({user.email}), looking at <strong>{household.name}</strong>.
          </p>
        </div>
      </div>

      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([k, label, Icon]) => (
            <button key={k} type="button" aria-current={section === k ? 'page' : undefined} onClick={() => go(k)}>
              <Icon size={17} strokeWidth={1.8} /> {label}
            </button>
          ))}
        </nav>
        <div className="settings-body" key={section}>
          {section === 'profile' && <Profile />}
          {section === 'house' && <HouseSettings />}
          {section === 'notifications' && <Notifications />}
          {section === 'appearance' && <Appearance />}
          {section === 'security' && <Security />}
          {section === 'data' && <Data />}
        </div>
      </div>
    </>
  );
}

function useSave() {
  const { refresh, toast, bump } = useSession();
  const [error, setError] = useState(null);
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
  return [save, error];
}

/* ---------------- Profile ---------------- */
function Profile() {
  const { user } = useSession();
  const [save, error] = useSave();
  const [name, setName] = useState(user.name);
  const [etransfer, setEtransfer] = useState(user.etransfer || '');
  const dirty = name.trim() !== user.name || etransfer.trim() !== (user.etransfer || '');
  const me = inkFor(user.color);

  return (
    <section>
      <h2 className="set-h">Profile</h2>
      <p className="faint set-sub">How your roommates see you.</p>
      <div className="profile-card">
        <Avatar user={{ ...user, name: name || user.name }} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{name || user.name}</div>
          <div className="faint" style={{ overflowWrap: 'anywhere' }}>{user.email}</div>
        </div>
      </div>
      <ErrorNote error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ name: name.trim(), etransfer: etransfer.trim() }, 'Profile saved');
        }}
      >
        <Row title="Your name" hint="Shown on bills and balances.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Your name" />
        </Row>
        <Row title="Where to send you money" hint="Your e-Transfer email or phone. Shown to roommates when they pay you back.">
          <input className="input" value={etransfer} onChange={(e) => setEtransfer(e.target.value)} maxLength={120} placeholder="e-Transfer email or phone" aria-label="Where to send you money" />
        </Row>
        <div className="set-actions">
          <button className="btn btn-primary" disabled={!dirty || !name.trim()}>
            Save changes
          </button>
          {dirty && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setName(user.name);
                setEtransfer(user.etransfer || '');
              }}
            >
              Undo
            </button>
          )}
        </div>
      </form>
      <Row title="Your colour" hint="Your initial's colour everywhere in Hearth. Saves right away.">
        <div className="swatches" role="group" aria-label="Your colour">
          {INK_COLORS.map((c) => (
            <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={me === c} aria-label={`Colour ${c}`} onClick={() => save({ color: c }, 'Colour updated')} />
          ))}
        </div>
      </Row>
    </section>
  );
}

/* ---------------- House ---------------- */
function HouseSettings() {
  const { user, household, refresh, toast, bump } = useSession();
  const [houseName, setHouseName] = useState(household.name);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const inviteLink = `${PUBLIC_URL}/?invite=${household.inviteCode}`;

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

  return (
    <section>
      <h2 className="set-h" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <HouseTile house={household} size={30} /> {household.name}
      </h2>
      <p className="faint set-sub">These settings are shared with everyone in this house. Switch houses from the name at the top.</p>

      <div className="set-group">Roommates ({household.members.length})</div>
      <ul className="rows" style={{ marginBottom: 8 }}>
        {household.members.map((m) => (
          <li key={m.id} className="row with-avatar">
            <Avatar user={m} />
            <span className="row-main">
              <span className="row-title">{m.id === user.id ? `${m.name} (you)` : m.name}</span>
              <span className="row-meta">{m.email}</span>
            </span>
            <span className="row-end">
              <button className="btn btn-sm btn-ghost" onClick={() => { setRemoveError(null); setRemoving(m); }} title={m.id === user.id ? 'Move out' : `Remove ${m.name}`}>
                <UserMinus size={15} /> <span className="hide-xs">{m.id === user.id ? 'Move out' : 'Remove'}</span>
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="set-group">Invite</div>
      <Row title="Invite a roommate" hint="Send them this link. They sign up and land in this house." stack>
        <div className="code-box">
          <code>{household.inviteCode}</code>
          <button className="btn btn-sm" onClick={() => copyText(inviteLink, toast, 'Invite link copied')}>
            <Copy size={15} /> Copy invite link
          </button>
          <span className="link-text">{inviteLink}</span>
        </div>
      </Row>
      <Row title="Invite link leaked?" hint="Makes a new code. The old link stops working.">
        <button
          className="btn btn-sm"
          onClick={async () => {
            await api.patch('/household', { regenerateCode: true });
            await refresh();
            toast('New invite code made. The old one no longer works.');
          }}
        >
          <RefreshCw size={15} /> New code
        </button>
      </Row>

      <div className="set-group">Look</div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await api.patch('/household', { name: houseName.trim() });
          await refresh();
          toast('House renamed');
        }}
      >
        <Row title="House name">
          <span className="inline-field">
            <input className="input" value={houseName} onChange={(e) => setHouseName(e.target.value)} maxLength={60} aria-label="House name" />
            <button className="btn" disabled={!houseName.trim() || houseName.trim() === household.name}>
              Rename
            </button>
          </span>
        </Row>
      </form>
      <Row title="House colour" hint="The stripe across the top, so you can tell houses apart at a glance.">
        <div className="swatches" role="group" aria-label="House colour">
          {HOUSE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              aria-pressed={household.color === c}
              aria-label={`Use this colour for ${household.name}`}
              onClick={async () => {
                await api.patch('/household', { color: c });
                await refresh();
              }}
            />
          ))}
        </div>
      </Row>

      {removing && (
        <Modal
          title={removing.id === user.id ? `Move out of ${household.name}?` : `Remove ${removing.name}?`}
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
    </section>
  );
}

/* ---------------- Notifications ---------------- */
function Notifications() {
  const { user } = useSession();
  const [save, error] = useSave();
  return (
    <section>
      <h2 className="set-h">Notifications</h2>
      <p className="faint set-sub">Everything always shows under the bell at the top. Choose whether you also get emails.</p>
      <ErrorNote error={error} />
      <Row title="Email me about bills and payments" hint={`New bills, edits, payments, comments and reminders, sent to ${user.email}.`}>
        <label className="toggle">
          <input
            type="checkbox"
            checked={user.emailNotifications}
            onChange={(e) => save({ emailNotifications: e.target.checked }, e.target.checked ? 'Emails turned on' : 'Emails turned off')}
          />
          <span className="sr-only">Email me about bills</span>
        </label>
      </Row>
    </section>
  );
}

/* ---------------- Appearance ---------------- */
function Appearance() {
  const [palette, setPalette] = usePalette();
  const chips = (PALETTES.find(([k]) => k === palette) || PALETTES[0])[2];
  return (
    <section>
      <h2 className="set-h">Appearance</h2>
      <p className="faint set-sub">Saved on this device only. Red always means you owe and green means you're owed.</p>
      <Row title="Mode" hint="Light, dark, or match your device.">
        <ThemeSwitch />
      </Row>
      <Row title="Theme" hint="The colours used across Hearth.">
        <span className="theme-pick">
          <span className="palette-chips" aria-hidden="true">
            {chips.map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
          <select className="select" value={palette} onChange={(e) => setPalette(e.target.value)} aria-label="Theme">
            {PALETTES.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </span>
      </Row>
    </section>
  );
}

/* ---------------- Sign-in & security ---------------- */
function Security() {
  const { user, refresh } = useSession();
  const [save, error] = useSave();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  return (
    <section>
      <h2 className="set-h">Sign-in</h2>
      <p className="faint set-sub">
        You can always sign in with a code emailed to <strong>{user.email}</strong>. Nobody else can reset your password.
      </p>
      <ErrorNote error={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save(pw, user.hasPassword ? 'Password changed' : 'Password added')) setPw({ currentPassword: '', newPassword: '' });
        }}
      >
        <div className="set-group">{user.hasPassword ? 'Change your password' : 'Add a password (optional)'}</div>
        {user.hasPassword && (
          <Row title="Current password">
            <input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} aria-label="Current password" />
          </Row>
        )}
        <Row title={user.hasPassword ? 'New password' : 'Password'} hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} aria-label={user.hasPassword ? 'New password' : 'Password'} />
        </Row>
        <div className="set-actions">
          <button className="btn btn-primary" disabled={(user.hasPassword && !pw.currentPassword) || pw.newPassword.length < 8}>
            {user.hasPassword ? 'Change password' : 'Save password'}
          </button>
        </div>
      </form>
      <div className="set-group">This device</div>
      <Row title="Sign out" hint="You'll need a new emailed code (or your password) to get back in.">
        <button
          className="btn"
          onClick={async () => {
            await api.post('/auth/logout');
            await refresh();
          }}
        >
          <LogOut size={17} /> Sign out
        </button>
      </Row>
    </section>
  );
}

/* ---------------- Data ---------------- */
function Data() {
  const { household, toast } = useSession();
  return (
    <section>
      <h2 className="set-h">Your data</h2>
      <p className="faint set-sub">A copy of everything in {household.name}, yours to keep.</p>
      <Row title="Download an Excel file" hint="Every bill and payment, how each bill was split, current balances, and your ledger with each roommate. Doing this every few months is a good backup.">
        <button className="btn" onClick={() => downloadExport().catch((e) => toast(e.message))}>
          <Download size={17} /> Download
        </button>
      </Row>
    </section>
  );
}
