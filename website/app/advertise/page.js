import Link from 'next/link';
import SiteNav from '../components/SiteNav';

export const metadata = {
  title: 'Advertise Your Business — PlayPlace Finder',
  description: 'Reach local families with targeted advertising on PlayPlace Finder. Three ad packages including short event runs from $12.',
};

export default function Advertise() {
  return (
    <>
      <SiteNav />

      {/* Hero */}
      <section className="hero hero--compact">
        <div className="container">
          <h1 style={{ fontSize: '36px' }}>Reach Local Families</h1>
          <p>Promote your family-friendly business to parents actively looking for places to visit in your area.</p>
        </div>
      </section>

      <section className="photo-strip photo-strip--compact" aria-label="Example play places">
        <div className="photo-strip-grid photo-strip-grid--three">
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
      </section>

      {/* Packages */}
      <section className="packages packages--tinted">
        <div className="container">
          <h2>Advertising Packages</h2>
          <p className="subtitle">Choose the package that works for your business. All packages include radius-based targeting.</p>
          <div className="packages-grid">
            <div className="package-card">
              <span className="badge badge-teal">Most Popular</span>
              <h3>Prime Placement</h3>
              <div className="price">$99/mo</div>
              <div className="duration">30-day campaign</div>
              <p>Your business featured prominently on the home screen. Maximum visibility — only 1 per city.</p>
            </div>
            <div className="package-card">
              <span className="badge badge-teal">Great Value</span>
              <h3>Inline Listing</h3>
              <div className="price">$39/mo</div>
              <div className="duration">30-day campaign</div>
              <p>Your business appears in search results alongside organic listings. Shown every 5-8 results.</p>
            </div>
            <div className="package-card">
              <span className="badge badge-amber">Event</span>
              <h3>Event Spotlight</h3>
              <div className="price">From $12</div>
              <div className="duration">7 or 14 days</div>
              <p>Promote a time-limited event with an Event badge. Perfect for festivals, classes, and seasonal activities.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Repeat advertisers */}
      <section style={{ padding: '40px 0', background: '#FFF3E0', textAlign: 'center' }}>
        <div className="container">
          <h2 style={{ fontSize: '24px', marginBottom: '12px' }}>Advertise again for less</h2>
          <p style={{ maxWidth: '600px', margin: '0 auto', color: '#795548' }}>
            After your first campaign completes, we email you a 20% discount code to use on your next campaign.
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="howitworks">
        <div className="container">
          <div className="howitworks-intro">
            <h2>How it works</h2>
            <p>
              From signup to live placements on the home carousel and in search-style results — built for busy local
              businesses and parents discovering places to play.
            </p>
          </div>
          <div className="howitworks-grid">
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">
                  1
                </span>
              </div>
              <h3>Tell us about your business</h3>
              <p>Name, category, city, and contact — about two minutes in the app.</p>
              <span className="hiw-accent">No long contracts</span>
            </div>
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">
                  2
                </span>
              </div>
              <h3>Choose package &amp; radius</h3>
              <p>Prime placement, inline listings, or a short event spotlight — plus a clear map of which regions see your ad.</p>
              <span className="hiw-accent">Transparent reach</span>
            </div>
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">
                  3
                </span>
              </div>
              <h3>Create your creative</h3>
              <p>Image, headline, body copy, and a destination link with optional short button text — tuned for parents browsing on the go.</p>
              <span className="hiw-accent">You control the story</span>
            </div>
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">
                  4
                </span>
              </div>
              <h3>Pay &amp; go live</h3>
              <p>
                Secure checkout with Stripe, a quick family-friendly review, then your ad goes live — often within a day.
                After your first campaign completes, we email a <strong>20% code</strong> for your next one.
              </p>
              <span className="hiw-accent">Loyalty built in</span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq">
        <div className="container">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-item">
            <h3>How does targeting work?</h3>
            <p>Your ad reaches users within a radius of your business location. The base 20-mile radius is included free. You can extend to 30, 40, or 50 miles for an additional fee.</p>
          </div>
          <div className="faq-item">
            <h3>Can I cancel my campaign?</h3>
            <p>
              Yes. You can cancel anytime from the app. Once an ad has gone live, cancellation stops future delivery but we do not provide refunds for time you have already paid for. If an ad never goes live, refunds follow our Advertiser Agreement.
            </p>
          </div>
          <div className="faq-item">
            <h3>What content is allowed?</h3>
            <p>
              All ads are reviewed for family-friendliness using AI. Businesses and messaging must be appropriate for parents and caregivers. PlayPlace Finder is not directed at children, and child accounts do not receive advertising.
            </p>
          </div>
          <div className="faq-item">
            <h3>Can I edit my ad after it goes live?</h3>
            <p>
              Yes. You can update your headline, description, image, call-to-action button label, and destination link from the advertiser dashboard. While your campaign is still scheduled or awaiting first go-live, edits go through review again before activation. After go-live, headline and body are re-checked automatically before they save; other fields update when you save. If a change must not appear until staff approves it, email playplacefinder@gmail.com.
            </p>
          </div>
          <div className="faq-item">
            <h3>How do I track performance?</h3>
            <p>
              The advertiser dashboard shows impressions, taps on your ad, and how often an impression led to a tap, with daily breakdowns.
            </p>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="contact">
        <div className="container">
          <h2>Interested? Get in Touch</h2>
          <p className="subtitle">Have questions about advertising? Drop us a line.</p>
          <div className="contact-form">
            <input type="text" placeholder="Business Name" />
            <input type="email" placeholder="Email Address" />
            <textarea placeholder="Tell us about your business and what you're looking to promote..."></textarea>
            <a href="mailto:playplacefinder@gmail.com?subject=Advertising%20Inquiry" className="btn btn-teal" style={{ width: '100%', justifyContent: 'center' }}>
              Send Inquiry
            </a>
            <p style={{ textAlign: 'center', fontSize: '13px', color: '#999', marginTop: '8px' }}>
              Or email us directly at playplacefinder@gmail.com
            </p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="footer-links">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/">Home</Link>
            <Link href="/advertiser-agreement">Advertiser Agreement</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} Lucht Applications LLC — PlayPlace Finder</p>
        </div>
      </footer>
    </>
  );
}
