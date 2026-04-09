jest.mock('../database', () => ({ getDb: jest.fn() }));

const { getDb } = require('../database');
const {
  VALID_PHASES,
  DEFAULT_OPEN_REGION_PHASE_PRICING,
  getCityPhase,
  setPhaseOverride,
  resolvePhaseForUserCount,
  syncRegionAdPhasesFromUserCounts,
} = require('../services/cityPhaseService');

describe('cityPhaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    delete process.env.AD_PHASE_MATURE_MIN_USERS;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('exports valid phases and default pricing', () => {
    expect(VALID_PHASES).toEqual(['growing', 'mature']);
    expect(DEFAULT_OPEN_REGION_PHASE_PRICING.growing.featured).toBe(14900);
  });

  test('returns virtual seeding when no cityAdSettings exist', async () => {
    getDb.mockReturnValue({
      collection: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null) })),
    });

    await expect(getCityPhase('omaha-ne')).resolves.toEqual({
      phase: 'seeding',
      advertisingOpen: false,
      pricing: null,
    });
  });

  test('normalizes legacy beta to growing for API phase and returns pricing from growth or growing key', async () => {
    getDb.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({
          phase: 'beta',
          phasePricing: { growth: { featured: 14900, sponsored: 4900 } },
        }),
      })),
    });

    await expect(getCityPhase('omaha-ne')).resolves.toEqual({
      phase: 'growing',
      advertisingOpen: true,
      pricing: { featured: 14900, sponsored: 4900 },
    });
  });

  test('mature city returns mature pricing', async () => {
    getDb.mockReturnValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({
          phase: 'mature',
          phasePricing: {
            growing: { featured: 100, sponsored: 200 },
            mature: { featured: 300, sponsored: 400 },
          },
        }),
      })),
    });

    await expect(getCityPhase('x')).resolves.toMatchObject({
      phase: 'mature',
      advertisingOpen: true,
      pricing: { featured: 300, sponsored: 400 },
    });
  });

  test('setPhaseOverride upserts growing or mature and rejects other strings', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({ collection: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null), updateOne })) });

    await expect(setPhaseOverride('omaha-ne', 'growing')).resolves.toBeUndefined();
    expect(updateOne).toHaveBeenCalled();
    await expect(setPhaseOverride('omaha-ne', 'launch')).rejects.toThrow('Invalid phase: launch');
  });

  test('resolvePhaseForUserCount uses AD_PHASE_MATURE_MIN_USERS when set', () => {
    process.env.AD_PHASE_MATURE_MIN_USERS = '3';
    expect(resolvePhaseForUserCount(2)).toBe('growing');
    expect(resolvePhaseForUserCount(3)).toBe('mature');
  });

  test('syncRegionAdPhasesFromUserCounts flips phase when count crosses threshold', async () => {
    process.env.AD_PHASE_MATURE_MIN_USERS = '2';
    const s = { _id: 1, cityId: 'omaha-ne', phase: 'growing', phaseOverride: false };
    const find = jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([s]) }));
    const updateOne = jest.fn().mockResolvedValue({});
    const countDocuments = jest.fn()
      .mockResolvedValueOnce(2);
    getDb.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'cityAdSettings') return { find, updateOne };
        if (name === 'users') return { countDocuments };
        throw new Error(name);
      }),
    });

    await expect(syncRegionAdPhasesFromUserCounts()).resolves.toEqual(
      expect.objectContaining({ updated: ['omaha-ne: growing→mature'] }),
    );
  });
});
