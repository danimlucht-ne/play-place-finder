import SiteNav from '../components/SiteNav';
import AdminHubClient from '../components/AdminHubClient';
import AuthGate from '../components/AuthGate';

export const metadata = {
  title: 'Advertising Admin Hub - Play Spotter',
  description: 'Web hub for admin review, campaign lifecycle actions, and payment lookups.',
};

export default function AdminHubPage() {
  return (
    <>
      <SiteNav />
      <AuthGate requireAdmin>
        <AdminHubClient />
      </AuthGate>
    </>
  );
}
