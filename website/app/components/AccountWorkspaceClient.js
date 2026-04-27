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
  const [verifyBusy, setVerifyBusy] = useState(false);

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

  async function resendVerification() {
    const email = claims?.email;
    if (!email) {
      setDeleteError('Could not determine email for verification.');
      return;
    }
    setVerifyBusy(true);
    setDeleteError('');
    try {
      const response = await hubFetch(apiBase, '', '/api/users/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setBanner(response.message || 'Verification email sent.');
    } catch (e) {
      setDeleteError(e.message || 'Could not resend verification email.');
    } finally {
      setVerifyBusy(false);
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
            <li>Open favorites, lists, and contribution tools on web</li>
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
              <strong>Email verified:</strong> {claims?.email_verified ? 'Yes' : 'No'}
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
            {!claims?.email_verified ? (
              <button type="button" className="btn btn-outline hub-btn-dark" disabled={verifyBusy} onClick={resendVerification}>
                {verifyBusy ? 'Sending verification…' : 'Resend verification email'}
              </button>
            ) : null}
            <Link href="/favorites/" className="btn btn-outline hub-btn-dark">
              Open favorites
            </Link>
            <Link href="/lists/" className="btn btn-outline hub-btn-dark">
              Open saved lists
            </Link>
            <Link href="/add-playground/" className="btn btn-outline hub-btn-dark">
              Suggest a place
            </Link>
            <Link href="/my-submissions/" className="btn btn-outline hub-btn-dark">
              My submissions
            </Link>
            <Link href="/activity/" className="btn btn-outline hub-btn-dark">
              My activity
            </Link>
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
