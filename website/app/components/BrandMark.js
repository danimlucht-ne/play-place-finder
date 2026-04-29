/** Dedicated website header lockup; favicon stays separate. */
export default function BrandMark({ className = 'nav-logo-mark' }) {
  return (
    <img
      className={className}
      src="/play-spotter-nav-logo.png"
      alt="Play Spotter"
      decoding="async"
    />
  );
}
