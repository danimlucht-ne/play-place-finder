/**
 * Script to unarchive a playground
 * Usage: node scripts/unarchivePlayground.js <playground_id>
 * 
 * Example: node scripts/unarchivePlayground.js 64f1a9f7c2a7d9b123456789
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { connectToServer, getDb } = require('../src/database');

async function main() {
    if (process.argv.length < 3) {
        console.error('Usage: node scripts/unarchivePlayground.js <playground_id>');
        process.exit(1);
    }

    const playgroundId = process.argv[2];
    
    await connectToServer();
    const db = getDb();

    const archived = await db.collection('archived_playgrounds').findOne({ _id: playgroundId });
    
    if (!archived) {
        console.log(`Playground ${playgroundId} not found in archived_playgrounds`);
        process.exit(0);
    }

    // Remove archiveInfo to restore to original state
    const { archiveInfo, ...originalDoc } = archived;
    
    // Insert back to playgrounds collection
    await db.collection('playgrounds').insertOne(originalDoc);
    
    // Delete from archived_playgrounds
    await db.collection('archived_playgrounds').deleteOne({ _id: playgroundId });
    
    console.log(`Successfully unarchived playground: ${originalDoc.name}`);
    console.log(`Region: ${originalDoc.regionKey}`);
    console.log(`Status: ${originalDoc.status}`);

    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
