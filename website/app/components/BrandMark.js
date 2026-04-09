/** Same asset as Android adaptive launcher (`playplace-app-icon.png` from `syncWebsiteAppIcon.js`). */
export default function BrandMark({ className = 'nav-logo-mark', width = 46, height = 46 }) {
  return (
    <img
      className={className}
      src="/playplace-app-icon.png"
      alt=""
      width={width}
      height={height}
      decoding="async"
    />
  );
}
