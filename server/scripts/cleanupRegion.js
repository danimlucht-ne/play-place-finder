const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { MongoClient } = require("mongodb");
const { resolveMongoDbName } = require("../src/resolveMongoDbName");
const axios = require("axios");
const { isKidFriendlySeedCandidate } = require("../src/services/kidPlaceFilters");
const { getGeminiSummary } = require("../src/services/photoClassificationService");

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

function parseArgs(argv) {
  const args = { regionKey: null, dryRun: false, scrubPhotos: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!args.regionKey && !a.startsWith("--")) args.regionKey = a;
    if (a === "--dry-run") args.dryRun = true;
    if (a === "--no-scrub-photos") args.scrubPhotos = false;
  }
  return args;
}

async function main() {
  const { regionKey, dryRun, scrubPhotos } = parseArgs(process.argv);
  if (!regionKey) {
    throw new Error('Usage: node scripts/cleanupRegion.js <regionKey> [--dry-run] [--no-scrub-photos]');
  }

  const uri = process.env.MONGODB_URI;
  const dbName = resolveMongoDbName();
  if (!uri) throw new Error("Missing MONGODB_URI in server/.env");
  if (!GOOGLE_MAPS_API_KEY && scrubPhotos) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY in server/.env (required for photo scrubbing).");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const cursor = db.collection("playgrounds").find({ regionKey });

  let scanned = 0;
  let removed = 0;
  let photoUpdates = 0;
  const maxGooglePhotos = parseInt(process.env.SCRUB_MAX_GOOGLE_PHOTOS_PER_PLACE || "5", 10);

  while (await cursor.hasNext()) {
    const place = await cursor.next();
    scanned++;

    const keep = isKidFriendlySeedCandidate({ name: place.name, types: place.types });
    if (!keep) {
      if (dryRun) {
        console.log(`[DRY RUN] Would delete: ${place.name} (${place._id}) types=${JSON.stringify(place.types || [])}`);
      } else {
        await db.collection("playgrounds").deleteOne({ _id: place._id });
        removed++;
        console.log(`Deleted: ${place.name} (${place._id})`);
      }
      continue;
    }

    if (!scrubPhotos) continue;

    const urls = Array.isArray(place.imageUrls) ? place.imageUrls : [];
    const googleRefs = urls.filter((u) => typeof u === "string" && u.startsWith("google_photo:"));
    if (googleRefs.length === 0) continue;

    const scoredGoogleUrls = []; // google_photo:* urls kept with Gemini scores
    const unscoredGoogleUrls = []; // google_photo:* urls kept without scoring (to save Gemini demand)
    const otherUrls = []; // non-google_photo:* urls kept as-is
    let modified = false;
    let processedGooglePhotos = 0;

        for (const url of urls) {
      if (!url || typeof url !== "string") continue;
      if (!url.startsWith("google_photo:")) {
        otherUrls.push(url);
        continue;
      }

      if (processedGooglePhotos >= maxGooglePhotos) {
        // Keep remaining google photos without classification to reduce Gemini demand.
        unscoredGoogleUrls.push(url);
        continue;
      }

      const photoRef = url.split(":")[1];
      if (!photoRef) {
        modified = true;
        continue;
      }

        try {
        const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&photoreference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(photoUrl, { responseType: "arraybuffer", timeout: 30000 });
        const imageBuffer = Buffer.from(response.data, "binary");
            const geminiSummary = await getGeminiSummary(imageBuffer, 0, place.types || [], place.name || "");

            if (geminiSummary && geminiSummary.aiFailed === true) {
              // Safety fallback: keep photo on Gemini failure/throttling.
              scoredGoogleUrls.push({
                url,
                relevanceScore: 0.01,
                overviewScore: 0.01,
                confidence: 0.0
              });
              continue;
            }

            if (geminiSummary.photoUseful && geminiSummary.playgroundVisible) {
              scoredGoogleUrls.push({
                url,
                relevanceScore: typeof geminiSummary.relevanceScore === "number" ? geminiSummary.relevanceScore : 0.0,
                overviewScore: typeof geminiSummary.overviewScore === "number" ? geminiSummary.overviewScore : 0.0,
                confidence: typeof geminiSummary.confidence === "number" ? geminiSummary.confidence : 0.0
              });
            } else {
              modified = true;
              console.log(`Scrubbed photo for ${place.name}: ${geminiSummary.notes || "not useful"}`);
            }
        } catch (err) {
          // Safety fallback: keep photo on request/Gemini errors.
          scoredGoogleUrls.push({
            url,
            relevanceScore: 0.01,
            overviewScore: 0.01,
            confidence: 0.0
          });
          console.log(`Kept photo for ${place.name} due to error: ${err.message}`);
        }
    }

    // Sort kept google photos so the first one (home/front-facing) is the best match.
    scoredGoogleUrls.sort((a, b) => {
      const byRelevance = (b.relevanceScore || 0) - (a.relevanceScore || 0);
      if (byRelevance !== 0) return byRelevance;
      const byOverview = (b.overviewScore || 0) - (a.overviewScore || 0);
      if (byOverview !== 0) return byOverview;
      return (b.confidence || 0) - (a.confidence || 0);
    });

    const sortedUrls = [
      ...scoredGoogleUrls.map(x => x.url),
      ...unscoredGoogleUrls,
      ...otherUrls
    ];

    // Track reordering as a modification too.
    if (sortedUrls.join("||") !== urls.join("||")) {
      modified = true;
    }

    if (modified && !dryRun) {
      await db.collection("playgrounds").updateOne({ _id: place._id }, { $set: { imageUrls: sortedUrls } });
      photoUpdates++;
    } else if (modified && dryRun) {
      console.log(`[DRY RUN] Would update photos for: ${place.name} (${place._id}) keep=${sortedUrls.length}/${urls.length}`);
    }
  }

  console.log(
    `Cleanup complete for regionKey="${regionKey}". scanned=${scanned} removed=${removed}${dryRun ? " (dry run)" : ""} photoUpdates=${photoUpdates}`
  );

  await client.close();
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exitCode = 1;
});

