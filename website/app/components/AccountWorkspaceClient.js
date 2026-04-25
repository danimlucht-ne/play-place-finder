'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import HubAuthPanel from './HubAuthPanel';
import {
  clearSharedAuthSession,
  getDefaultApiBase,
  hubFetch,
  loadHubSettings,
  readJwtClaims,
  saveSharedAuthSession,
} from './hubClientUtils';

export default function AccountWorkspaceClient() {
  const [apiBase, setApiBase] = useState(getDefaultApiBase());
  const [token, setToken] = useState('');
  const [banner, setBanner] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const settings = loadHubSettings('advertiser');
    setApiBase(settings.apiBase);
    setToken(settings.token);
  }, []);

  const claims = useMemo(() => readJwtClaims(token), [token]);

  async function handleAuthenticated(nextToken) {
    saveSharedAuthSession(apiBase, nextToken);
    setToken(nextToken);
    setDeleteError('');
  }

  function handleSignedOut() {
    clearSharedAuthSession();
    setToken('');
    setBanner('');
    setDeleteError('');
  }

  async function deleteAccount() {
    if (
      !window.confirm(
        'Delete your account permanently? This removes favorites, lists, and associated personal data. This cannot be undone.',
      )
    ) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await hubFetch(apiBase, token, '/api/account', { method: 'DELETE' });
      clearSharedAuthSession();
      setToken('');
      setBanner('Your account has been deleted.');
    } catch (e) {
      setDeleteError(e.message || 'Deletion failed.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="container hub-page">
      <section className="hub-hero">
        <div>
          <p className="hub-eyebrow">Account access</p>
          <h1>My account</h1>
          <p className="hub-lead">
            Sign in with your Play Spotter email and password. When you are signed in, your profile appears below,
            including account deletion. Advertisers and admins can open their dashboards from here too.
          </p>
        </div>
        <div className="hub-tip-card">
          <h2>What you can do</h2>
          <ul>
            <li>Manage sign-in, registration, and password reset</li>
            <li>See your account details and delete your account</li>
            <li>Jump to the advertiser dashboard or admin workspace</li>
          </ul>
        </div>
      </section>

      <HubAuthPanel
        apiBase={apiBase}
        token={token}
        onAuthenticated={handleAuthenticated}
        onSignedOut={handleSignedOut}
        audience="advertiser"
        hideSignedInSummary
      />

      {token ? (
        <section className="hub-card">
          <div className="hub-card-head">
            <div>
              <h2>Profile</h2>
              <p>Signed-in account used for the app, ads, and admin tools.</p>
            </div>
          </div>
          <div className="hub-summary">
            <div>
              <strong>Email:</strong> {claims?.email || claims?.user_id || '—'}
            </div>
            <div>
              <strong>User ID:</strong> {claims?.user_id || claims?.sub || '—'}
            </div>
            {claims?.admin ? (
              <div>
                <strong>Role:</strong> Admin
              </div>
            ) : null}
          </div>

          <div className="hub-actions-inline hub-field--full" style={{ marginTop: '1rem', flexWrap: 'wrap', gap: '12px' }}>
            {claims?.admin ? (
              <Link href="/admin-hub/" className="btn btn-teal">
                Open admin workspace
              </Link>
            ) : null}
            <Link href="/advertiser-hub/" className="btn btn-outline hub-btn-dark">
              Open advertiser dashboard
            </Link>
          </div>

          <hr
            style={{
              margin: '1.5rem 0',
              border: 'none',
              borderTop: '1px solid rgba(0, 0, 0, 0.08)',
            }}
          />

          <div className="hub-card-head" style={{ marginBottom: '0.5rem' }}>
            <div>
              <h2 style={{ color: 'var(--error-red)', fontSize: '1.1rem' }}>Delete account</h2>
              <p className="hub-muted-copy" style={{ marginTop: '0.35rem' }}>
                Permanently remove this account and associated personal data from Play Spotter (same action as in
                the mobile app under Support).
              </p>
            </div>
          </div>
          {deleteError ? <p className="hub-feedback hub-feedback--bad">{deleteError}</p> : null}
          <button
            type="button"
            className="btn btn-outline hub-btn-dark"
            style={{
              borderColor: 'var(--error-red)',
              color: 'var(--error-red)',
            }}
            onClick={deleteAccount}
            disabled={deleteBusy}
          >
            {deleteBusy ? 'Deleting…' : 'Delete my account'}
          </button>
        </section>
      ) : null}

      {banner ? (
        <section className="hub-card">
          <p className="hub-muted-copy">{banner}</p>
        </section>
      ) : null}
    </div>
  );
}
