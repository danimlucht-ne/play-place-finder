/**
 * Diagnostic script — shows what's actually stored in MongoDB for playgrounds.
 * Helps debug why type inference isn't working.
 *
 * Usage: node scripts/inspectPlaygroundTypes.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');

async function run() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) { console.error('❌  MONGODB_URI not set'); process.exit(1); }

    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(resolveMongoDbName());

    const total = await db.collection('playgrounds').countDocuments({ archivedAt: { $exists: false } });
    console.log(`\nTotal active playgrounds: ${total}\n`);

    // 1. Distribution of current playgroundType values
    const typeDist = await db.collection('playgrounds').aggregate([
        { $match: { archivedAt: { $exists: false } } },
        { $group: { _id: '$playgroundType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
    ]).toArray();
    console.log('--- playgroundType distribution ---');
    typeDist.forEach(r => console.log(`  ${String(r._id ?? 'null').padEnd(25)} ${r.count}`));

    // 2. How many docs have a `types` array stored
    const hasTypes = await db.collection('playgrounds').countDocuments({
        archivedAt: { $exists: false },
        types: { $exists: true, $not: { $size: 0 } }
    });
    const noTypes = await db.collection('playgrounds').countDocuments({
        archivedAt: { $exists: false },
        $or: [{ types: { $exists: false } }, { types: { $size: 0 } }, { types: null }]
    });
    console.log(`\n--- types field presence ---`);
    console.log(`  Has types array:   ${hasTypes}`);
    console.log(`  Missing/empty:     ${noTypes}`);

    // 3. Sample 10 docs that look like schools by name but have no school type label
    const schoolNameDocs = await db.collection('playgrounds').find({
        archivedAt: { $exists: false },
        name: { $regex: /elementary|primary|kindergarten/i },
    }).limit(10).toArray();
    console.log(`\n--- Docs with school-like names (up to 10) ---`);
    schoolNameDocs.forEach(d => {
        console.log(`  name:          ${d.name}`);
        console.log(`  playgroundType: ${d.playgroundType ?? 'null'}`);
        console.log(`  types:         ${JSON.stringify(d.types ?? [])}`);
        console.log('');
    });

    // 4. Sample 5 docs with no types field so we can see their raw structure
    const noTypesDocs = await db.collection('playgrounds').find({
        archivedAt: { $exists: false },
        $or: [{ types: { $exists: false } }, { types: null }]
    }).limit(5).toArray();
    console.log(`--- Sample docs missing types field ---`);
    noTypesDocs.forEach(d => {
        const keys = Object.keys(d).filter(k => !['_id','location','imageUrls','trustScores'].includes(k));
        console.log(`  name: ${d.name}`);
        console.log(`  fields present: ${keys.join(', ')}`);
        console.log('');
    });

    await client.close();
    process.exit(0);
}

run().catch(err => { console.error(err.message); process.exit(1); });
