import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus, Settings as Cog } from 'lucide-react';
import { useSession } from '../lib/session.jsx';

/** A house's colour tile with its first letter: the quickest way to tell houses apart. */
export function HouseTile({ house, size = 28 }) {
  const initial = (house?.name || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="house-tile" style={{ background: house?.color || 'var(--action)', width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">
      {initial}
    </span>
  );
}

/** Small "tile + name" tag, used on alerts so you can see which house they came from. */
export function HouseChip({ house }) {
  return (
    <span className="house-chip">
      <i style={{ background: house.color }} />
      {house.name}
    </span>
  );
}

export default function HouseSwitcher() {
  const { household, households, switchHouse } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const nav = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const others = households.filter((h) => h.id !== household.id).reduce((a, h) => a + h.unread, 0);

  const pick = async (h) => {
    setOpen(false);
    if (h.id === household.id) return;
    await switchHouse(h.id);
    // A bill or settings page from the old house wouldn't exist in the new one.
    if (/^\/(bills\/|houses\/)/.test(pathname)) nav('/bills');
  };

  return (
    <div className="house-switch" ref={box}>
      <button type="button" className="house-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Switch house">
        <HouseTile house={household} />
        <span className="house-name">{household.name}</span>
        {others > 0 && <span className="house-dot" aria-label={`${others} unread in your other houses`} />}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="house-menu" role="menu">
          <div className="house-menu-head">Your houses</div>
          {households.map((h) => (
            <button key={h.id} type="button" role="menuitemradio" aria-checked={h.id === household.id} className={`house-item ${h.id === household.id ? 'current' : ''}`} onClick={() => pick(h)}>
              <HouseTile house={h} size={32} />
              <span className="house-item-main">
                <strong>{h.name}</strong>
                <small>
                  {h.members} {h.members === 1 ? 'person' : 'people'}
                </small>
              </span>
              {h.unread > 0 && h.id !== household.id && <span className="count">{h.unread}</span>}
              {h.id === household.id && <Check size={18} aria-label="Current house" />}
            </button>
          ))}
          <div className="house-menu-foot">
            <Link to="/houses/new" role="menuitem" onClick={() => setOpen(false)}>
              <Plus size={16} /> Add or join another house
            </Link>
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)}>
              <Cog size={16} /> This house's settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
