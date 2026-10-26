import { q } from './db.js';
import { normalizeBill, createBill } from './bills.js';
import { fmt } from './money.js';
import { notify } from './notify.js';

/** Next occurrence; monthly clamps to the last day (Jan 31 -> Feb 28 -> Mar 31 keeps original day via template). */
export function advanceDate(isoDate, frequency, anchorDay = null) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d + 7));
    return dt.toISOString().slice(0, 10);
  }
  const day = anchorDay || d;
  const nextMonth = new Date(Date.UTC(y, m, 1)); // first of next month
  const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
  nextMonth.setUTCDate(Math.min(day, lastDay));
  return nextMonth.toISOString().slice(0, 10);
}

/**
 * Create any recurring bills that have come due (catches up if nothing ran for a while).
 * Each occurrence is claimed with a compare-and-set on next_date, so two server
 * instances running this at the same moment can never create the same bill twice.
 */
export async function runRecurring(today = new Date().toISOString().slice(0, 10)) {
  const due = await q.all('SELECT * FROM recurring_bills WHERE active = 1 AND next_date <= ?', today);
  let created = 0;
  for (const r of due) {
    const template = JSON.parse(r.template);
    const anchorDay = template.anchorDay || Number(r.next_date.slice(8, 10));
    let current = r.next_date;
    let guard = 0;
    while (current <= today && guard++ < 60) {
      const next = advanceDate(current, r.frequency, anchorDay);
      const claimed = await q.get(
        'UPDATE recurring_bills SET next_date = ? WHERE id = ? AND next_date = ? AND active = 1 RETURNING id',
        next, r.id, current
      );
      if (!claimed) break; // another instance got there first
      try {
        const bill = await normalizeBill(r.household_id, { ...template, date: current });
        await createBill(r.household_id, r.created_by, bill, { recurringId: r.id });
        created++;
      } catch (err) {
        // A member left or the template is now invalid: stop the series and tell the creator.
        await q.run('UPDATE recurring_bills SET active = 0 WHERE id = ?', r.id);
        await notify([r.created_by], {
          type: 'bill',
          title: `Recurring bill "${template.title}" was paused`,
          body: `It couldn't be created: ${err.message}. Re-add it with the current roommates.`,
          link: '/bills',
        });
        break;
      }
      current = next;
    }
    if (!template.anchorDay) {
      template.anchorDay = anchorDay;
      await q.run('UPDATE recurring_bills SET template = ? WHERE id = ?', JSON.stringify(template), r.id);
    }
  }
  if (created && process.env.NODE_ENV !== 'test') console.log(`[recurring] created ${created} bill(s)`);
  return created;
}

let lastRun = 0;
/** Cheap to call on every request: actually runs at most every 10 minutes per server instance. */
export async function runRecurringThrottled() {
  if (Date.now() - lastRun < 10 * 60 * 1000) return;
  lastRun = Date.now();
  try {
    await runRecurring();
  } catch (err) {
    console.error('[recurring] failed', err);
  }
}
