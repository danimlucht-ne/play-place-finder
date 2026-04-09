jest.mock('../database', () => ({ getDb: jest.fn() }));

const { getDb } = require('../database');
const {
  PHASE_SLOT_LIMITS,
  PLACEMENT_TO_SLOT,
  VALID_PHASES,
  getCityPhase,
  checkSlotAvailability,
  decrementSlot,
  incrementSlot,
  evaluateAllCityTransitions,
  setPhaseOverride,
  migrateLegacyBetaCities,
} = require('../services/cityPhaseService');

describe('cityPhaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('exports expected phase constants and placement mappings', () => {
    expect(PHASE_SLOT_LIMITS.growth).toEqual({ featured: 1, sponsored: 5 });
    expect(PHASE_SLOT_LIMITS.mature).toEqual({ featured: 1, sponsored: 8 });
    expect(PLACEMENT_TO_SLOT).toMatchObject({
      featured_home: 'featured',
      inline_listing: 'sponsored',
    });
    expect(VALID_PHASES).toEqual(['seeding', 'growth', 'mature']);
  });

  test('returns seeding defaults when city settings do not exist', async () => {
    getDb.mockReturnValue({
      collection: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null) })),
    });

    await expect(getCityPhase('omaha-ne')).resolves.toEqual({
      phase: 'seeding',
      slotsRemaining: { featured: 0, sponsored: 0 },
      pricing: null,
    });
  });

  test('normalizes legacy beta to growth for phase and pricing', async () => {
    getDb.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({
          phase: 'beta',
          slots: { featured: { remaining: 1 }, sponsored: { remaining: 2 } },
          phasePricing: { growth: { featured: 14900, sponsored: 4900 } },
        }),
      })),
    });

    await expect(getCityPhase('omaha-ne')).resolves.toEqual({
      phase: 'growth',
      slotsRemaining: { featured: 1, sponsored: 2 },
      pricing: { featured: 14900, sponsored: 4900 },
    });
  });

  test('checks slot availability: open cities always allow signup; seeding blocks', async () => {
    const findOne = jest.fn()
      .mockResolvedValueOnce({
        phase: 'growth',
        slots: { sponsored: { remaining: 2 } },
      })
      .mockResolvedValueOnce({
        phase: 'seeding',
        slots: { sponsored: { remaining: 2 } },
      })
      .mockResolvedValueOnce({
        phase: 'growth',
        slots: { sponsored: { remaining: 0 } },
      });
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne })) });

    await expect(checkSlotAvailability('omaha-ne', 'inline_listing')).resolves.toEqual({
      available: true,
      remaining: 2,
    });
    await expect(checkSlotAvailability('omaha-ne', 'inline_listing')).resolves.toEqual({
      available: false,
      remaining: 0,
    });
    await expect(checkSlotAvailability('omaha-ne', 'inline_listing')).resolves.toEqual({
      available: true,
      remaining: 0,
    });
  });

  test('decrements slots when inventory remains; no-ops without throwing when already zero', async () => {
    const findOneAndUpdate = jest.fn()
      .mockResolvedValueOnce({ cityId: 'omaha-ne' })
      .mockResolvedValueOnce(null);
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOneAndUpdate })) });

    await expect(decrementSlot('omaha-ne', 'featured_home')).resolves.toBeUndefined();
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { cityId: 'omaha-ne', 'slots.featured.remaining': { $gt: 0 } },
      {
        $inc: { 'slots.featured.remaining': -1 },
        $set: { updatedAt: new Date('2026-04-09T12:00:00Z') },
      },
      { returnDocument: 'after' },
    );
    await expect(decrementSlot('omaha-ne', 'featured')).resolves.toBeUndefined();
  });

  test('increments slots only when remaining is below max', async () => {
    const findOneAndUpdate = jest.fn().mockResolvedValue(null);
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOneAndUpdate })) });

    await expect(incrementSlot('omaha-ne', 'inline_listing')).resolves.toBeUndefined();
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        cityId: 'omaha-ne',
        $expr: { $lt: ['$slots.sponsored.remaining', '$slots.sponsored.max'] },
      },
      {
        $inc: { 'slots.sponsored.remaining': 1 },
        $set: { updatedAt: new Date('2026-04-09T12:00:00Z') },
      },
      { returnDocument: 'after' },
    );
  });

  test('sets valid phase overrides and rejects invalid phases', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({ collection: jest.fn(() => ({ updateOne })) });

    await expect(setPhaseOverride('omaha-ne', 'growth')).resolves.toBeUndefined();
    expect(updateOne).toHaveBeenCalledWith(
      { cityId: 'omaha-ne' },
      {
        $set: {
          phase: 'growth',
          phaseOverride: true,
          phaseChangedAt: new Date('2026-04-09T12:00:00Z'),
          updatedAt: new Date('2026-04-09T12:00:00Z'),
        },
      },
      { upsert: true },
    );
    await expect(setPhaseOverride('omaha-ne', 'launch')).rejects.toThrow('Invalid phase: launch');
  });

  test('migrateLegacyBetaCities rewrites beta rows to growth', async () => {
    const betaCity = {
      _id: 'city-1',
      cityId: 'omaha-ne',
      phase: 'beta',
      phasePricing: { beta: { featured: 9900, sponsored: 3900 } },
      slots: { featured: { max: 1, remaining: 0 }, sponsored: { max: 3, remaining: 1 } },
      transitionRules: { betaToGrowth: { minActiveAdvertisers: 2 } },
    };
    const find = jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([betaCity]),
    }));
    const updateOne = jest.fn().mockResolvedValue({});
    const countDocuments = jest.fn().mockResolvedValue(0);
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'cityAdSettings') return { find, updateOne };
        if (name === 'adCampaigns') return { countDocuments };
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    await expect(migrateLegacyBetaCities()).resolves.toBeUndefined();
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][1].$set.phase).toBe('growth');
    expect(updateOne.mock.calls[0][1].$set.phasePricing).toEqual({
      growth: { featured: 9900, sponsored: 3900 },
    });
  });

  test('evaluateAllCityTransitions migrates beta then moves eligible growth cities to mature', async () => {
    const betaCity = {
      _id: 'b1',
      cityId: 'omaha-ne',
      phase: 'beta',
      phasePricing: { beta: { featured: 9900 } },
      slots: { featured: { max: 1, remaining: 1 }, sponsored: { max: 3, remaining: 1 } },
    };
    const growthCity = {
      _id: 'g1',
      cityId: 'lincoln-ne',
      phase: 'growth',
      waitlist: ['business-1'],
      slots: { featured: { remaining: 1 }, sponsored: { remaining: 1 } },
    };
    const find = jest.fn((query) => ({
      toArray: jest.fn().mockImplementation(async () => {
        if (query.phase === 'beta') return [betaCity];
        if (query.phase === 'growth' && query.phaseOverride && query.phaseOverride.$ne === true) {
          return [
            { ...betaCity, phase: 'growth', phasePricing: { growth: { featured: 9900 } } },
            growthCity,
          ];
        }
        return [];
      }),
    }));
    const updateOne = jest.fn().mockResolvedValue({});
    const countDocuments = jest.fn().mockResolvedValue(0);
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'cityAdSettings') return { find, updateOne };
        if (name === 'adCampaigns') return { countDocuments };
        throw new Error(`Unexpected collection ${name}`);
      }),
    });

    await expect(evaluateAllCityTransitions()).resolves.toEqual({
      transitioned: ['lincoln-ne: growth\u2192mature'],
    });
    expect(updateOne).toHaveBeenCalledTimes(2);
  });
});
