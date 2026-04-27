import Link from 'next/link';
import BrandMark from './BrandMark';
import NavSessionLinks from './NavSessionLinks';

/** Site-wide header: full brand lockup in nav (`playplace-app-icon.png`). */
export default function SiteNav() {
  return (
    <nav className="nav">
      <div className="container">
        <Link href="/" className="nav-logo">
          <BrandMark />
          <span className="nav-logo-text">Play Spotter</span>
        </Link>
        <div className="nav-links">
          <Link href="/discover">Discover</Link>
          <Link href="/map">Map</Link>
          <Link href="/events">Events</Link>
          <Link href="/lists">Lists</Link>
          <Link href="/activity">Activity</Link>
          <Link href="/advertise">Advertise</Link>
          <Link href="/support">Support</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <NavSessionLinks />
        </div>
      </div>
    </nav>
  );
}
