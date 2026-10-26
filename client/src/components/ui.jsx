import { useEffect, useRef } from 'react';
import { X, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../lib/session.jsx';
import { CATEGORY_LABELS } from '../lib/format.js';

// Roommate colours are ink tones that read on ledger paper in light and dark mode.
export const INK_COLORS = ['#3b5b92', '#9a3d63', '#2f7a55', '#9a6a1c', '#2b7f8f', '#6a4c93', '#a8452d', '#5a6b2e'];
// Accounts created before the redesign stored brighter colours; show the matching ink instead.
const LEGACY = ['#6d5efc', '#f2668b', '#18b38a', '#f5a524', '#3ba7f5', '#a75ef5', '#ef6b3a', '#2bb3c0'];
export const inkFor = (color) => {
  const i = LEGACY.indexOf(String(color || '').toLowerCase());
  return i >= 0 ? INK_COLORS[i] : color || '#4a5a51';
};

export function Avatar({ user, size = '' }) {
  if (!user) return null;
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className={`avatar ${size ? `avatar-${size}` : ''}`} style={{ '--c': inkFor(user.color) }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function CategoryTag({ category }) {
  if (!category || category === 'other') return null;
  return <span className="cat">{CATEGORY_LABELS[category] || category}</span>;
}

export function Modal({ title, onClose, children, footer, labelledBy = 'modal-title' }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    el?.querySelector('input:not([type=checkbox]):not([hidden]), select, textarea')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll('button, [href], input, select, textarea')].filter((n) => !n.disabled && !n.hidden);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className="modal-head">
          <h2 id={labelledBy}>{title}</h2>
          <button type="button" className="btn btn-ghost icon-btn close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const opts = [
    ['light', Sun, 'Light'],
    ['dark', Moon, 'Dark'],
    ['system', Monitor, 'Match device'],
  ];
  return (
    <div className="segmented" role="group" aria-label="Colour theme">
      {opts.map(([key, Icon, label]) => (
        <button key={key} type="button" aria-pressed={theme === key} onClick={() => setTheme(key)} title={label}>
          <Icon size={16} style={{ verticalAlign: '-3px' }} />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading">{label}</div>;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {error.message || String(error)}
    </div>
  );
}
