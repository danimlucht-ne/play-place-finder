'use client';

export const WEB_AUTH_EVENT = 'playplace-web-auth-change';

const DEFAULT_LOCAL_API_BASE = 'http://localhost:3001';
const DEFAULT_PRODUCTION_API_BASE = 'https://api.play-spotter.com';
const AUTH_STORAGE_KEY = 'playplace-web-auth-token';
const API_BASE_STORAGE_KEY = 'playplace-web-api-base';
const LEGACY_AUTH_KEYS = ['playplace-advertiser-token', 'playplace-admin-token'];

function isLocalHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function resolveDefaultApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return String(process.env.NEXT_PUBLIC_API_BASE_URL).trim().replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && isLocalHostname(window.location.hostname)) {
    return DEFAULT_LOCAL_API_BASE;
  }
  return DEFAULT_PRODUCTION_API_BASE;
}

export function getApiBase() {
  if (typeof window === 'undefined') return resolveDefaultApiBase();
  const stored = window.localStorage.getItem(API_BASE_STORAGE_KEY);
  return String(stored || resolveDefaultApiBase()).trim().replace(/\/+$/, '');
}

export function saveApiBase(apiBase) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(API_BASE_STORAGE_KEY, String(apiBase || resolveDefaultApiBase()).trim().replace(/\/+$/, ''));
}

export function getAuthToken() {
  if (typeof window === 'undefined') return '';
  const token = window.localStorage.getItem(AUTH_STORAGE_KEY) || '';
  if (token) return token;
  for (const key of LEGACY_AUTH_KEYS) {
    const legacyToken = window.localStorage.getItem(key);
    if (legacyToken) return legacyToken;
  }
  return '';
}

export function setAuthToken(token) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, String(token || '').trim());
  window.dispatchEvent(new CustomEvent(WEB_AUTH_EVENT));
}

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  for (const key of LEGACY_AUTH_KEYS) {
    window.localStorage.removeItem(key);
  }
  window.dispatchEvent(new CustomEvent(WEB_AUTH_EVENT));
}

export function readJwtClaims(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = typeof window !== 'undefined'
      ? window.atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (_) {
    return null;
  }
}

export async function webFetch(path, options = {}) {
  const apiBase = getApiBase();
  const token = options.token ?? getAuthToken();
  const headers = new Headers(options.headers || {});
  if (!options.isFormData) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: options.signal,
    });
  } catch (_) {
    throw new Error(`Could not reach the Play Spotter server at ${apiBase}.`);
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
      || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}
