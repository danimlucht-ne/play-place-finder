const { assertValidImageBuffer } = require('../utils/imageUploadValidation');

describe('imageUploadValidation', () => {
  test('rejects non-image buffer', async () => {
    await expect(assertValidImageBuffer(Buffer.from('not an image'), 'image/jpeg')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects declared MIME that does not match contents', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await expect(assertValidImageBuffer(tinyPng, 'image/jpeg')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
