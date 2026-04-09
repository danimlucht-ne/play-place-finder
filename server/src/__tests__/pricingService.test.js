const {
  calculateMultiMonthPrice,
  validateStartDate,
  PLACEMENT_TO_PRICE_KEY,
  VALID_DURATIONS,
  roundEventSpotlightPriceFromMonthlyCents,
} = require('../services/pricingService');

describe('pricingService pure pricing helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('maps ad placements to pricing keys used by city settings', () => {
    expect(PLACEMENT_TO_PRICE_KEY).toMatchObject({
      featured_home: 'featured',
      inline_listing: 'sponsored',
      event_spotlight_7d: 'event_7d',
      event_spotlight_14d: 'event_14d',
    });
  });

  test('calculates multi-month discounts and one-time radius surcharge', () => {
    expect(calculateMultiMonthPrice(10000, 3, 1500)).toEqual({
      totalPriceInCents: 27000,
      discountPercent: 15,
      perMonthRateInCents: 8500,
      subtotalBeforeDiscount: 30000,
      discountAmountInCents: 4500,
    });
  });

  test('allows only supported ad durations', () => {
    expect(VALID_DURATIONS).toEqual([1, 2, 3, 6]);
    expect(() => calculateMultiMonthPrice(10000, 12)).toThrow('Invalid duration: 12');
  });

  test('validates start dates using local calendar boundaries', () => {
    expect(validateStartDate('2026-04-16')).toMatchObject({ valid: true, error: null });
    expect(validateStartDate('2026-04-11')).toMatchObject({ valid: true, error: null });
    expect(validateStartDate('2026-04-10')).toMatchObject({
      valid: false,
      error: 'Start date must be at least 2 days from today',
    });
    expect(validateStartDate('2026-05-10')).toMatchObject({
      valid: false,
      error: 'Start date cannot be more than 30 days from today',
    });
  });

  test('rejects malformed and impossible calendar dates', () => {
    expect(validateStartDate('04/20/2026')).toMatchObject({ valid: false, error: 'Invalid date format' });
    expect(validateStartDate('2026-02-31')).toMatchObject({ valid: false, error: 'Invalid calendar date' });
  });

  test('rounds event spotlight prices from monthly sponsored cents', () => {
    expect(roundEventSpotlightPriceFromMonthlyCents(4900, 'event_spotlight_7d')).toBe(1300);
    expect(roundEventSpotlightPriceFromMonthlyCents(4900, 'event_spotlight_14d')).toBe(2500);
    expect(roundEventSpotlightPriceFromMonthlyCents(3900, 'event_spotlight_7d')).toBe(1200);
    expect(roundEventSpotlightPriceFromMonthlyCents(3900, 'event_spotlight_14d')).toBe(2200);
  });
});
