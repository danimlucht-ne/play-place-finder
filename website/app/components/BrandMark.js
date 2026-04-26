/** Vector brand mark: shared with Android adaptive icon (`ic_launcher_foreground` + brand cyan). */
export default function BrandMark({ className = 'nav-logo-mark', width = 46, height = 46 }) {
  return (
    <img
      className={className}
      src="/play-spotter-icon.svg"
      alt="Play Spotter"
      width={width}
      height={height}
      decoding="async"
    />
  );
}
