import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session.jsx';
import Layout from './components/Layout.jsx';
import Auth from './pages/Auth.jsx';
import Onboard, { AddHouse } from './pages/Onboard.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Bills from './pages/Bills.jsx';
import BillDetail from './pages/BillDetail.jsx';
import Settle from './pages/Settle.jsx';
import Ledger from './pages/Ledger.jsx';
import Notifications from './pages/Notifications.jsx';
import Settings from './pages/Settings.jsx';
import Stats from './pages/Stats.jsx';
import { Loading } from './components/ui.jsx';

function Gate() {
  const { loading, user, household } = useSession();
  const { pathname } = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Auth />;
  if (!household) return <Onboard />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="bills" element={<Bills />} />
        <Route path="bills/:id" element={<BillDetail />} />
        <Route path="settle" element={<Settle />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="stats" element={<Stats />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
        <Route path="houses/new" element={<AddHouse />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </BrowserRouter>
  );
}
