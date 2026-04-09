const vision = require('@google-cloud/vision');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const visionClient = new vision.ImageAnnotatorClient(
    process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }
        : {}
);

// --- DYNAMIC STICKER LOADING ---
const stickersDir = path.join(__dirname, '../../assets/stickers');
let stickerBuffers = [];

try {
    stickerBuffers = fs.readdirSync(stickersDir)
        .filter(file => file.endsWith('.png'))
        .map(file => fs.readFileSync(path.join(stickersDir, file)));

    if (stickerBuffers.length === 0) {
        console.error("Warning: No sticker assets found in the /assets/stickers directory. Face masking will not apply.");
    }
} catch (error) {
    console.error(`Error loading sticker assets from ${stickersDir}:`, error.message);
}

const getRandomSticker = () => {
    if (stickerBuffers.length === 0) return null; // Fallback
    const randomIndex = Math.floor(Math.random() * stickerBuffers.length);
    return stickerBuffers[randomIndex];
};
// ---------------------------------

async function detectFaces(imageBuffer) {
    const [result] = await visionClient.faceDetection(imageBuffer);
    return result.faceAnnotations || [];
}

async function applyStickerMasks(imageBuffer, faces) {
    const compositeOperations = await Promise.all(
        faces.map(async (face) => {
            const box = face.boundingPoly.vertices;
            const width = Math.abs(box[1].x - box[0].x);
            const height = Math.abs(box[2].y - box[1].y);

            const stickerBuffer = getRandomSticker();
            if (!stickerBuffer) {
                // Fallback to a plain teal circle if no stickers are loaded
                return { input: Buffer.from('<svg><circle cx="${width/2}" cy="${height/2}" r="${width/2}" fill="teal" /></svg>'), left: Math.round(box[0].x), top: Math.round(box[0].y) }; 
            }

            const resizedSticker = await sharp(stickerBuffer)
                .resize(Math.round(width), Math.round(height), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }) // Maintain aspect ratio, transparent background
                .toBuffer();

            return {
                input: resizedSticker,
                left: Math.round(box[0].x),
                top: Math.round(box[0].y),
            };
        })
    );

    return sharp(imageBuffer).composite(compositeOperations).toBuffer();
}

module.exports = { detectFaces, applyStickerMasks };
