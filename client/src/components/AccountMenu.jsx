import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Palette, Settings as Cog, User } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Avatar } from './ui.jsx';

/** Tap your initials (top right) for your account: settings, appearance and signing out. */
export default function AccountMenu() {
  const { user, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const signOut = async () => {
    setBusy(true);
    try {
      await api.post('/auth/logout');
    } catch {
      /* already signed out */
    }
    setOpen(false);
    nav('/');
    await refresh();
    setBusy(false);
  };

  return (
    <div className="account-switch" ref={box}>
      <button type="button" className="account-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Your account" title="Your account" onClick={() => setOpen((o) => !o)}>
        <Avatar user={user} />
      </button>
      {open && (
        <div className="house-menu account-menu" role="menu">
          <div className="account-head">
            <Avatar user={user} />
            <span style={{ minWidth: 0 }}>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
          </div>
          <div className="house-menu-foot">
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)}>
              <User size={16} /> Profile
            </Link>
            <Link to="/settings?s=appearance" role="menuitem" onClick={() => setOpen(false)}>
              <Palette size={16} /> Appearance
            </Link>
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)}>
              <Cog size={16} /> All settings
            </Link>
          </div>
          <div className="house-menu-foot">
            <button type="button" role="menuitem" className="signout-item" onClick={signOut} disabled={busy}>
              <LogOut size={16} /> {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
