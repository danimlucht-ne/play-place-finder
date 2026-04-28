jest.mock('../database', () => ({
  getDb: jest.fn(),
}));

const { getDb } = require('../database');
const {
  DEFAULT_VOCAB,
  getClassificationVocab,
  upsertClassificationVocab,
} = require('../services/classificationVocabService');

describe('classificationVocabService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns defaults merged with db overrides', async () => {
    const findOne = jest.fn().mockResolvedValue({
      _id: 'photo_feature_vocab',
      equipment: ['Swings', 'Zip Line', 'Zip Line', ''],
      amenities: ['Bathrooms', 'Shade Sail'],
    });
    getDb.mockReturnValue({
      collection: jest.fn().mockReturnValue({ findOne }),
    });

    const vocab = await getClassificationVocab({ forceRefresh: true });
    expect(vocab.equipment).toEqual(['Swings', 'Zip Line']);
    expect(vocab.amenities).toEqual(['Bathrooms', 'Shade Sail']);
    expect(vocab.swingTypes).toEqual(DEFAULT_VOCAB.swingTypes);
  });

  test('upsert validates and normalizes payload', async () => {
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const findOne = jest.fn().mockResolvedValue({
      _id: 'photo_feature_vocab',
      sportsCourts: ['Soccer', 'Basketball'],
    });
    getDb.mockReturnValue({
      collection: jest.fn().mockReturnValue({ updateOne, findOne }),
    });

    const next = await upsertClassificationVocab({
      updates: { sportsCourts: ['Soccer', 'Basketball', 'soccer', ''] },
      actorUserId: 'admin-1',
    });

    expect(updateOne).toHaveBeenCalled();
    expect(next.sportsCourts).toEqual(['Soccer', 'Basketball']);
  });
});
