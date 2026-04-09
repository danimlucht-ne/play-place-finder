import './globals.css';

export const metadata = {
  title: 'PlayPlace Finder — Find Kid-Friendly Play Places Near You',
  description: 'Discover playgrounds, indoor play areas, parks, and family-friendly activities in your neighborhood. Community-verified, free to use.',
  keywords: 'playground finder, kids activities, family fun, parks near me, indoor play, play places',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/playplace-app-icon.png" type="image/png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/playplace-app-icon.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
