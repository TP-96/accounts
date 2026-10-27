import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { setCurrency } from './format.js';
import { setHouse } from './house.js';

const SessionCtx = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, household: null, households: [], emailEnabled: false });
  const [version, setVersion] = useState(0); // bump to refetch data everywhere
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const lastKey = useRef('');

  const refresh = useCallback(async () => {
    try {
      const data = await api.get('/me');
      setCurrency(data.household?.currency);
      setHouse(data.household?.id || null); // the server's answer wins if our remembered house was stale
      const root = document.documentElement;
      if (data.household?.color) root.style.setProperty('--house', data.household.color);
      else root.style.removeProperty('--house');
      // Skip the update when nothing changed, so a background refresh never re-renders everything.
      const key = JSON.stringify([data.user, data.household, data.households]);
      if (key === lastKey.current) setState((s) => (s.loading ? { ...s, loading: false } : s));
      else {
        lastKey.current = key;
        setState({ loading: false, user: data.user, household: data.household, households: data.households || [], emailEnabled: data.emailEnabled });
      }
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pollUnread = useCallback(async () => {
    try {
      const d = await api.get('/notifications');
      setUnread(d.unread);
    } catch {
      /* signed out */
    }
  }, []);

  useEffect(() => {
    if (!state.user) return undefined;
    pollUnread();
    // Keep the roster fresh too: a roommate who joined (or left) while this tab was open must show up in bill splits.
    const tick = () => {
      pollUnread();
      refresh();
    };
    const t = setInterval(tick, 20000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [state.user, pollUnread, refresh, version]);

  const toast = useCallback((message) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  /** Look at a different house. Pages remount (keyed by house), so nothing from the old one lingers. */
  const switchHouse = useCallback(
    async (id) => {
      setHouse(id);
      await refresh();
    },
    [refresh]
  );

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      switchHouse,
      version,
      bump: () => setVersion((v) => v + 1),
      unread,
      setUnread,
      toast,
      memberById: (id) => state.household?.members.find((m) => m.id === id) || state.household?.formerMembers?.find((m) => m.id === id),
    }),
    [state, refresh, switchHouse, version, unread, toast]
  );

  return (
    <SessionCtx.Provider value={value}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.message}
          </div>
        ))}
      </div>
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);

/** Fetch JSON on mount and whenever the global data version (or deps) change. */
export function useData(url, deps = []) {
  const { version } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    api
      .get(url)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, version, ...deps]);
  return { data, error, loading: !data && !error };
}

export function useTheme() {
  const read = () => {
    try {
      return localStorage.getItem('hearth-theme') || 'system';
    } catch {
      return 'system';
    }
  };
  const [theme, setThemeState] = useState(read);
  const setTheme = (t) => {
    setThemeState(t);
    try {
      if (t === 'system') localStorage.removeItem('hearth-theme');
      else localStorage.setItem('hearth-theme', t);
    } catch {
      /* storage blocked */
    }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return [theme, setTheme];
}
