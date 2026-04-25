import SiteNav from '../components/SiteNav';
import AccountWorkspaceClient from '../components/AccountWorkspaceClient';

export const metadata = {
  title: 'Login - Play Spotter',
  description: 'Sign in to manage your Play Spotter account, ads, and admin tools.',
};

export default function LoginPage() {
  return (
    <>
      <SiteNav />
      <AccountWorkspaceClient />
    </>
  );
}
