/**
 * Script to clear a stale seed lock
 * Usage: node scripts/clearSeedLock.js <regionKey>
 * 
 * Example: node scripts/clearSeedLock.js gretna-ne
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { connectToServer, getDb } = require('../src/database');

async function main() {
    if (process.argv.length < 3) {
        console.error('Usage: node scripts/clearSeedLock.js <regionKey>');
        process.exit(1);
    }

    const regionKey = process.argv[2];
    
    await connectToServer();
    const db = getDb();

    const region = await db.collection('seeded_regions').findOne({ regionKey });
    
    if (!region) {
        console.log(`Region ${regionKey} not found`);
        process.exit(0);
    }

    if (region.seedStatus !== 'running' && region.seedStatus !== 'partial') {
        console.log(`Region ${regionKey} is not locked (status: ${region.seedStatus})`);
        process.exit(0);
    }

    // Clear the lock
    await db.collection('seeded_regions').updateOne(
        { regionKey },
        { $set: { seedStatus: 'partial', seedStartedAt: new Date() } }
    );
    
    console.log(`Successfully cleared seed lock for ${regionKey}`);
    console.log(`Previous status: ${region.seedStatus}`);
    console.log(`New status: partial`);

    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
