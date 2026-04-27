/** Icon-only brand mark for nav/hero to remain visible on small screens. */
export default function BrandMark({ className = 'nav-logo-mark' }) {
  return (
    <img
      className={className}
      src="/play-spotter-favicon.png"
      alt="Play Spotter"
      decoding="async"
    />
  );
}
