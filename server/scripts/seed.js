// Populates a running Hearth server with 3 demo roommates and a month of bills.
// Usage: node scripts/seed.js [http://localhost:3001]
const base = (process.argv[2] || 'http://localhost:3001') + '/api';

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${data.error}`);
    return data;
  };
}

const [maya, jon, sam] = [client(), client(), client()];
const M = (await maya('POST', '/auth/register', { name: 'Maya', email: 'maya@demo.test', password: 'demo1234' })).user;
const { household } = await maya('POST', '/household', { name: 'Emerson St house' });
const J = (await jon('POST', '/auth/register', { name: 'Jon', email: 'jon@demo.test', password: 'demo1234', inviteCode: household.inviteCode })).user;
const S = (await sam('POST', '/auth/register', { name: 'Sam', email: 'sam@demo.test', password: 'demo1234', inviteCode: household.inviteCode })).user;
const all = [{ userId: M.id }, { userId: J.id }, { userId: S.id }];

await maya('POST', '/bills', { title: 'Rent — October', category: 'rent', amount: 2850, paidBy: M.id, splitType: 'percent', participants: [{ userId: M.id, percent: 40 }, { userId: J.id, percent: 30 }, { userId: S.id, percent: 30 }], date: '2026-10-01', description: 'Maya has the big room, so 40/30/30.' });
await jon('POST', '/bills', { title: 'Hydro', description: 'Sep 12 – Oct 11 billing period', category: 'utilities', amount: 134.62, paidBy: J.id, splitType: 'equal', participants: all, date: '2026-10-14' });
await sam('POST', '/bills', { title: 'Rogers internet', category: 'internet', amount: 85, paidBy: S.id, splitType: 'equal', participants: all, date: '2026-10-03', repeat: 'monthly' });
await maya('POST', '/bills', { title: 'Costco run', category: 'groceries', amount: 212.4, paidBy: M.id, splitType: 'exact', participants: [{ userId: M.id, amount: 92.4 }, { userId: J.id, amount: 60 }, { userId: S.id, amount: 60 }], date: '2026-10-18' });
await jon('POST', '/bills', { title: 'Pizza night', category: 'food', amount: 48.9, paidBy: J.id, splitType: 'equal', participants: [{ userId: J.id }, { userId: S.id }], date: '2026-10-22' });
await sam('POST', '/bills', { title: 'Dish soap & paper towels', category: 'household', amount: 23.17, paidBy: S.id, splitType: 'equal', participants: all, date: '2026-10-24' });

const rent = (await jon('GET', '/bills')).bills.find((b) => b.title.startsWith('Rent'));
await jon('POST', `/bills/${rent.id}/pay-share`, { method: 'etransfer' });
await sam('POST', '/payments', { toUser: M.id, amount: 500, note: 'Rent, part 1', method: 'etransfer', date: '2026-10-02' });

console.log('Seeded. Sign in as maya@demo.test / jon@demo.test / sam@demo.test, password demo1234');
