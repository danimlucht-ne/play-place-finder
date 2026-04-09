jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));

const { getDb } = require('../database');
const {
  computePhotoScore,
  computeScore,
  deduplicateGallery,
  difference,
  hammingDistance,
  intersection,
  mergeAndRevalidate,
  normalize,
  rerankGallery,
  shouldQueueForReview,
  titleCase,
  validate,
} = require('../services/equipmentValidationService');

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

function cursor(items) {
  return { toArray: jest.fn().mockResolvedValue(items) };
}

describe('equipmentValidationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('normalizes and compares feature lists predictably', () => {
    expect(normalize([' Slide ', 'slide', 'SWING'])).toEqual(['slide', 'swing']);
    expect(intersection(['slide', 'swing'], ['swing', 'bench'])).toEqual(['swing']);
    expect(difference(['slide', 'swing'], ['swing'])).toEqual(['slide']);
    expect(titleCase('bucket swing')).toBe('Bucket Swing');
  });

  test('validate confirms matching features, flags missing records, and ignores ground surface AI guesses', () => {
    const report = validate({
      equipment: ['slide', 'climber'],
      swingTypes: ['bucket swing'],
      sportsCourts: ['basketball'],
      amenities: ['Bathrooms', 'Shade', 'Parking'],
      groundSurface: 'rubber',
    }, {
      equipment: ['Slide'],
      swingTypes: ['belt swing'],
      sportsCourts: ['Basketball'],
      hasBathrooms: true,
      hasShade: false,
      hasParking: true,
    }, 3);

    expect(report.confirmed).toEqual(expect.objectContaining({
      equipment: ['Slide'],
      sportsCourts: ['Basketball'],
      amenities: ['Bathrooms', 'Parking'],
      groundSurface: null,
    }));
    expect(report.missingFromRecord).toEqual(expect.objectContaining({
      equipment: ['Climber'],
      swingTypes: ['Bucket Swing'],
      amenities: ['Shade'],
      groundSurface: null,
    }));
    expect(report.noPhotoEvidence).toEqual(expect.objectContaining({
      swingTypes: ['Belt Swing'],
      groundSurface: null,
    }));
    expect(report.photoCount).toBe(3);
    expect(report.dataQualityScore).toBe(0.5);
  });

  test('computeScore and shouldQueueForReview distinguish useful evidence from low-quality mismatches', () => {
    const highQuality = {
      confirmed: { equipment: ['Slide'], swingTypes: [], sportsCourts: [], amenities: ['Shade'] },
      missingFromRecord: { equipment: [], swingTypes: [], sportsCourts: [], amenities: [] },
      noPhotoEvidence: { equipment: [], swingTypes: [], sportsCourts: [], amenities: [] },
    };
    expect(computeScore(highQuality)).toBe(1);
    expect(shouldQueueForReview({ ...highQuality, dataQualityScore: 1 })).toBe(false);

    const lowQuality = {
      confirmed: { equipment: [], swingTypes: [], sportsCourts: [], amenities: [] },
      missingFromRecord: { equipment: ['Climber'], swingTypes: ['Bucket Swing'], sportsCourts: [], amenities: [] },
      noPhotoEvidence: { equipment: ['Slide'], swingTypes: [], sportsCourts: [], amenities: [] },
      dataQualityScore: 0.25,
    };
    expect(shouldQueueForReview(lowQuality)).toBe(true);
  });

  test('mergeAndRevalidate additively updates playground features and stores the validation report', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      playgrounds: {
        findOne: jest.fn().mockResolvedValue({
          _id: 'pg-1',
          equipment: ['Slide'],
          swingTypes: [],
          sportsCourts: [],
          hasBathrooms: false,
          photoValidation: {
            photoCount: 1,
            confirmed: { equipment: ['Slide'] },
            missingFromRecord: { equipment: [] },
          },
        }),
        updateOne,
      },
    }));

    const report = await mergeAndRevalidate({
      equipment: ['Climber'],
      swingTypes: ['Bucket Swing'],
      amenities: ['Bathrooms'],
      groundSurface: ['rubber'],
    }, 'pg-1');

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'pg-1' },
      { $set: expect.objectContaining({
        equipment: ['Slide', 'Climber'],
        swingTypes: ['Bucket Swing'],
        groundType: 'rubber',
        hasBathrooms: true,
        photoValidation: expect.objectContaining({ photoCount: 2 }),
      }) },
    );
    expect(report.photoCount).toBe(2);
    expect(report.confirmed.equipment).toEqual(['Slide', 'Climber']);
  });

  test('computePhotoScore handles AI failures, unusable photos, feature bonuses, and face penalties', () => {
    expect(computePhotoScore(null)).toBe(0.1);
    expect(computePhotoScore({ aiFailed: true })).toBe(0.1);
    expect(computePhotoScore({ photoUseful: false, playgroundVisible: true })).toBe(0.05);

    const summary = {
      photoUseful: true,
      playgroundVisible: true,
      relevanceScore: 0.8,
      overviewScore: 0.7,
      confidence: 0.9,
      detectedFeatures: {
        equipment: ['slide', 'climber'],
        amenities: ['shade'],
        sportsCourts: ['basketball'],
        swingTypes: ['bucket'],
        groundSurface: 'rubber',
      },
    };
    expect(computePhotoScore(summary)).toBe(0.89);
    expect(computePhotoScore(summary, { hasFaces: true, isMasked: true })).toBe(0.84);
    expect(computePhotoScore(summary, { hasFaces: true, isMasked: false })).toBe(0.59);
  });

  test('hammingDistance and deduplicateGallery remove lower-scored near-duplicates', async () => {
    expect(hammingDistance('1010', '1111')).toBe(2);

    const updatePlayground = jest.fn().mockResolvedValue({});
    const archiveInsert = jest.fn().mockResolvedValue({});
    const scoreDelete = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      playgrounds: {
        findOne: jest.fn().mockResolvedValue({
          _id: 'pg-1',
          name: 'Elm Park',
          regionKey: 'omaha-ne',
          imageUrls: ['a.jpg', 'b.jpg', 'google_photo:abc'],
        }),
        updateOne: updatePlayground,
      },
      photo_scores: {
        find: jest.fn().mockReturnValue(cursor([
          { photoUrl: 'a.jpg', phash: '11110000', score: 0.9 },
          { photoUrl: 'b.jpg', phash: '11110001', score: 0.4 },
        ])),
        updateOne: jest.fn(),
        deleteMany: scoreDelete,
      },
      archived_photos: { insertMany: archiveInsert },
    }));

    await expect(deduplicateGallery('pg-1', 2)).resolves.toEqual({
      removed: 1,
      pairs: [{ kept: 'a.jpg', removed: 'b.jpg', distance: 1 }],
    });
    expect(archiveInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        playgroundId: 'pg-1',
        playgroundName: 'Elm Park',
        photoUrl: 'b.jpg',
        archiveReason: 'near_duplicate',
        archivedAt: new Date('2026-04-09T12:00:00Z'),
      }),
    ]);
    expect(updatePlayground).toHaveBeenCalledWith(
      { _id: 'pg-1' },
      { $set: { imageUrls: ['a.jpg', 'google_photo:abc'] } },
    );
    expect(scoreDelete).toHaveBeenCalledWith({
      playgroundId: 'pg-1',
      photoUrl: { $in: ['b.jpg'] },
    });
  });

  test('rerankGallery orders images by score and skips unchanged or empty galleries', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue(makeDb({
      playgrounds: {
        findOne: jest.fn().mockResolvedValue({
          _id: 'pg-1',
          imageUrls: ['low.jpg', 'high.jpg', 'unknown.jpg'],
        }),
        updateOne,
      },
      photo_scores: {
        find: jest.fn().mockReturnValue(cursor([
          { photoUrl: 'low.jpg', score: 0.1 },
          { photoUrl: 'high.jpg', score: 0.9 },
        ])),
      },
    }));

    await rerankGallery('pg-1');

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'pg-1' },
      { $set: { imageUrls: ['high.jpg', 'unknown.jpg', 'low.jpg'] } },
    );

    getDb.mockReturnValue(makeDb({
      playgrounds: {
        findOne: jest.fn().mockResolvedValue({ _id: 'pg-2', imageUrls: [] }),
        updateOne: jest.fn(),
      },
      photo_scores: { find: jest.fn() },
    }));
    await expect(rerankGallery('pg-2')).resolves.toBeUndefined();
  });
});
