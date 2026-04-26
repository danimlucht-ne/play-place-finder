'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { WEB_AUTH_EVENT, getAuthToken, readJwtClaims } from './webAuthClient';

export default function AuthGate({ children, requireAdmin = false }) {
  const [token, setToken] = useState('');

  useEffect(() => {
    function syncToken() {
      setToken(getAuthToken());
    }
    syncToken();
    window.addEventListener('storage', syncToken);
    window.addEventListener(WEB_AUTH_EVENT, syncToken);
    return () => {
      window.removeEventListener('storage', syncToken);
      window.removeEventListener(WEB_AUTH_EVENT, syncToken);
    };
  }, []);

  const claims = useMemo(() => readJwtClaims(token), [token]);
  const isAuthed = Boolean(token);
  const isAllowed = requireAdmin ? Boolean(claims?.admin) : isAuthed;

  if (!isAuthed) {
    return (
      <section className="hub-card container" style={{ marginTop: '20px' }}>
        <h2>Sign in required</h2>
        <p className="hub-muted-copy">Please sign in to access this page.</p>
        <Link href="/account" className="btn btn-teal">Go to account</Link>
      </section>
    );
  }

  if (!isAllowed) {
    return (
      <section className="hub-card container" style={{ marginTop: '20px' }}>
        <h2>Access restricted</h2>
        <p className="hub-muted-copy">This page is available to admin accounts only.</p>
        <Link href="/account" className="btn btn-outline hub-btn-dark">Back to account</Link>
      </section>
    );
  }

  return children;
}
