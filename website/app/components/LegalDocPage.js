import Link from 'next/link';
import SiteNav from './SiteNav';
import { readLegalDoc } from '../../lib/readLegalDoc';
import LegalMarkdownBody from './LegalMarkdownBody';

const footerPresets = {
  standard: [
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms of Service' },
    { href: '/', label: 'Home' },
  ],
  withAdvertise: [
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms of Service' },
    { href: '/advertise', label: 'Advertise' },
    { href: '/', label: 'Home' },
  ],
};

export default async function LegalDocPage({ slug, footer = 'standard' }) {
  const { data, content } = readLegalDoc(slug);
  const links = footerPresets[footer] || footerPresets.standard;
  const versionPart = data.version != null && String(data.version).trim() !== '' ? ` · Version ${data.version}` : '';

  return (
    <>
      <SiteNav />

      <main className="legal-page">
        <div className="container legal">
          <h1>{data.title}</h1>
          <p className="updated">
            Last Updated: {data.lastUpdated}
            {versionPart}
          </p>
          <LegalMarkdownBody content={content} />
        </div>
      </main>

      <footer className="footer">
        <div className="container">
          <div className="footer-links">
            {links.map(({ href, label }) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </div>
          <p>&copy; {new Date().getFullYear()} Lucht Applications LLC — PlayPlace Finder</p>
        </div>
      </footer>
    </>
  );
}
