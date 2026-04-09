jest.mock('../database', () => ({ getDb: jest.fn() }));

const { getDb } = require('../database');
const { processAndAddNewOptions, getApprovedOptions } = require('../services/dynamicOptionsService');

describe('dynamicOptionsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('bulk upserts submitted custom options for admin review', async () => {
    const bulkWrite = jest.fn().mockResolvedValue({});
    getDb.mockReturnValue({ collection: jest.fn(() => ({ bulkWrite })) });

    await processAndAddNewOptions({
      customAmenities: ['Changing table'],
      atmosphereList: ['Quiet'],
      equipment: ['Climbing wall'],
      swingTypes: ['Toddler swing'],
      sportsCourts: ['Pickleball'],
      groundType: 'Rubber',
      playgroundType: 'Indoor',
      expense: 'Free',
    });

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(8);
    expect(ops[0]).toMatchObject({
      updateOne: {
        filter: { value: 'Changing table', type: 'amenity' },
        upsert: true,
      },
    });
    expect(ops[0].updateOne.update.$setOnInsert).toMatchObject({
      value: 'Changing table',
      type: 'amenity',
      isApproved: false,
      createdAt: expect.any(Date),
    });
  });

  test('does not write when submitted options are empty', async () => {
    const collection = jest.fn();
    getDb.mockReturnValue({ collection });

    await processAndAddNewOptions({ customAmenities: ['', null], groundType: '   ' });

    expect(collection).not.toHaveBeenCalled();
  });

  test('swallows option write failures so playground submission can continue', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const bulkWrite = jest.fn().mockRejectedValue(new Error('db down'));
    getDb.mockReturnValue({ collection: jest.fn(() => ({ bulkWrite })) });

    await expect(processAndAddNewOptions({ customAmenities: ['Shade sail'] })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Failed to process dynamic options:', expect.any(Error));
    errorSpy.mockRestore();
  });

  test('groups approved options by type for UI consumption', async () => {
    const toArray = jest.fn().mockResolvedValue([
      { type: 'amenity', value: 'Shade' },
      { type: 'amenity', value: 'Bathrooms' },
      { type: 'equipment', value: 'Slides' },
    ]);
    const find = jest.fn(() => ({ toArray }));
    getDb.mockReturnValue({ collection: jest.fn(() => ({ find })) });

    await expect(getApprovedOptions()).resolves.toEqual({
      amenity: ['Shade', 'Bathrooms'],
      equipment: ['Slides'],
    });
    expect(find).toHaveBeenCalledWith({ isApproved: true });
  });

  test('returns empty options object when approved option lookup fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const find = jest.fn(() => ({ toArray: jest.fn().mockRejectedValue(new Error('db down')) }));
    getDb.mockReturnValue({ collection: jest.fn(() => ({ find })) });

    await expect(getApprovedOptions()).resolves.toEqual({});
    expect(errorSpy).toHaveBeenCalledWith('Failed to fetch approved options:', expect.any(Error));
    errorSpy.mockRestore();
  });
});
