const PhotoModerationConfig = require('../services/photoModerationConfig');

describe('photoModerationConfig', () => {
  test('sets conservative face moderation limits', () => {
    expect(PhotoModerationConfig).toEqual({
      MAX_FACES: 5,
      MAX_FACE_AREA_RATIO: 0.25,
    });
  });
});
