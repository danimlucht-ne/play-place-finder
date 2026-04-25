import SiteNav from '../components/SiteNav';
import AccountWorkspaceClient from '../components/AccountWorkspaceClient';

export const metadata = {
  title: 'My account - Play Spotter',
  description:
    'Sign in to Play Spotter, manage your profile, open advertiser or admin tools, or delete your account.',
};

export default function AccountPage() {
  return (
    <>
      <SiteNav />
      <AccountWorkspaceClient />
    </>
  );
}
