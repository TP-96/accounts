import { API_BASE, getToken, setToken, isNative } from './platform.js';
import { getHouse, setHouse } from './house.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = isNative ? await getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (getHouse()) headers['X-Household'] = String(getHouse());

  let res;
  try {
    res = await fetch(`${API_BASE}/api${url}`, {
      method,
      credentials: API_BASE ? 'omit' : 'same-origin',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach Hearth. Check your connection and try again.", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);

  // Native apps keep the session token themselves (web uses an httpOnly cookie).
  if (data?.token) await setToken(data.token);
  if (url === '/auth/logout') {
    await setToken(null);
    setHouse(null);
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  patch: (u, b) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
};

/** Download the Excel export: a normal link on the web, a short-lived link in the system browser on mobile. */
export async function downloadExport() {
  if (!isNative) {
    window.location.href = `${API_BASE}/api/export.xlsx${getHouse() ? `?house=${getHouse()}` : ''}`;
    return;
  }
  const { path } = await api.post('/export-link');
  const { openExternal } = await import('./platform.js');
  await openExternal(`${API_BASE}${path}`);
}
