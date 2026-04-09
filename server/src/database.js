const { MongoClient } = require('mongodb');
const { resolveMongoDbName } = require('./resolveMongoDbName');

const uri = process.env.MONGODB_URI;
const dbName = resolveMongoDbName();

if (!uri) {
  throw new Error("Missing MONGODB_URI. Set it in server/.env (or environment).");
}

const client = new MongoClient(uri);
let dbConnection;
module.exports = {
  connectToServer: async function () {
    try {
      await client.connect();
      dbConnection = client.db(dbName);

      // --- TTL Indexes for Data Retention Policy ---
      // Photo originals in quarantine (deleted 0 seconds after quarantineExpiresAt date)
      await dbConnection.collection('photo_uploads').createIndex({ "quarantineExpiresAt": 1 }, { expireAfterSeconds: 0 });
      // Rejected moderation items (deleted 0 seconds after rejectionExpiresAt date)
      await dbConnection.collection('moderation_queue').createIndex({ "rejectionExpiresAt": 1 }, { expireAfterSeconds: 0 });
      // Crowd and Issue reports (deleted after 90 days, already in index.js but good to confirm here)
      // await dbConnection.collection('crowd_reports').createIndex({ "createdAt": 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
      // await dbConnection.collection('issue_reports').createIndex({ "createdAt": 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
      // ------------------------------------------------

      console.log(`Successfully connected to MongoDB (db: ${dbName}).`);
      return dbConnection;
    } catch (err) {
      console.error("Failed to connect to MongoDB:", err);
      throw err;
    }
  },

  getDb: function () {
    return dbConnection;
  },
};
