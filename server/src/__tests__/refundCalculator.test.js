const { calculateProRatedRefund } = require('../services/refundCalculator');

describe('calculateProRatedRefund', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T15:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('refunds full amount before or at campaign start', () => {
    const refund = calculateProRatedRefund(
      new Date('2026-04-10T00:00:00Z'),
      new Date('2026-05-10T00:00:00Z'),
      9900,
    );

    expect(refund).toEqual({
      refundAmountInCents: 9900,
      remainingDays: 31,
      totalDays: 30,
    });
  });

  test('pro-rates by remaining whole days during active campaign', () => {
    const refund = calculateProRatedRefund(
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-05-01T00:00:00Z'),
      3000,
    );

    expect(refund).toEqual({
      refundAmountInCents: 2200,
      remainingDays: 22,
      totalDays: 30,
    });
  });

  test('returns zero after campaign end or invalid campaign duration', () => {
    expect(calculateProRatedRefund(new Date('2026-03-01'), new Date('2026-04-01'), 3000)).toEqual({
      refundAmountInCents: 0,
      remainingDays: 0,
      totalDays: 31,
    });
    expect(calculateProRatedRefund(new Date('2026-05-01'), new Date('2026-05-01'), 3000)).toEqual({
      refundAmountInCents: 0,
      remainingDays: 0,
      totalDays: 0,
    });
  });
});
