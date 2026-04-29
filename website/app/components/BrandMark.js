/** Website header uses the square app icon; favicon stays separate. */
export default function BrandMark({ className = 'nav-logo-mark' }) {
  return (
    <img
      className={className}
      src="/play-spotter-site-icon.png"
      alt="Play Spotter"
      decoding="async"
    />
  );
}
