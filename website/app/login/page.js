import SiteNav from '../components/SiteNav';
import AccountWorkspaceClient from '../components/AccountWorkspaceClient';

export const metadata = {
  title: 'Login - PlayPlace Finder',
  description: 'Sign in to manage your PlayPlace Finder account, ads, and admin tools.',
};

export default function LoginPage() {
  return (
    <>
      <SiteNav />
      <AccountWorkspaceClient />
    </>
  );
}
