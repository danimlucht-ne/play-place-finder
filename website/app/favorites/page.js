'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SiteNav from '../components/SiteNav';

/** Favorites are merged into Saved. Static export cannot use server `redirect()`. */
export default function FavoritesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/lists?tab=favorites');
  }, [router]);
  return (
    <>
      <SiteNav />
      <div className="container hub-page" style={{ paddingTop: 24 }}>
        <p className="hub-muted-copy" style={{ textAlign: 'center' }}>Taking you to Saved…</p>
      </div>
    </>
  );
}
