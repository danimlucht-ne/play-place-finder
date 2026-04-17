const { generateSearchGridForBounds } = require('../services/seedOrchestratorService');

describe('generateSearchGridForBounds', () => {
  test('tiny viewport yields one grid point', () => {
    const pts = generateSearchGridForBounds(41.25, -96.05, 41.251, -96.049, 12);
    expect(pts).toHaveLength(1);
    expect(pts[0].lat).toBeGreaterThanOrEqual(41.25);
    expect(pts[0].lat).toBeLessThanOrEqual(41.251);
  });

  test('caps at maxPoints by widening step', () => {
    const pts = generateSearchGridForBounds(41.2, -96.2, 41.24, -96.12, 8);
    expect(pts.length).toBeLessThanOrEqual(8);
    expect(pts.length).toBeGreaterThanOrEqual(1);
  });

  test('rejects invalid box (zero lat span)', () => {
    expect(() => generateSearchGridForBounds(41.2, -96, 41.2, -95.9, 12)).toThrow(/Invalid viewport/);
  });

  test('rejects oversized viewport', () => {
    expect(() => generateSearchGridForBounds(41.0, -97.0, 41.5, -95.0, 12)).toThrow(/too large/);
  });
});
