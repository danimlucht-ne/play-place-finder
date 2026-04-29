import SiteNav from './SiteNav';

export default function ConsumerPageFrame({ title, subtitle, children, heroVariant = 'compact' }) {
  const heroClass = heroVariant === 'tall' ? 'hero hero--tall' : 'hero hero--compact';
  return (
    <>
      <SiteNav />
      <section className={heroClass}>
        <div className="container">
          <h1>{title}</h1>
          {subtitle != null && subtitle !== '' && (
            <p className="hero-subtitle">{subtitle}</p>
          )}
        </div>
      </section>
      <div className="container hub-page">{children}</div>
    </>
  );
}
