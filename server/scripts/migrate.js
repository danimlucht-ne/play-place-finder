const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { MongoClient } = require("mongodb");
const { resolveMongoDbName } = require("../src/resolveMongoDbName");

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = resolveMongoDbName();

  if (!uri) {
    throw new Error("Missing MONGODB_URI in server/.env");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Core geo indexes (used by search endpoints)
  await db.collection("playgrounds").createIndex({ location: "2dsphere" });
  await db.collection("businesses").createIndex({ location: "2dsphere" });

  // Contribution / leaderboard indexes
  await db.collection("users").createIndex({ score: -1 });
  await db.collection("users").createIndex({ city: 1, score: -1 });
  await db.collection("contribution_log").createIndex({ userId: 1 });
  await db.collection("contribution_log").createIndex({ createdAt: -1 });

  // Photo privacy pipeline TTLs
  await db.collection("photo_uploads").createIndex(
    { quarantineExpiresAt: 1 },
    { expireAfterSeconds: 0 }
  );
  await db.collection("moderation_queue").createIndex(
    { rejectionExpiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  // Data retention TTLs (90 days)
  const ninetyDaysSeconds = 90 * 24 * 60 * 60;
  await db.collection("crowd_reports").createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: ninetyDaysSeconds }
  );
  await db.collection("issue_reports").createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: ninetyDaysSeconds }
  );

  // Support ticket queue (admin review of complaints/questions/requests)
  await db.collection("support_tickets").createIndex({ actorUserId: 1 });
  await db.collection("support_tickets").createIndex({ status: 1, createdAt: -1 });

    // Seed job audit logs (per-region timeline of seeding + scrubbing decisions)
    await db.collection("seed_job_logs").createIndex({ regionKey: 1, createdAt: -1 });
    await db.collection("seed_job_logs").createIndex({ seedJobId: 1, createdAt: -1 });

  // Playground ratings — one rating per user per playground
  await db.collection("playground_ratings").createIndex(
    { playgroundId: 1, userId: 1 },
    { unique: true }
  );

  // --- Advertising MVP indexes ---

  // advertisers
  await db.collection("advertisers").createIndex({ userId: 1 }, { unique: true });
  await db.collection("advertisers").createIndex({ regionKey: 1, status: 1 });

  // adSubmissions
  await db.collection("adSubmissions").createIndex({ advertiserId: 1, status: 1 });
  await db.collection("adSubmissions").createIndex({ status: 1, createdAt: -1 });

  // adCampaigns
  await db.collection("adCampaigns").createIndex({ cityId: 1, placement: 1, status: 1, startDate: 1, endDate: 1 });
  await db.collection("adCampaigns").createIndex({ advertiserId: 1 });
  await db.collection("adCampaigns").createIndex({ status: 1, startDate: 1 });
  await db.collection("adCampaigns").createIndex({ status: 1, endDate: 1 });

  // adTargeting
  await db.collection("adTargeting").createIndex({ campaignId: 1 });
  await db.collection("adTargeting").createIndex({ cityId: 1, placement: 1 });

  // adEvents
  await db.collection("adEvents").createIndex({ campaignId: 1, type: 1, timestamp: 1 });
  await db.collection("adEvents").createIndex({ adId: 1, userId: 1, type: 1, timestamp: 1 });
  await db.collection("adEvents").createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
  );

  // paymentTransactions
  await db.collection("paymentTransactions").createIndex({ stripePaymentIntentId: 1 }, { unique: true });
  await db.collection("paymentTransactions").createIndex({ submissionId: 1 });

  // reviewFlags
  await db.collection("reviewFlags").createIndex({ submissionId: 1 });
  await db.collection("reviewFlags").createIndex({ resolvedAt: 1 });

  // cityAdSettings
  await db.collection("cityAdSettings").createIndex({ cityId: 1 }, { unique: true });

  // contractAgreements
  await db.collection("contractAgreements").createIndex({ submissionId: 1 });

  // Manual city label overrides (Google Place ID → forced display city / slug)
  await db.collection("locationOverrides").createIndex({ googlePlaceId: 1 }, { unique: true });

  console.log(`Migration complete for db "${dbName}".`);
  await client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});

