import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useSession, useData } from '../lib/session.jsx';
import { timeAgo } from '../lib/format.js';
import { Loading } from '../components/ui.jsx';
import { HouseChip } from '../components/HouseSwitcher.jsx';

export default function Notifications() {
  const { setUnread, bump, emailEnabled, user, household, households, switchHouse } = useSession();
  const nav = useNavigate();
  const { data } = useData('/notifications');

  // Mark everything read a moment after the page opens, so unread dots are visible first.
  useEffect(() => {
    if (!data?.unread) return undefined;
    const t = setTimeout(async () => {
      await api.post('/notifications/read');
      setUnread(0);
    }, 1500);
    return () => clearTimeout(t);
  }, [data, setUnread]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="muted">
            New bills, payments and reminders.{' '}
            {user.emailNotifications
              ? emailEnabled
                ? `Also emailed to ${user.email}.`
                : 'Email delivery is not set up on this server yet.'
              : 'Email copies are off — turn them on in Settings.'}
          </p>
        </div>
        {data?.unread > 0 && (
          <button
            className="btn btn-sm"
            onClick={async () => {
              await api.post('/notifications/read');
              setUnread(0);
              bump();
            }}
          >
            Mark all read
          </button>
        )}
      </div>
      <section>
        {!data ? (
          <Loading />
        ) : data.notifications.length === 0 ? (
          <div className="empty">
            <h3>You're all caught up</h3>
            <p>When a roommate adds a bill you're on, it lands here.</p>
          </div>
        ) : (
          <div>
            {data.notifications.map((n) => (
              <Link
                key={n.id}
                to={n.link || '/'}
                className={`notif ${n.read ? '' : 'unread'}`}
                onClick={async (e) => {
                  // An alert from another house: switch to it first, so the bill it links to exists.
                  if (n.house && n.house.id !== household.id) {
                    e.preventDefault();
                    await switchHouse(n.house.id);
                    nav(n.link || '/');
                  }
                }}
              >
                <span className="dot" aria-hidden="true" />
                <div className="row-main">
                  {households.length > 1 && n.house && <HouseChip house={n.house} />}
                  <div className="row-title">{n.title}</div>
                  {n.body && <div className="muted" style={{ fontSize: '0.925rem' }}>{n.body}</div>}
                  <div className="row-meta">
                    {timeAgo(n.createdAt)}
                    {!n.read && <span className="sr-only">, unread</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
