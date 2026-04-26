import './globals.css';

export const metadata = {
  title: 'Play Spotter — Find Kid-Friendly Play Places Near You',
  description: 'Discover playgrounds, indoor play areas, parks, and family-friendly activities in your neighborhood. Community-verified, free to use.',
  keywords: 'playground finder, kids activities, family fun, parks near me, indoor play, play places',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/play-spotter-icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/play-spotter-icon.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
