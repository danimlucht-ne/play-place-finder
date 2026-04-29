'use client';

const DEFAULT_LOCAL_API_BASE = 'http://localhost:3001';
const DEFAULT_PRODUCTION_API_BASE = 'https://api.play-spotter.com';
export const HUB_AUTH_EVENT = 'playplace-auth-change';
/** Keep in sync with `webAuthClient` so consumer routes refresh after hub/account login. */
const WEB_AUTH_EVENT = 'playplace-web-auth-change';
const WEB_AUTH_TOKEN_KEY = 'playplace-web-auth-token';

function storageKey(kind, field) {
  return `playplace-${kind}-${field}`;
}

function notifyAuthChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HUB_AUTH_EVENT));
  window.dispatchEvent(new CustomEvent(WEB_AUTH_EVENT));
}

function isLocalHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function resolveDefaultApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  if (typeof window !== 'undefined' && isLocalHostname(window.location.hostname)) {
    return DEFAULT_LOCAL_API_BASE;
  }
  return DEFAULT_PRODUCTION_API_BASE;
}

function shouldReplaceStoredApiBase(apiBase) {
  if (typeof window === 'undefined') return false;
  if (isLocalHostname(window.location.hostname)) return false;
  return String(apiBase || '').includes('localhost:3001');
}

export function getDefaultApiBase() {
  return resolveDefaultApiBase();
}

export function normalizeApiBase(value) {
  return String(value || resolveDefaultApiBase()).trim().replace(/\/+$/, '');
}

export function loadHubSettings(kind) {
  const defaultApiBase = resolveDefaultApiBase();
  if (typeof window === 'undefined') {
    return { apiBase: defaultApiBase, token: '' };
  }
  const storedApiBase = window.localStorage.getItem(storageKey(kind, 'apiBase')) || defaultApiBase;
  const apiBase = shouldReplaceStoredApiBase(storedApiBase) ? defaultApiBase : storedApiBase;
  return {
    apiBase,
    token: window.localStorage.getItem(storageKey(kind, 'token')) || '',
  };
}

export function saveHubSettings(kind, settings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(kind, 'apiBase'), normalizeApiBase(settings.apiBase));
  window.localStorage.setItem(storageKey(kind, 'token'), String(settings.token || '').trim());
  notifyAuthChange();
}

export function clearHubSettings(kind) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(kind, 'apiBase'));
  window.localStorage.removeItem(storageKey(kind, 'token'));
  notifyAuthChange();
}

export function saveSharedAuthSession(apiBase, token) {
  saveHubSettings('advertiser', { apiBase, token });
  saveHubSettings('admin', { apiBase, token });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WEB_AUTH_TOKEN_KEY, String(token || '').trim());
  }
}

export function clearSharedAuthSession() {
  clearHubSettings('advertiser');
  clearHubSettings('admin');
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(WEB_AUTH_TOKEN_KEY);
  }
}

export async function hubFetch(apiBase, token, path, options = {}) {
  const base = normalizeApiBase(apiBase);
  const headers = new Headers(options.headers || {});
  if (!options.isFormData) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });
  } catch (error) {
    throw new Error(`Could not reach the Play Spotter server at ${base}.`);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = text;
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && (payload.error || payload.message))
      || (typeof payload === 'string' && payload)
      || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export function formatDateTime(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export function formatDateOnly(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

export function formatMoney(cents) {
  const amount = Number(cents || 0) / 100;
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

export function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('approve') || value === 'active' || value === 'scheduled') return 'good';
  if (value.includes('reject') || value === 'cancelled' || value === 'paused') return 'bad';
  if (value.includes('review') || value.includes('pending') || value.includes('revision')) return 'warn';
  return 'neutral';
}

/**
 * Pill class for the advertiser hub only — maps “active / scheduled / approved” to a teal
 * (brand-aligned) “live” chip instead of [statusTone]’s green “good” chip, which clashed
 * on campaign cards (see full-parity advertiser work).
 * @returns {'live' | 'good' | 'bad' | 'warn' | 'neutral'}
 */
export function hubAdvertiserPillClass(status) {
  const v = String(status || '').toLowerCase();
  if (v === 'active' || v === 'scheduled' || v === 'approved' || v === 'paid') return 'live';
  if (v === 'cancelled' || v === 'canceled' || v === 'rejected' || v === 'paused' || v === 'refunded') return 'bad';
  if (v.includes('review') || v.includes('revision') || v.includes('pending_')) return 'warn';
  if (v === 'draft' || v === 'pending' || v === 'completed' || v === 'unknown' || v === '') return 'neutral';
  if (v.includes('cancel')) return 'bad';
  if (v.includes('pending')) return 'warn';
  if (v.includes('approve') || v === 'live') return 'live';
  return statusTone(status);
}

export function readJwtClaims(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = typeof window !== 'undefined' ? window.atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

export async function resolveLoginDestination(apiBase, token) {
  const claims = readJwtClaims(token);
  if (claims?.admin === true) {
    return '/admin-hub';
  }
  return '/advertiser-hub';
}
