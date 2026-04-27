import Link from 'next/link';
import SiteNav from '../components/SiteNav';
import FooterCreditBanner from '../components/FooterCreditBanner';

export const metadata = {
  title: 'Advertise Your Business — Play Spotter',
  description: 'Reach local families with targeted advertising on Play Spotter. Regional rates for Prime, Inline, and Event packages — see live pricing in the app after you sign in.',
};

const packageCards = [
  {
    badge: 'Most Popular',
    badgeClass: 'badge-teal',
    title: 'Prime Placement',
    price: 'Regional rate',
    duration: '30-day campaign (multi-month discounts in app)',
    copy: 'The top sponsored row on Home (above “Popular near you”) for your market. If several businesses run prime ads, Home can rotate between them in that same row — open the app for your city’s current price.',
    features: ['Home hero placement', 'Strong for brand awareness', 'Prepay 1–6 months with bundle savings in app'],
  },
  {
    badge: 'Great Value',
    badgeClass: 'badge-sky',
    title: 'Inline Listing',
    price: 'Regional rate',
    duration: '30-day campaign (multi-month discounts in app)',
    copy: 'Sponsored rows in discovery and list-style search, typically about every 5–8 organic results. Pricing is set per region — check the app for your area.',
    features: ['Native list cards', 'Always-on visibility in browse/search', 'Flexible for most local businesses'],
  },
  {
    badge: 'Event',
    badgeClass: 'badge-amber',
    title: 'Event Spotlight',
    price: 'From app (7 or 14 days)',
    duration: 'List & calendar, or add Home prime',
    copy: 'Time-limited events with an Event label. Run in list and Events near you, or choose “Home prime + list” for the hero row plus the same event in lists. Short-run price is derived from your region’s monthly rates — see checkout in the app.',
    features: ['7- or 14-day runs', 'Optional Home prime + list', 'Event badge and dates in the UI'],
  },
];

const faqItems = [
  {
    question: 'How does targeting work?',
    answer:
      'Your ad reaches users within a radius of your business location. The base 20-mile radius is included free. You can extend to 30, 40, or 50 miles for an additional fee.',
  },
  {
    question: 'Can I cancel my campaign?',
    answer:
      'Yes. You can cancel anytime from the app. Once an ad has gone live, cancellation stops future delivery but we do not provide refunds for time you have already paid for. If an ad never goes live, refunds follow our Advertiser Agreement.',
  },
  {
    question: 'What content is allowed?',
    answer:
      'Every ad and every later edit must stay appropriate for parents and caregivers. We use automated checks and human review before a new or updated ad can replace an approved one. Play Spotter is not directed at children, and child accounts do not receive advertising.',
  },
  {
    question: 'Can I edit my ad after it goes live?',
    answer:
      'Yes. You can request changes from the advertiser dashboard at any time. If your ad is already live, the current approved version stays on screen while your updated copy, image, button text, link, or event details wait for review. Nothing new replaces the live ad until the updated version is approved.',
  },
  {
    question: 'How do I track performance?',
    answer:
      'The advertiser dashboard shows impressions, taps on your ad, and how often an impression led to a tap, with daily breakdowns.',
  },
];

export default function Advertise() {
  return (
    <>
      <SiteNav />

      <section className="advertise-hero">
        <div className="container advertise-hero__grid">
          <div className="advertise-hero__content">
            <p className="advertise-eyebrow">Family-friendly advertising</p>
            <h1>Reach Local Families</h1>
            <p className="advertise-hero__lede">
              Promote your family-friendly business to parents already looking for places to visit, book, and recommend in your area.
            </p>
            <div className="advertise-hero__actions">
              <Link href="/advertiser-hub" className="btn btn-teal">Open advertiser dashboard</Link>
              <a href="#advertising-packages" className="btn advertise-btn-secondary">See advertising options</a>
            </div>
            <div className="advertise-hero__chips">
              <span>Reviewed before launch</span>
              <span>Local radius targeting</span>
              <span>Prime, inline, and event options</span>
            </div>
          </div>

          <aside className="advertise-hero__panel">
            <div className="advertise-hero__panel-card">
              <p className="advertise-panel-label">Already advertising with us?</p>
              <h2>Jump back into your dashboard</h2>
              <p>
                View campaigns, request updates, check performance, and keep your approved ads current without digging through the marketing page.
              </p>
              <Link href="/advertiser-hub" className="btn btn-teal">Go to my ads</Link>
            </div>
            <div className="advertise-hero__stats">
              <div>
                <strong>3</strong>
                <span>Ad formats</span>
              </div>
              <div>
                <strong>20+</strong>
                <span>Miles included</span>
              </div>
              <div>
                <strong>1</strong>
                <span>Prime slot per city</span>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="advertise-marquee">
        <div className="container advertise-marquee__grid">
          <div className="advertise-marquee__copy">
            <p className="advertise-eyebrow">Why businesses use it</p>
            <h2>Built for the moments parents are deciding where to go next</h2>
            <p>
              Play Spotter reaches adults actively planning outings. That means your ad is shown in context, not dropped into a random audience that never intended to visit in the first place.
            </p>
          </div>
          <div className="advertise-marquee__cards">
            <article>
              <h3>Discovery-first</h3>
              <p>Appear where families browse play spots, classes, dining, and events.</p>
            </article>
            <article>
              <h3>Clear review process</h3>
              <p>Ads and later edits are checked before anything new replaces an approved version.</p>
            </article>
            <article>
              <h3>Simple repeat buying</h3>
              <p>Return advertisers get easy dashboard access and a 20% code after a completed campaign.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="photo-strip photo-strip--compact" aria-label="Example play places">
        <div className="photo-strip-head">
          <h2 className="photo-strip-title">The kinds of destinations families are already exploring</h2>
          <p className="photo-strip-sub">
            Indoor play, outdoor playgrounds, swings, events, and local family destinations all live side by side in the discovery flow.
          </p>
        </div>
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

      <section id="advertising-packages" className="packages packages--tinted advertise-packages">
        <div className="container">
          <p className="advertise-eyebrow advertise-eyebrow--center">Choose your placement</p>
          <h2>Advertising Packages</h2>
          <p className="subtitle">
            Pick the format that fits your goal. All packages include radius-based targeting and family-friendly review.
          </p>
          <div className="packages-grid advertise-packages__grid">
            {packageCards.map((card) => (
              <article key={card.title} className="package-card advertise-package-card">
                <span className={`badge ${card.badgeClass}`}>{card.badge}</span>
                <h3>{card.title}</h3>
                <div className="price">{card.price}</div>
                <div className="duration">{card.duration}</div>
                <p>{card.copy}</p>
                <ul className="advertise-package-card__list">
                  {card.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="advertise-loyalty-band">
        <div className="container advertise-loyalty-band__inner">
          <div>
            <p className="advertise-eyebrow">Built for repeat advertisers</p>
            <h2>Advertise again for less</h2>
          </div>
          <p>
            After your first campaign completes, we email you a 20% discount code to use on your next campaign.
          </p>
        </div>
      </section>

      <section className="howitworks advertise-flow">
        <div className="container">
          <div className="howitworks-intro">
            <p className="advertise-eyebrow advertise-eyebrow--center">From first setup to live placement</p>
            <h2>How it works</h2>
            <p>
              From signup to live placements on Home (featured card), in Find Play Places, and Events near you — built for busy local businesses and parents discovering places to play.
            </p>
          </div>
          <div className="howitworks-grid">
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">1</span>
              </div>
              <h3>Tell us about your business</h3>
              <p>Name, category, city, and contact — about two minutes in the app.</p>
              <span className="hiw-accent">No long contracts</span>
            </div>
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">2</span>
              </div>
              <h3>Choose package &amp; radius</h3>
              <p>Prime placement, inline listings, or a short event spotlight — plus a clear map of which regions see your ad.</p>
              <span className="hiw-accent">Transparent reach</span>
            </div>
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">3</span>
              </div>
              <h3>Create your creative</h3>
              <p>Image, headline, body copy, and a destination link with optional short button text — tuned for parents browsing on the go.</p>
              <span className="hiw-accent">You control the story</span>
            </div>
            <div className="hiw-card">
              <div className="hiw-card-top">
                <span className="hiw-step-num" aria-hidden="true">4</span>
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

      <section className="faq advertise-faq">
        <div className="container">
          <p className="advertise-eyebrow advertise-eyebrow--center">Questions businesses ask most</p>
          <h2>Frequently Asked Questions</h2>
          <div className="advertise-faq__grid">
            {faqItems.map((item) => (
              <div key={item.question} className="faq-item">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="contact advertise-contact">
        <div className="container advertise-contact__grid">
          <div className="advertise-contact__copy">
            <p className="advertise-eyebrow">Need help before you launch?</p>
            <h2>Interested? Get in Touch</h2>
            <p className="subtitle">
              Tell us what you want to promote and we can help you choose the best placement for your goal.
            </p>
            <div className="advertise-contact__notes">
              <div>
                <strong>Best for</strong>
                <span>Family entertainment, dining, indoor play, classes, seasonal events, and destination businesses</span>
              </div>
              <div>
                <strong>Good to include</strong>
                <span>Your city, business type, timing, and whether you want prime, inline, or event placement</span>
              </div>
            </div>
          </div>
          <div className="contact-form advertise-contact__form">
            <input type="text" placeholder="Business Name" />
            <input type="email" placeholder="Email Address" />
            <textarea placeholder="Tell us about your business and what you're looking to promote..." />
            <a href="mailto:playplacefinder@gmail.com?subject=Advertising%20Inquiry" className="btn btn-teal" style={{ width: '100%', justifyContent: 'center' }}>
              Send Inquiry
            </a>
            <p style={{ textAlign: 'center', fontSize: '13px', color: '#587072', marginTop: '8px' }}>
              Or email us directly at playplacefinder@gmail.com
            </p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <FooterCreditBanner />
          <div className="footer-links">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/">Home</Link>
            <Link href="/advertiser-agreement">Advertiser Agreement</Link>
            <Link href="/admin-hub">Admin Sign In</Link>
          </div>
          <p>&copy; {new Date().getFullYear()} Lucht Applications LLC — Play Spotter</p>
        </div>
      </footer>
    </>
  );
}
