/** App icon for nav/hero — `playplace-app-icon.png` from `syncWebsiteAppIcon` (branding pack 1024 layers when present). */
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
