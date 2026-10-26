// Differences between the website and the iOS/Android apps live here.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'

/**
 * Where the API lives. The website talks to its own origin (''). The native apps
 * are served from capacitor://localhost, so they need the hosted URL, baked in at
 * build time: VITE_API_URL=https://your-app.vercel.app npm run build:mobile
 */
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Public web address used for invite links (so they open in a browser, not capacitor://). */
export const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL || API_BASE || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');

const TOKEN_KEY = 'hearth-token';
let cachedToken = null;
let tokenLoaded = !isNative;

/** Session token for native apps (the website uses an httpOnly cookie instead). */
export async function getToken() {
  if (!tokenLoaded) {
    const { Preferences } = await import('@capacitor/preferences');
    cachedToken = (await Preferences.get({ key: TOKEN_KEY })).value;
    tokenLoaded = true;
  }
  return cachedToken;
}

export async function setToken(token) {
  if (!isNative) return;
  cachedToken = token || null;
  tokenLoaded = true;
  const { Preferences } = await import('@capacitor/preferences');
  if (token) await Preferences.set({ key: TOKEN_KEY, value: token });
  else await Preferences.remove({ key: TOKEN_KEY });
}

/** Open a URL outside the app (system browser), or in a new tab on the web. */
export async function openExternal(url) {
  if (isNative) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
