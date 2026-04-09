const { ObjectId } = require('mongodb');
const {
  resolvePlaygroundIdFilter,
  collectSubsumedPlaygroundIdsForRegion,
} = require('../utils/playgroundIdFilter');

describe('resolvePlaygroundIdFilter', () => {
  test('keeps nullish and empty ids as-is', () => {
    expect(resolvePlaygroundIdFilter(null)).toEqual({ _id: null });
    expect(resolvePlaygroundIdFilter('')).toEqual({ _id: '' });
  });

  test('converts strict 24-character hex strings to ObjectId', () => {
    const id = '64f1a9f7c2a7d9b123456789';
    const filter = resolvePlaygroundIdFilter(id);

    expect(filter._id).toBeInstanceOf(ObjectId);
    expect(filter._id.toHexString()).toBe(id);
  });

  test('leaves Google place ids and non-hex values as strings', () => {
    expect(resolvePlaygroundIdFilter('ChIJ-playground')).toEqual({ _id: 'ChIJ-playground' });
    expect(resolvePlaygroundIdFilter('zzzzzzzzzzzzzzzzzzzzzzzz')).toEqual({ _id: 'zzzzzzzzzzzzzzzzzzzzzzzz' });
  });
});

describe('collectSubsumedPlaygroundIdsForRegion', () => {
  test('returns unique sub-venue ids in discovery order', async () => {
    const toArray = jest.fn().mockResolvedValue([
      { subVenues: [{ id: 'place-a' }, { id: 'place-b' }, { id: null }] },
      { subVenues: [{ id: 'place-a' }, { id: new ObjectId('64f1a9f7c2a7d9b123456789') }] },
      { subVenues: null },
    ]);
    const project = jest.fn(() => ({ toArray }));
    const find = jest.fn(() => ({ project }));
    const collection = jest.fn(() => ({ find }));
    const db = { collection };

    const ids = await collectSubsumedPlaygroundIdsForRegion(db, 'omaha-ne');

    expect(collection).toHaveBeenCalledWith('playgrounds');
    expect(find).toHaveBeenCalledWith({
      $or: [{ regionKey: 'omaha-ne' }, { coveredRegionKeys: 'omaha-ne' }],
      archivedAt: { $exists: false },
      subVenues: { $elemMatch: { id: { $exists: true, $ne: null } } },
    });
    expect(project).toHaveBeenCalledWith({ subVenues: 1 });
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe('place-a');
    expect(ids[1]).toBe('place-b');
    expect(ids[2]).toBeInstanceOf(ObjectId);
  });

  test('does not query when regionKey is missing', async () => {
    const db = { collection: jest.fn() };

    await expect(collectSubsumedPlaygroundIdsForRegion(db, '')).resolves.toEqual([]);
    expect(db.collection).not.toHaveBeenCalled();
  });
});
