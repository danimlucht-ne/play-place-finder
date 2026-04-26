import SiteNav from './SiteNav';

export default function ConsumerPageFrame({ title, subtitle, children }) {
  return (
    <>
      <SiteNav />
      <section className="hero hero--compact">
        <div className="container">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </section>
      <div className="container hub-page">{children}</div>
    </>
  );
}
