'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  HUB_AUTH_EVENT,
  clearSharedAuthSession,
  loadHubSettings,
  readJwtClaims,
} from './hubClientUtils';

function readSessionState() {
  const adminSettings = loadHubSettings('admin');
  const advertiserSettings = loadHubSettings('advertiser');
  const adminClaims = readJwtClaims(adminSettings.token);
  const advertiserClaims = readJwtClaims(advertiserSettings.token);
  const adminToken = adminClaims?.admin ? adminSettings.token : '';
  const userToken = advertiserSettings.token || adminSettings.token || '';

  return {
    isAdmin: Boolean(adminToken),
    isLoggedIn: Boolean(userToken),
  };
}

export default function NavSessionLinks() {
  const [session, setSession] = useState({ isAdmin: false, isLoggedIn: false });

  useEffect(() => {
    function syncSession() {
      setSession(readSessionState());
    }

    syncSession();
    window.addEventListener('storage', syncSession);
    window.addEventListener(HUB_AUTH_EVENT, syncSession);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener(HUB_AUTH_EVENT, syncSession);
    };
  }, []);

  return (
    <>
      {session.isAdmin ? <Link href="/admin-hub">Admin</Link> : null}
      {session.isLoggedIn && !session.isAdmin ? <Link href="/advertiser-hub">My Ads</Link> : null}
      {session.isLoggedIn ? <Link href="/favorites">Favorites</Link> : null}
      {session.isLoggedIn ? <Link href="/account">Account</Link> : null}
      {session.isLoggedIn ? (
        <button type="button" className="nav-auth-btn" onClick={clearSharedAuthSession}>
          Sign out
        </button>
      ) : (
        <Link href="/account" className="nav-login-link">Login</Link>
      )}
    </>
  );
}
