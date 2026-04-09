'use client';

import { useMemo, useState } from 'react';
import { hubFetch, readJwtClaims } from './hubClientUtils';

const defaultForm = {
  email: '',
  password: '',
};

export default function HubAuthPanel({
  apiBase,
  token,
  onAuthenticated,
  onSignedOut,
  audience = 'advertiser',
  /** When true and signed in, only the header + sign out show (no duplicate summary). */
  hideSignedInSummary = false,
}) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const claims = useMemo(() => readJwtClaims(token), [token]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (mode === 'reset') {
        const response = await hubFetch(apiBase, '', '/api/users/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email: form.email }),
        });
        setMessage(response.message || 'Reset email requested.');
        return;
      }

      const path = mode === 'register' ? '/api/users/register' : '/api/users/login';
      const response = await hubFetch(apiBase, '', path, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (!response.token) {
        throw new Error('Authentication succeeded but no token was returned.');
      }
      onAuthenticated(response.token);
      setForm(defaultForm);
      setMessage(mode === 'register' ? 'Account created and signed in.' : 'Signed in successfully.');
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hub-card">
      <div className="hub-card-head">
        <div>
          <h2>{audience === 'admin' ? 'Admin sign-in' : 'Sign in'}</h2>
          <p>
            {audience === 'admin'
              ? 'Use your PlayPlace Finder email and password for admin access.'
              : 'Use your PlayPlace Finder email and password to manage your business information and ads.'}
          </p>
        </div>
        {token ? (
          <button type="button" className="btn btn-outline hub-btn-dark" onClick={onSignedOut}>
            Sign out
          </button>
        ) : null}
      </div>

      {token && !hideSignedInSummary ? (
        <div className="hub-summary">
          <div><strong>Signed in as:</strong> {claims?.email || claims?.user_id || 'Authenticated user'}</div>
          {audience === 'admin' ? (
            <>
              <div><strong>User ID:</strong> {claims?.user_id || claims?.sub || 'Unknown'}</div>
              <div><strong>Admin access:</strong> {claims?.admin ? 'Yes' : 'No'}</div>
            </>
          ) : (
            <div>You are ready to create and manage advertising drafts from this account.</div>
          )}
        </div>
      ) : null}
      {!token ? (
        <>
          <div className="hub-tab-row">
            <button type="button" className={`hub-tab ${mode === 'login' ? 'hub-tab--active' : ''}`} onClick={() => setMode('login')}>Sign in</button>
            <button type="button" className={`hub-tab ${mode === 'register' ? 'hub-tab--active' : ''}`} onClick={() => setMode('register')}>Create account</button>
            <button type="button" className={`hub-tab ${mode === 'reset' ? 'hub-tab--active' : ''}`} onClick={() => setMode('reset')}>Reset password</button>
          </div>
          <form className="hub-form-grid hub-form-grid--tight" onSubmit={submit}>
            <label className="hub-field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>
            {mode !== 'reset' ? (
              <label className="hub-field">
                <span>Password</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  required
                />
              </label>
            ) : null}
            <div className="hub-actions-inline hub-field--full">
              <button type="submit" className="btn btn-teal" disabled={busy}>
                {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {message ? <p className="hub-feedback hub-feedback--good">{message}</p> : null}
      {error ? <p className="hub-feedback hub-feedback--bad">{error}</p> : null}
    </section>
  );
}
