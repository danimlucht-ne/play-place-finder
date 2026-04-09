/**
 * Script to check why Bellbrook Park is not appearing
 * Usage: node scripts/checkBellbrookPark.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { connectToServer, getDb } = require('../src/database');

async function main() {
    await connectToServer();
    const db = getDb();

    console.log('=== Checking Bellbrook Park ===\n');

    // Check active playgrounds
    const active = await db.collection('playgrounds').findOne({
        $or: [
            { name: { $regex: /bellbrook/i } },
            { googlePlaceId: { $regex: /bellbrook/i } }
        ],
        archivedAt: { $exists: false },
        status: { $nin: ['closed', 'archived'] }
    });

    if (active) {
        console.log('FOUND in active playgrounds:');
        console.log(JSON.stringify(active, null, 2));
    } else {
        console.log('NOT found in active playgrounds.\n');

        // Check archived playgrounds
        const archived = await db.collection('archived_playgrounds').findOne({
            $or: [
                { name: { $regex: /bellbrook/i } },
                { googlePlaceId: { $regex: /bellbrook/i } }
            ]
        });

        if (archived) {
            console.log('FOUND in archived_playgrounds:');
            console.log(JSON.stringify(archived, null, 2));
        } else {
            console.log('NOT found in archived_playgrounds either.\n');

            // Check all playgrounds (no filter)
            const all = await db.collection('playgrounds').find({
                $or: [
                    { name: { $regex: /bellbrook/i } },
                    { googlePlaceId: { $regex: /bellbrook/i } }
                ]
            }).toArray();

            if (all.length > 0) {
                console.log('FOUND in playgrounds (with filters):');
                all.forEach(p => console.log(`- ${p.name} (status: ${p.status}, archivedAt: ${p.archivedAt ? 'yes' : 'no'})`));
            } else {
                console.log('NOT found in playgrounds at all.\n');

                // Check all archived
                const allArchived = await db.collection('archived_playgrounds').find({
                    $or: [
                        { name: { $regex: /bellbrook/i } },
                        { googlePlaceId: { $regex: /bellbrook/i } }
                    ]
                }).toArray();

                if (allArchived.length > 0) {
                    console.log('FOUND in archived_playgrounds (all):');
                    allArchived.forEach(p => console.log(`- ${p.name} (status: ${p.status}, archivedAt: ${p.archivedAt ? 'yes' : 'no'})`));
                } else {
                    console.log('NOT found in archived_playgrounds either.\n');
                    console.log('Bellbrook Park might not exist in the database.');
                }
            }
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
