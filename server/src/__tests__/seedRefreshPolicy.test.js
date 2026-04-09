const {
  isRegionDueForLightRefresh,
  isRefreshLockStale,
  nextLightRefreshAfter,
} = require('../services/seedRefreshPolicy');

describe('seedRefreshPolicy', () => {
  test('fresh regions do not refresh and stale regions do', () => {
    const now = new Date('2026-04-10T12:00:00Z');

    expect(isRegionDueForLightRefresh({
      regionKey: 'omaha-ne',
      nextLightRefreshAfter: new Date('2026-04-11T12:00:00Z'),
    }, now)).toBe(false);

    expect(isRegionDueForLightRefresh({
      regionKey: 'omaha-ne',
      nextLightRefreshAfter: new Date('2026-04-09T12:00:00Z'),
    }, now)).toBe(true);
  });

  test('running seed and active refresh locks suppress user-triggered refresh', () => {
    const now = new Date('2026-04-10T12:00:00Z');

    expect(isRegionDueForLightRefresh({ seedStatus: 'running' }, now)).toBe(false);
    expect(isRegionDueForLightRefresh({
      seedStatus: 'complete',
      refreshInFlight: true,
      refreshStartedAt: new Date('2026-04-10T11:30:00Z'),
      nextLightRefreshAfter: new Date('2026-04-01T12:00:00Z'),
    }, now)).toBe(false);
  });

  test('stale refresh locks can be reclaimed', () => {
    const now = new Date('2026-04-10T12:00:00Z');

    expect(isRefreshLockStale({
      refreshInFlight: true,
      refreshStartedAt: new Date('2026-04-10T08:00:00Z'),
    }, now)).toBe(true);
  });

  test('next refresh defaults to about one month after completion', () => {
    const next = nextLightRefreshAfter(new Date('2026-04-10T00:00:00Z'));
    expect(next.toISOString()).toBe('2026-05-10T00:00:00.000Z');
  });
});
