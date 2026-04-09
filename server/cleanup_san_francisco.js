const { connectToServer } = require('./src/database');

async function cleanupSF() {
    console.log("Connecting to database for surgical SF cleanup...");
    const db = await connectToServer();
    
    // Target any records in the San Francisco/Daly City region
    const query = {
        latitude: { $lt: 38.0 },
        longitude: { $lt: -120.0 }
    };

    try {
        const count = await db.collection('playgrounds').countDocuments(query);
        
        if (count === 0) {
            console.log("✅ No San Francisco records found. Database is already clean of these accidental entries.");
        } else {
            console.log(`🔍 Found ${count} records from the San Francisco area.`);
            const result = await db.collection('playgrounds').deleteMany(query);
            console.log(`✅ Successfully deleted ${result.deletedCount} San Francisco records.`);
        }

    } catch (error) {
        console.error("❌ Surgical cleanup failed:", error.message);
    }

    process.exit(0);
}

cleanupSF();
