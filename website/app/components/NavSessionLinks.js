'use client';

import Link from 'next/link';
import {
  clearSharedAuthSession,
} from './hubClientUtils';
import useAuthSession from './useAuthSession';

export default function NavSessionLinks() {
  const session = useAuthSession();

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
