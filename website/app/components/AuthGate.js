'use client';

import Link from 'next/link';
import useAuthSession from './useAuthSession';

export default function AuthGate({ children, requireAdmin = false }) {
  const session = useAuthSession();
  const isAuthed = session.isLoggedIn;
  const isAllowed = requireAdmin ? session.isAdmin : isAuthed;

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
