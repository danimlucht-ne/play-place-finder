const { Storage } = require('@google-cloud/storage');
const { randomUUID } = require('crypto');

const storage = new Storage(
    process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }
        : {}
);
const publicBucket = storage.bucket("playground_app_bucket");
const quarantineBucket = storage.bucket("playground_app_bucket"); // same bucket, quarantine/ prefix for paths

/**
 * Uploads an image buffer to the public GCS bucket and returns the public HTTPS URL.
 * @param {Buffer} buffer - image data
 * @param {string} [folder] - optional subfolder, e.g. "masked-photos"
 * @returns {Promise<string>} public URL
 */
async function uploadBufferToPublic(buffer, folder = 'masked-photos') {
    const filename = `${folder}/${randomUUID()}.jpg`;
    const file = publicBucket.file(filename);
    await file.save(buffer, {
        metadata: { contentType: 'image/jpeg' },
    });
    return `https://storage.googleapis.com/playground_app_bucket/${filename}`;
}

module.exports = { publicBucket, quarantineBucket, uploadBufferToPublic };
