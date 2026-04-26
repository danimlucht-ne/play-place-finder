/** Full lockup for nav/hero (`playplace-app-icon.png` from `syncWebsiteAppIcon` — prefers `playSpotterLogo`). */
export default function BrandMark({ className = 'nav-logo-mark' }) {
  return (
    <img
      className={className}
      src="/playplace-app-icon.png"
      alt="Play Spotter"
      decoding="async"
    />
  );
}
