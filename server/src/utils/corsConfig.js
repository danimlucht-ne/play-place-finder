const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
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
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]));
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
