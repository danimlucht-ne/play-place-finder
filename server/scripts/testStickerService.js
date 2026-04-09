/**
 * Quick smoke test for the face sticker masking pipeline.
 *
 * Tests: Google Vision face detection → Sharp sticker compositing → GCS upload
 *
 * Usage:
 *   node scripts/testStickerService.js                     # use a sample image from the web
 *   node scripts/testStickerService.js ./path/to/photo.jpg # use a local file
 *
 * On success, saves the masked result to scripts/test-masked-output.jpg
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fs = require('fs');
const axios = require('axios');
const { detectFaces, applyStickerMasks } = require('../src/services/faceStickerMaskService');
const { uploadBufferToPublic } = require('../src/services/storageService');

// A public-domain image of people at a playground (Unsplash, free to use)
const SAMPLE_IMAGE_URL = 'https://images.unsplash.com/photo-1596997000103-e597b3ca50df?w=800';

async function main() {
  const localPath = process.argv[2];
  let imageBuffer;

  if (localPath) {
    console.log(`Loading local image: ${localPath}`);
    imageBuffer = fs.readFileSync(path.resolve(localPath));
  } else {
    console.log(`Downloading sample image...`);
    const resp = await axios.get(SAMPLE_IMAGE_URL, { responseType: 'arraybuffer', timeout: 15000 });
    imageBuffer = Buffer.from(resp.data, 'binary');
  }
  console.log(`Image loaded (${(imageBuffer.length / 1024).toFixed(1)} KB)\n`);

  // Step 1: Vision API face detection
  console.log('--- Step 1: Google Vision face detection ---');
  let faces;
  try {
    faces = await detectFaces(imageBuffer);
    console.log(`  Faces detected: ${faces.length}`);
    if (faces.length === 0) {
      console.log('  No faces found in this image. Sticker masking will be skipped.');
      console.log('  Try a different image with visible faces, or pass a local file:');
      console.log('    node scripts/testStickerService.js ./photo-with-faces.jpg');
      console.log('\n  Vision API is working. Pipeline OK (no masking needed).');
      return;
    }
  } catch (err) {
    console.error('  FAILED:', err.message);
    if (err.message.includes('permission') || err.message.includes('403') || err.message.includes('PERMISSION_DENIED')) {
      console.error('\n  The service account lacks Vision API permissions.');
      console.error('  Ensure "Cloud Vision API User" role is granted.');
    }
    if (err.message.includes('billing') || err.message.includes('BILLING')) {
      console.error('\n  Vision API requires billing to be enabled on the project.');
    }
    process.exit(1);
  }

  // Step 2: Sticker masking with Sharp
  console.log('\n--- Step 2: Sticker masking (Sharp) ---');
  let maskedBuffer;
  try {
    maskedBuffer = await applyStickerMasks(imageBuffer, faces);
    console.log(`  Masked image size: ${(maskedBuffer.length / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error('  FAILED:', err.message);
    process.exit(1);
  }

  // Save locally for visual inspection
  const outputPath = path.join(__dirname, 'test-masked-output.jpg');
  fs.writeFileSync(outputPath, maskedBuffer);
  console.log(`  Saved to: ${outputPath}`);

  // Step 3: GCS upload
  console.log('\n--- Step 3: GCS upload (playground_app_bucket) ---');
  try {
    const publicUrl = await uploadBufferToPublic(maskedBuffer, 'test-sticker-check');
    console.log(`  Uploaded: ${publicUrl}`);
  } catch (err) {
    console.error('  FAILED:', err.message);
    if (err.message.includes('permission') || err.message.includes('403')) {
      console.error('\n  The service account lacks GCS write permissions.');
      console.error('  Ensure "Storage Object Creator" role is granted on playground_app_bucket.');
    }
    process.exit(1);
  }

  console.log('\nAll steps passed. The sticker pipeline is working.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
