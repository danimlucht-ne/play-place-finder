const { Storage } = require('@google-cloud/storage');

const storage = new Storage(); // Assumes project ID and keyfile from env/default
const quarantineBucketName = "playground_app_bucket"; // same bucket, quarantine/ prefix for paths

async function deleteFromQuarantine(fileId) {
    try {
        const bucket = storage.bucket(quarantineBucketName);
        const file = bucket.file(fileId);
        await file.delete();
        console.log(`Deleted ${fileId} from quarantine bucket.`);
        return { success: true };
    } catch (error) {
        console.error(`Error deleting ${fileId} from quarantine bucket:`, error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { deleteFromQuarantine };
