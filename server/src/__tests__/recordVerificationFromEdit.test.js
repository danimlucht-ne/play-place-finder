jest.mock('../utils/helpers', () => ({ getConsentSnapshot: jest.fn() }));
jest.mock('../services/badgeService', () => ({ computeBadges: jest.fn() }));

const { getConsentSnapshot } = require('../utils/helpers');
const { computeBadges } = require('../services/badgeService');
const { recordVerificationFromPlaygroundEdit } = require('../services/recordVerificationFromEdit');

function collectionMap(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('recordVerificationFromEdit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does nothing when required inputs are missing', async () => {
    const db = collectionMap({});

    await recordVerificationFromPlaygroundEdit(db, '', 'user-1', {});
    await recordVerificationFromPlaygroundEdit(db, 'place-1', '', {});
    await recordVerificationFromPlaygroundEdit(db, 'place-1', 'user-1', null);

    expect(db.collection).not.toHaveBeenCalled();
  });

  test('skips recording when the same user recently verified the playground', async () => {
    const findOne = jest.fn().mockResolvedValue({ _id: 'recent' });
    const db = collectionMap({ location_verifications: { findOne } });

    await recordVerificationFromPlaygroundEdit(db, 'place-1', 'user-1', { location: { coordinates: [-96, 41] } });

    expect(findOne).toHaveBeenCalledWith({
      locationId: 'place-1',
      userId: 'user-1',
      verifiedAt: { $gte: new Date('2026-04-08T12:00:00Z') },
    });
  });

  test('records an edit verification, updates counters, and refreshes badges', async () => {
    const insertOne = jest.fn();
    const countDocuments = jest.fn().mockResolvedValue(7);
    const updateOne = jest.fn();
    const updatedPlayground = { _id: 'place-1', verificationCount: 12 };
    const playgroundFindOne = jest.fn().mockResolvedValue(updatedPlayground);
    getConsentSnapshot.mockResolvedValue({ adultTermsConsentVersion: 'v1', adultTermsAccepted: true });
    computeBadges.mockReturnValue(['verified']);
    const db = collectionMap({
      location_verifications: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne,
        countDocuments,
      },
      playgrounds: {
        updateOne,
        findOne: playgroundFindOne,
      },
    });

    await recordVerificationFromPlaygroundEdit(db, 'place-1', 'user-1', {
      location: { coordinates: [-96.012, 41.256] },
    });

    expect(insertOne).toHaveBeenCalledWith({
      locationId: 'place-1',
      userId: 'user-1',
      verifiedAt: new Date('2026-04-09T12:00:00Z'),
      lat: 41.256,
      lng: -96.012,
      distanceMeters: 0,
      source: 'playground_edit',
      adultTermsConsentVersion: 'v1',
      adultTermsAccepted: true,
    });
    expect(countDocuments).toHaveBeenCalledWith({
      locationId: 'place-1',
      verifiedAt: { $gte: new Date('2026-03-10T12:00:00Z') },
    });
    expect(updateOne).toHaveBeenNthCalledWith(1, { _id: 'place-1' }, {
      $set: {
        lastVerifiedAt: new Date('2026-04-09T12:00:00Z'),
        lastVerifiedSource: 'playground_edit',
        verificationCount30d: 7,
      },
      $inc: { verificationCount: 1 },
    });
    expect(computeBadges).toHaveBeenCalledWith(updatedPlayground);
    expect(updateOne).toHaveBeenNthCalledWith(2, { _id: 'place-1' }, { $set: { badges: ['verified'] } });
  });

  test('still records verification when optional consent lookup fails', async () => {
    const insertOne = jest.fn();
    getConsentSnapshot.mockRejectedValue(new Error('consent unavailable'));
    computeBadges.mockReturnValue([]);
    const db = collectionMap({
      location_verifications: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne,
        countDocuments: jest.fn().mockResolvedValue(1),
      },
      playgrounds: {
        updateOne: jest.fn(),
        findOne: jest.fn().mockResolvedValue(null),
      },
    });

    await recordVerificationFromPlaygroundEdit(db, 'place-1', 'user-1', {});

    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({
      lat: 0,
      lng: 0,
      source: 'playground_edit',
    }));
  });
});
