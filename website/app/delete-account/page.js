import Link from 'next/link';
import SiteNav from '../components/SiteNav';
import FooterCreditBanner from '../components/FooterCreditBanner';

export const metadata = {
  title: 'Delete your account - Play Spotter',
  description:
    'How to delete your Play Spotter account and associated data on the web or in the mobile app.',
};

export default function DeleteAccountPage() {
  return (
    <>
      <SiteNav />

      <main className="container hub-page">
        <section className="hub-hero">
          <div>
            <p className="hub-eyebrow">Account</p>
            <h1>Delete your account</h1>
            <p className="hub-lead">
              You can delete your Play Spotter account after you sign in—on the web at{' '}
              <Link href="/account/">My account</Link> or in the mobile app. No separate form or email is required.
            </p>
          </div>
        </section>

        <section className="hub-card">
          <h2>Steps</h2>
          <ol style={{ marginLeft: '1.25rem', lineHeight: 1.7 }}>
            <li>
              <strong>Web:</strong> Go to <Link href="/account/">My account</Link>, sign in, then use <strong>Delete my account</strong> under Profile.
            </li>
            <li>
              <strong>App:</strong> Open the Play Spotter app and sign in, open Support from the menu, then tap <strong>Delete my account</strong> and confirm.
            </li>
          </ol>
          <p className="hub-muted-copy" style={{ marginTop: '1rem' }}>
            This removes your account, favorites, lists, and associated personal data handled by our servers, subject to any limited retention described in our{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </main>

      <footer className="footer">
        <div className="container">
          <FooterCreditBanner />
          <div className="footer-links">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/delete-account">Delete account</Link>
            <Link href="/advertise">Advertise</Link>
            <Link href="/">Home</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} Lucht Applications LLC — Play Spotter</p>
        </div>
      </footer>
    </>
  );
}
