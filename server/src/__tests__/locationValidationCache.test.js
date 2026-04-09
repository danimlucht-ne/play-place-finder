const { COLL, getManyCached, setCached } = require('../services/locationValidationCache');

describe('locationValidationCache', () => {
  test('deduplicates requested ids and returns cache map', async () => {
    const toArray = jest.fn().mockResolvedValue([
      { _id: 'place-1', valid: true, source: 'rule' },
      { _id: 'place-2', valid: 0 },
    ]);
    const find = jest.fn(() => ({ toArray }));
    const collection = jest.fn(() => ({ find }));

    const result = await getManyCached({ collection }, ['place-1', 'place-1', 'place-2', null, '']);

    expect(collection).toHaveBeenCalledWith(COLL);
    expect(find).toHaveBeenCalledWith({ _id: { $in: ['place-1', 'place-2'] } });
    expect(result.get('place-1')).toEqual({ valid: true, source: 'rule' });
    expect(result.get('place-2')).toEqual({ valid: false, source: 'gemini' });
  });

  test('returns an empty map without querying for empty inputs', async () => {
    const db = { collection: jest.fn() };

    await expect(getManyCached(db, [])).resolves.toEqual(new Map());
    expect(db.collection).not.toHaveBeenCalled();
  });

  test('upserts cache decisions with a stable string id', async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn(() => ({ updateOne }));

    await setCached({ collection }, 12345, false, 'gemini');

    expect(collection).toHaveBeenCalledWith(COLL);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: '12345' },
      {
        $set: {
          valid: false,
          decidedAt: expect.any(Date),
          source: 'gemini',
        },
      },
      { upsert: true },
    );
  });
});
