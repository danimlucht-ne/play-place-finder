const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://play-spotter.com',
  'https://www.play-spotter.com',
  'https://play-place-finder.com',
  'https://www.play-place-finder.com',
  'https://playplacefinder.com',
  'https://www.playplacefinder.com',
];

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllowedOrigins(env = process.env) {
  const configured = parseCsv(env.CORS_ALLOWED_ORIGINS);
  let defaults = DEFAULT_ALLOWED_ORIGINS;
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const allowLocal =
    env.CORS_ALLOW_LOCALHOST === 'true' || env.CORS_ALLOW_LOCALHOST === '1';
  if (production && !allowLocal) {
    defaults = defaults.filter(
      (o) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o),
    );
  }
  return Array.from(new Set([...defaults, ...configured]));
}

function isOriginAllowed(origin, env = process.env) {
  if (!origin) return true;
  return getAllowedOrigins(env).includes(String(origin).trim());
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  getAllowedOrigins,
  isOriginAllowed,
};
