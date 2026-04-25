import SiteNav from '../components/SiteNav';
import AdminHubClient from '../components/AdminHubClient';

export const metadata = {
  title: 'Advertising Admin Hub - Play Spotter',
  description: 'Web hub for admin review, campaign lifecycle actions, and payment lookups.',
};

export default function AdminHubPage() {
  return (
    <>
      <SiteNav />
      <AdminHubClient />
    </>
  );
}
