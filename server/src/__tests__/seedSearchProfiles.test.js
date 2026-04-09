const {
  BACKGROUND_EXPANSION_SEARCHES,
  CAMPUS_SUBVENUE_SEARCHES,
  LIGHT_REFRESH_SEARCHES,
} = require('../services/seedSearchProfiles');

describe('seedSearchProfiles', () => {
  test('background and light refresh profiles include zoo exhibit discovery', () => {
    expect(BACKGROUND_EXPANSION_SEARCHES).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tourist_attraction', keyword: 'zoo exhibit' }),
      expect.objectContaining({ type: 'tourist_attraction', keyword: 'animal exhibit' }),
    ]));
    expect(LIGHT_REFRESH_SEARCHES).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'zoo', keyword: 'zoo' }),
      expect.objectContaining({ type: 'tourist_attraction', keyword: 'zoo exhibit' }),
    ]));
  });

  test('campus subvenue profile targets internal zoo and aquarium POIs', () => {
    expect(CAMPUS_SUBVENUE_SEARCHES).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'exhibit' }),
      expect.objectContaining({ keyword: 'zoo exhibit' }),
      expect.objectContaining({ keyword: 'animal exhibit' }),
      expect.objectContaining({ keyword: 'habitat' }),
      expect.objectContaining({ keyword: 'aviary' }),
      expect.objectContaining({ keyword: 'carousel' }),
      expect.objectContaining({ keyword: 'splash park zoo' }),
      expect.objectContaining({ keyword: 'train ride zoo' }),
      expect.objectContaining({ type: 'point_of_interest', keyword: 'zoo attraction' }),
    ]));
  });
});
