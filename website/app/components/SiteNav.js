import Link from 'next/link';
import BrandMark from './BrandMark';

/** Site-wide header: same composite as Android adaptive launcher (`playplace-app-icon.png`). */
export default function SiteNav() {
  return (
    <nav className="nav">
      <div className="container">
        <Link href="/" className="nav-logo">
          <BrandMark />
          <span className="nav-logo-text">PlayPlace Finder</span>
        </Link>
        <div className="nav-links">
          <Link href="/advertise">Advertise</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </div>
    </nav>
  );
}
