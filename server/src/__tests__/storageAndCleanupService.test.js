const mockBucket = jest.fn();
const mockSave = jest.fn();
const mockDeleteFile = jest.fn();
const mockFile = jest.fn((name) => ({
  save: mockSave,
  delete: mockDeleteFile,
  name,
}));

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn(() => ({ bucket: mockBucket })),
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(() => 'fixed-uuid'),
}));

describe('storage and cleanup services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBucket.mockReturnValue({ file: mockFile });
    mockSave.mockResolvedValue();
    mockDeleteFile.mockResolvedValue();
  });

  test('uploadBufferToPublic stores jpeg data and returns public GCS URL', async () => {
    const { uploadBufferToPublic } = require('../services/storageService');
    const buffer = Buffer.from('image-bytes');

    await expect(uploadBufferToPublic(buffer, 'unit-folder')).resolves.toBe(
      'https://storage.googleapis.com/playground_app_bucket/unit-folder/fixed-uuid.jpg',
    );

    expect(mockBucket).toHaveBeenCalledWith('playground_app_bucket');
    expect(mockFile).toHaveBeenCalledWith('unit-folder/fixed-uuid.jpg');
    expect(mockSave).toHaveBeenCalledWith(buffer, {
      metadata: { contentType: 'image/jpeg' },
    });
  });

  test('deleteFromQuarantine reports success when object deletion succeeds', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { deleteFromQuarantine } = require('../services/photoCleanupService');

    await expect(deleteFromQuarantine('quarantine/file.jpg')).resolves.toEqual({ success: true });

    expect(mockFile).toHaveBeenCalledWith('quarantine/file.jpg');
    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  test('deleteFromQuarantine reports failure without throwing when GCS delete fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteFile.mockRejectedValueOnce(new Error('missing object'));
    const { deleteFromQuarantine } = require('../services/photoCleanupService');

    await expect(deleteFromQuarantine('missing.jpg')).resolves.toEqual({
      success: false,
      error: 'missing object',
    });

    expect(errorSpy).toHaveBeenCalledWith(
      'Error deleting missing.jpg from quarantine bucket:',
      'missing object',
    );
    errorSpy.mockRestore();
  });
});
