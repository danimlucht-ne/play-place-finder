const {
  DEFAULT_ALLOWED_ORIGINS,
  getAllowedOrigins,
  isOriginAllowed,
} = require('../utils/corsConfig');

describe('corsConfig', () => {
  test('allows the production website domains by default', () => {
    expect(DEFAULT_ALLOWED_ORIGINS).toContain('https://www.play-spotter.com');
    expect(DEFAULT_ALLOWED_ORIGINS).toContain('https://play-spotter.com');
    expect(isOriginAllowed('https://www.play-spotter.com', {})).toBe(true);
  });

  test('allows local development origins by default', () => {
    expect(isOriginAllowed('http://localhost:3000', {})).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3000', {})).toBe(true);
  });

  test('includes extra configured origins from the environment', () => {
    const env = { CORS_ALLOWED_ORIGINS: 'https://preview.example.com, https://staging.example.com' };
    expect(getAllowedOrigins(env)).toContain('https://preview.example.com');
    expect(isOriginAllowed('https://staging.example.com', env)).toBe(true);
  });

  test('rejects unknown browser origins', () => {
    expect(isOriginAllowed('https://not-allowed.example.com', {})).toBe(false);
  });
});
