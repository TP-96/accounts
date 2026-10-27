import { NavLink } from 'react-router-dom';

/** Settle up and Ledger are two views of the same thing: who owes whom. */
export default function MoneyTabs() {
  return (
    <div className="tabs" role="navigation" aria-label="Money">
      <NavLink to="/settle" className={({ isActive }) => (isActive ? 'on' : '')}>Settle up</NavLink>
      <NavLink to="/ledger" className={({ isActive }) => (isActive ? 'on' : '')}>Ledger</NavLink>
    </div>
  );
}
