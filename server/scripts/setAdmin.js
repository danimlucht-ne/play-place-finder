/**
 * Usage: node scripts/setAdmin.js <email>
 * Sets the admin custom claim on a Firebase user by email.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const admin = require('firebase-admin');
const { loadFirebaseServiceAccountJson } = require('../src/loadFirebaseServiceAccount');

const serviceAccount = loadFirebaseServiceAccountJson();
if (!serviceAccount) {
    console.error('No Firebase service account found. Set GOOGLE_APPLICATION_CREDENTIALS or add server/serviceAccountKey.json (local, gitignored).');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const email = process.argv[2];
if (!email) {
    console.error('Usage: node scripts/setAdmin.js <email>');
    process.exit(1);
}

admin.auth().getUserByEmail(email)
    .then(user => admin.auth().setCustomUserClaims(user.uid, { admin: true }))
    .then(() => {
        console.log(`✓ Admin claim set for ${email}`);
        process.exit(0);
    })
    .catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
