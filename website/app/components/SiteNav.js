import Link from 'next/link';
import BrandMark from './BrandMark';
import NavSessionLinks from './NavSessionLinks';

/** Site-wide header: website uses a dedicated nav lockup instead of the favicon icon. */
export default function SiteNav() {
  return (
    <nav className="nav">
      <div className="container">
        <Link href="/" className="nav-logo">
          <BrandMark />
        </Link>
        <div className="nav-links">
          <Link href="/discover">Discover</Link>
          <Link href="/map">Map</Link>
          <Link href="/events">Events</Link>
          <Link href="/lists">Lists</Link>
          <Link href="/advertise">Advertise</Link>
          <Link href="/support">Support</Link>
          <NavSessionLinks />
        </div>
      </div>
    </nav>
  );
}
