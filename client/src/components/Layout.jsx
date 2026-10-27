import { createContext, useContext, useState } from 'react';
import { NavLink, Link, Outlet } from 'react-router-dom';
import { BookOpen, ReceiptText, ArrowLeftRight, Bell, Home, Plus, BarChart3 } from 'lucide-react';
import { useSession } from '../lib/session.jsx';
import BillForm from './BillForm.jsx';
import PaymentForm from './PaymentForm.jsx';
import { Avatar } from './ui.jsx';
import HouseSwitcher from './HouseSwitcher.jsx';

const ActionsCtx = createContext(null);
export const useActions = () => useContext(ActionsCtx);

/** The Hearth mark: a little house drawn in ink. */
export function Logo({ size = 30 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--action)" />
      <path d="M8 15.5 16 9l8 6.5V24a1 1 0 0 1-1 1h-4.5v-5h-5v5H9a1 1 0 0 1-1-1z" fill="var(--action-ink)" />
    </svg>
  );
}

const NAV = [
  ['/', 'Home', Home],
  ['/bills', 'Bills', ReceiptText],
  ['/settle', 'Settle up', ArrowLeftRight],
  ['/ledger', 'Ledger', BookOpen],
  ['/stats', 'Stats', BarChart3],
  ['/notifications', 'Alerts', Bell],
];

export default function Layout() {
  const { user, household, unread } = useSession();
  const [billModal, setBillModal] = useState(null);
  const [payModal, setPayModal] = useState(null);

  const actions = {
    addBill: () => setBillModal({}),
    editBill: (bill, onSaved) => setBillModal({ bill, onSaved }),
    recordPayment: (initial = {}) => setPayModal(initial),
  };

  return (
    <ActionsCtx.Provider value={actions}>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand" aria-label="Hearth home">
            <Logo />
          </Link>
          <HouseSwitcher />
          <nav className="topnav" aria-label="Main">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                {label === 'Alerts' ? 'Notifications' : label}
                {to === '/notifications' && unread > 0 && <span className="count">{unread}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-end">
            <button className="btn btn-primary btn-sm" onClick={actions.addBill}>
              <Plus size={16} /> Add a bill
            </button>
            <Link to="/settings" aria-label="Settings and your account" title="Settings">
              <Avatar user={user} />
            </Link>
          </div>
        </div>
      </header>

      <main className="main">
        <Outlet key={household.id} />
      </main>

      <nav className="tabbar" aria-label="Main">
        {NAV.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={21} strokeWidth={1.75} />
            {label}
            {to === '/notifications' && unread > 0 && <span className="dot" aria-label={`${unread} unread`} />}
          </NavLink>
        ))}
      </nav>

      {billModal && <BillForm bill={billModal.bill} onSaved={billModal.onSaved} onClose={() => setBillModal(null)} />}
      {payModal && <PaymentForm initial={payModal} onClose={() => setPayModal(null)} />}
    </ActionsCtx.Provider>
  );
}
