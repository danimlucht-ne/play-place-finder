const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('../src/resolveMongoDbName');

async function run() {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(resolveMongoDbName());
    const users = await db.collection('users').find({}).limit(5).toArray();
    console.log('Users collection sample:');
    users.forEach(u => console.log(JSON.stringify({ _id: u._id, email: u.email, role: u.role })));
    await client.close();
}
run().catch(console.error);