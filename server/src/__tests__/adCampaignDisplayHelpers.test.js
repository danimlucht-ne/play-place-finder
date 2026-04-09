const {
  calendarYmdFromValue,
  addCalendarMonthsYmd,
  regionKeyToLabelMap,
} = require('../services/adCampaignDisplayHelpers');

describe('adCampaignDisplayHelpers', () => {
  test('normalizes dates without host timezone day shifts', () => {
    expect(calendarYmdFromValue(null)).toBe('');
    expect(calendarYmdFromValue('2026-04-09T18:30:00.000Z')).toBe('2026-04-09');
    expect(calendarYmdFromValue(new Date('2026-04-09T23:59:59.000Z'))).toBe('2026-04-09');
    expect(calendarYmdFromValue('not-a-date')).toBe('');
  });

  test('adds calendar months with month-end clamping', () => {
    expect(addCalendarMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(addCalendarMonthsYmd('2026-11-30', 3)).toBe('2027-02-28');
    expect(addCalendarMonthsYmd('bad-date', 1)).toBe('');
  });

  test('maps region keys to human labels and falls back to key when city is missing', async () => {
    const toArray = jest.fn().mockResolvedValue([
      { regionKey: 'omaha-ne', city: 'Omaha', state: 'NE' },
      { regionKey: 'unknown', city: '', state: 'NE' },
      { city: 'Missing key', state: 'NE' },
    ]);
    const find = jest.fn(() => ({ toArray }));
    const collection = jest.fn(() => ({ find }));

    await expect(regionKeyToLabelMap({ collection }, ['omaha-ne', 'omaha-ne', 'unknown', null])).resolves.toEqual({
      'omaha-ne': 'Omaha, NE',
      unknown: 'unknown',
    });
    expect(collection).toHaveBeenCalledWith('seeded_regions');
    expect(find).toHaveBeenCalledWith({ regionKey: { $in: ['omaha-ne', 'unknown'] } });
  });

  test('does not query when no valid region keys are provided', async () => {
    const db = { collection: jest.fn() };

    await expect(regionKeyToLabelMap(db, ['', null, undefined])).resolves.toEqual({});
    expect(db.collection).not.toHaveBeenCalled();
  });
});
