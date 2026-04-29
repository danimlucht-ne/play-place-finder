/** Icon-only brand mark for nav/hero to remain visible on small screens. */
export default function BrandMark({ className = 'nav-logo-mark' }) {
  return (
    <img
      className={className}
      src="/playplace-app-icon.png"
      alt="Play Spotter"
      width={192}
      height={192}
      decoding="async"
    />
  );
}
