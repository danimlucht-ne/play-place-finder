import SiteNav from '../components/SiteNav';
import AdvertiserHubClient from '../components/AdvertiserHubClient';

export const metadata = {
  title: 'Advertiser Hub - Play Spotter',
  description: 'Dedicated advertiser dashboard for business details, ad drafts, submissions, and campaign updates.',
};

export default function AdvertiserHubPage() {
  return (
    <>
      <SiteNav />
      <AdvertiserHubClient />
    </>
  );
}
