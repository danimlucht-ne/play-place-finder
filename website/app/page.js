import Link from 'next/link';
import SiteNav from './components/SiteNav';
import FooterCreditBanner from './components/FooterCreditBanner';

export default function Home() {
  return (
    <>
      <SiteNav />

      {/* Hero */}
      <section className="hero">
        <div className="container">
          <h1>Find Kid-Friendly Play Places Near You</h1>
          <p>Discover playgrounds, indoor play areas, parks, and family-friendly activities — all community-verified and free to use.</p>
          <div className="hero-badges">
            <a href="https://play.google.com/store" className="btn btn-primary">Get it on Google Play</a>
            <Link href="/discover" className="btn btn-outline">Open web app</Link>
            <span className="btn btn-outline" style={{ cursor: 'default', opacity: 0.7 }}>Coming Soon to iOS</span>
          </div>
        </div>
      </section>

      <section className="photo-strip" aria-label="Example play places">
        <div className="container photo-strip-head">
          <h2 className="photo-strip-title">Real play places for every kind of outing</h2>
          <p className="photo-strip-sub">
            Browse indoor and outdoor spots, free neighborhood favorites, and paid destinations families can explore all year.
          </p>
        </div>
        <div className="photo-strip-grid">
          <figure className="photo-strip-card">
            <img src="/media/playground-1.jpg" alt="Indoor play area with colorful equipment" loading="lazy" decoding="async" width={900} height={600} />
          </figure>
          <figure className="photo-strip-card">
            <img src="/media/playground-2.jpg" alt="Outdoor playground with bright play equipment" loading="lazy" decoding="async" width={900} height={600} />
          </figure>
          <figure className="photo-strip-card">
            <img src="/media/playground-3.jpg" alt="Swing set at an outdoor playground" loading="lazy" decoding="async" width={900} height={600} />
          </figure>
        </div>
        <p className="photo-strip-credit container">
          Website photos: selected play-space scenes from{' '}
          <a href="https://unsplash.com/license" rel="noopener noreferrer">Unsplash</a>. The app shows community-contributed photos for listings near you.
        </p>
      </section>

      {/* Features */}
      <section className="features">
        <div className="container">
          <h2>Why Families Love Play Spotter</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="emoji">📍</div>
              <h3>Search by Location</h3>
              <p>Find play places within miles of you. Parks, indoor play, museums, splash pads, and more — all in one app.</p>
            </div>
            <div className="feature-card">
              <div className="emoji">🎯</div>
              <h3>Filter by What Matters</h3>
              <p>Bathrooms? Shade? Fenced? Toddler-friendly? Filter by amenities, equipment, cost, and location type.</p>
            </div>
            <div className="feature-card">
              <div className="emoji">✅</div>
              <h3>Community Verified</h3>
              <p>Real parents verify and rate places. See what's actually there — not just what Google says.</p>
            </div>
            <div className="feature-card">
              <div className="emoji">🗺️</div>
              <h3>Interactive Map</h3>
              <p>See all play places on a map. Tap a pin to get details, directions, and photos.</p>
            </div>
            <div className="feature-card">
              <div className="emoji">📸</div>
              <h3>Real Photos</h3>
              <p>AI-validated photos from the community. See what the playground actually looks like before you go.</p>
            </div>
            <div className="feature-card">
              <div className="emoji">❤️</div>
              <h3>Favorites & Lists</h3>
              <p>Save your go-to spots. Create custom lists like "Rainy Day Indoor" or "Birthday Party Venues."</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="home-cta-band">
        <div className="container">
          <h2>Ready to find your next adventure?</h2>
          <p>Download Play Spotter and start exploring.</p>
          <a href="https://play.google.com/store" className="btn btn-primary">Download Free on Google Play</a>
        </div>
      </section>

      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <FooterCreditBanner />
        <div className="footer-links">
          <Link href="/discover">Discover</Link>
          <Link href="/map">Map</Link>
          <Link href="/events">Events</Link>
          <Link href="/lists">Lists</Link>
          <Link href="/support">Support</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/delete-account">Delete account</Link>
          <Link href="/advertise">Advertise</Link>
          <Link href="/advertiser-agreement">Advertiser Agreement</Link>
        </div>
        <p>&copy; {new Date().getFullYear()} Lucht Applications LLC — Play Spotter</p>
        <p style={{ marginTop: '4px' }}>playplacefinder@gmail.com</p>
      </div>
    </footer>
  );
}

