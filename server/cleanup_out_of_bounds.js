require('dotenv').config();
const { connectToServer, getDb } = require('./src/database');

// --- BOUNDARY CONFIGURATION (Read from seed_database.js) ---
const BOUNDING_BOX = {
    north: 41.495854,
    south: 40.936420,
    west: -96.274884,
    east: -95.891360,
};

// SET THIS TO 'false' TO ACTUALLY PERFORM THE DELETION
const DRY_RUN = true; 

async function runCleanup() {
    console.log("Connecting to database for cleanup...");
    const db = await connectToServer();
    const collection = db.collection('playgrounds');

    // Query for records OUTSIDE the bounding box
    const query = {
        $or: [
            { latitude: { $gt: BOUNDING_BOX.north } },
            { latitude: { $lt: BOUNDING_BOX.south } },
            { longitude: { $lt: BOUNDING_BOX.west } },
            { longitude: { $gt: BOUNDING_BOX.east } }
        ]
    };

    try {
        const count = await collection.countDocuments(query);
        
        if (count === 0) {
            console.log("✅ No records found outside the bounding box. Database is already clean.");
            process.exit(0);
        }

        console.log(`\n🔍 Found ${count} records outside your target area.`);

        if (DRY_RUN) {
            const sample = await collection.find(query).limit(5).toArray();
            console.log("\n--- DRY RUN: Samples of records that would be deleted ---");
            sample.forEach(p => console.log(`  - ${p.name} (Lat: ${p.latitude}, Lng: ${p.longitude})`));
            console.log("\n⚠️  No deletions performed. Set DRY_RUN = false in the script to execute.");
        } else {
            console.log("\n🧨 EXECUTING DELETION...");
            const result = await collection.deleteMany(query);
            console.log(`✅ Successfully removed ${result.deletedCount} out-of-bounds records.`);
        }

    } catch (error) {
        console.error("❌ Cleanup failed:", error.message);
    }

    process.exit(0);
}

runCleanup();
