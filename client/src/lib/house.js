// Which house this device is looking at. Kept per device, so your phone can be on one house
// while your laptop is on another. The server double-checks you belong to it.
const KEY = 'hearth-house';
let current = null;
try {
  current = Number(localStorage.getItem(KEY)) || null;
} catch {
  /* storage blocked */
}

export const getHouse = () => current;

export function setHouse(id) {
  current = id ? Number(id) : null;
  try {
    if (current) localStorage.setItem(KEY, String(current));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}
