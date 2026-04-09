const {
  ACTIVE_PLAYGROUND,
  countActivePlaygroundsByRegionKeys,
} = require('../services/regionStatsService');

describe('regionStatsService', () => {
  test('counts active playgrounds per unique requested region', async () => {
    const toArray = jest.fn().mockResolvedValue([
      { _id: 'omaha-ne', n: 12 },
      { _id: 'lincoln-ne', n: 4 },
      { _id: null, n: 99 },
    ]);
    const aggregate = jest.fn(() => ({ toArray }));
    const collection = jest.fn(() => ({ aggregate }));

    const result = await countActivePlaygroundsByRegionKeys(
      { collection },
      ['omaha-ne', 'omaha-ne', '', null, 'lincoln-ne', 'missing-ne'],
    );

    expect(collection).toHaveBeenCalledWith('playgrounds');
    expect(aggregate).toHaveBeenCalledWith([
      { $match: { ...ACTIVE_PLAYGROUND, regionKey: { $in: ['omaha-ne', 'lincoln-ne', 'missing-ne'] } } },
      { $group: { _id: '$regionKey', n: { $sum: 1 } } },
    ]);
    expect(result).toEqual(new Map([
      ['omaha-ne', 12],
      ['lincoln-ne', 4],
      ['missing-ne', 0],
    ]));
  });

  test('returns zero-query empty map for empty input', async () => {
    const db = { collection: jest.fn() };

    await expect(countActivePlaygroundsByRegionKeys(db, [])).resolves.toEqual(new Map());
    expect(db.collection).not.toHaveBeenCalled();
  });
});
