/**
 * One-time script to grant admin role to a user by email.
 * Sets Firebase custom claim AND MongoDB role field.
 * Usage: node scripts/makeAdmin.js your@email.com
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const admin = require('firebase-admin');
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');
const { loadFirebaseServiceAccountJson } = require('../src/loadFirebaseServiceAccount');

const email = process.argv[2];
if (!email) {
    console.error('Usage: node scripts/makeAdmin.js your@email.com');
    process.exit(1);
}

const serviceAccount = loadFirebaseServiceAccountJson();
if (!serviceAccount) {
    console.error('No Firebase service account found. Set GOOGLE_APPLICATION_CREDENTIALS (path to JSON) or add server/serviceAccountKey.json (local, gitignored).');
    process.exit(1);
}
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

async function run() {
    let client;
    try {
        // 1. Set Firebase custom claim
        const user = await admin.auth().getUserByEmail(email);
        const uid = user.uid;
        await admin.auth().setCustomUserClaims(uid, { admin: true });
        console.log(`✅ Firebase admin claim set for ${email} (uid: ${uid})`);

        // 2. Set role in MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) {
            console.warn('⚠️  MONGODB_URI not set in .env');
            process.exit(1);
        }

        client = new MongoClient(mongoUri);
        await client.connect();
        const dbName = resolveMongoDbName();
        const db = client.db(dbName);

        // Debug: find the user doc by email to see what _id looks like
        const byEmail = await db.collection('users').findOne({ email });
        if (byEmail) {
            console.log(`Found user by email. _id = "${byEmail._id}" (type: ${typeof byEmail._id})`);
            const result = await db.collection('users').updateOne(
                { _id: byEmail._id },
                { $set: { role: 'admin' } }
            );
            console.log(`✅ MongoDB role set to "admin" (matched: ${result.matchedCount}, modified: ${result.modifiedCount})`);
        } else {
            // Try matching by uid field
            const byUid = await db.collection('users').findOne({ uid });
            if (byUid) {
                console.log(`Found user by uid field. _id = "${byUid._id}"`);
                await db.collection('users').updateOne({ _id: byUid._id }, { $set: { role: 'admin' } });
                console.log(`✅ MongoDB role set to "admin"`);
            } else {
                // Last resort: list all users so we can see the structure
                const sample = await db.collection('users').find({}).limit(3).toArray();
                console.warn(`⚠️  Could not find user. Sample docs:`);
                sample.forEach(d => console.log(JSON.stringify({ _id: d._id, email: d.email, uid: d.uid })));
            }
        }

        console.log('\nDone! Sign out and sign back in to activate admin access.');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        if (client) await client.close();
        process.exit(0);
    }
}

run();