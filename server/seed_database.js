require('dotenv').config();
const axios = require('axios');
const { connectToServer, getDb } = require('./src/database');
const { ObjectId } = require('mongodb');

// --- SEEDING MODE CONFIGURATION ---
// MODE 1: PUBLIC OUTDOOR PARKS
// const SEARCH_KEYWORD = "playground";
// const SEARCH_TYPE = "park";
// const IS_INDOOR_DEFAULT = false;
// const IS_OUTDOOR_DEFAULT = true;
// const PLAYGROUND_TYPE_DEFAULT = "Public";

// MODE 2: INDOOR FAMILY FUN (Urban Air, Sky Zone, Soft Play)
const SEARCH_KEYWORD = "indoor playground"; // Also try "trampoline park" or "family fun center"
const SEARCH_TYPE = "amusement_center"; // Or "establishment"
const IS_INDOOR_DEFAULT = true;
const IS_OUTDOOR_DEFAULT = false;
const PLAYGROUND_TYPE_DEFAULT = "Indoor";
// ----------------------------------

// --- GEOGRAPHIC CONFIGURATION ---
const BOUNDING_BOX = {
    north: 41.495854,
    south: 40.936420,
    west: -96.274884,
    east: -95.891360,
};

const STEP_MILES = 2.0; // Distance between grid search points
const SEARCH_RADIUS_METERS = 3500; // Approx 2.1 miles (slightly more than step for overlap)
const MIN_RANKING_FOR_SEED = 3; 

// --- SYSTEM CONFIG ---
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const DB_COLLECTION = 'playgrounds';

const milesToDeg = (miles) => miles / 69.0;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runSeeding() {
    if (!GOOGLE_PLACES_API_KEY) {
        console.error("ERROR: GOOGLE_PLACES_API_KEY environment variable not set.");
        process.exit(1);
    }

    console.log(`Connecting to database... Mode: ${PLAYGROUND_TYPE_DEFAULT}`);
    const db = await connectToServer();
    console.log("Database connected. Starting seed operation...");

    const latStep = milesToDeg(STEP_MILES);
    const lngStep = milesToDeg(STEP_MILES);
    let totalAdded = 0;
    let totalSkipped = 0;

    for (let lat = BOUNDING_BOX.south; lat < BOUNDING_BOX.north; lat += latStep) {
        for (let lng = BOUNDING_BOX.west; lng < BOUNDING_BOX.east; lng += lngStep) {
            console.log(`\n--- Searching ${SEARCH_KEYWORD} at: ${lat.toFixed(4)}, ${lng.toFixed(4)} ---`);
            
            let nextPageToken = null;
            let pageCount = 0;
            do {
                let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${SEARCH_RADIUS_METERS}&type=${SEARCH_TYPE}&keyword=${SEARCH_KEYWORD}&key=${GOOGLE_PLACES_API_KEY}`;
                if (nextPageToken) {
                    url += `&pagetoken=${nextPageToken}`;
                    await sleep(2500); 
                }

                try {
                    const response = await axios.get(url);
                    const { results, next_page_token, status: apiStatus } = response.data;

                    if (apiStatus === 'ZERO_RESULTS') {
                        console.log('  -> No results for this grid point.');
                        nextPageToken = null;
                        continue;
                    }
                    if (apiStatus !== 'OK') {
                        console.error(`  -> Google Places API Error: ${apiStatus}`);
                        nextPageToken = null;
                        continue;
                    }

                    nextPageToken = next_page_token;
                    pageCount++;

                    for (const place of results) {
                        const { place_id, name, geometry, rating, vicinity, photos } = place;

                        const existingPlace = await db.collection(DB_COLLECTION).findOne({ googlePlaceId: place_id });

                        if (!existingPlace) {
                            if (rating && rating < MIN_RANKING_FOR_SEED) {
                                console.log(`  -> Skipping ${name} (Rating too low: ${rating})`);
                                totalSkipped++;
                                continue;
                            }

                            const newPlaygroundRecord = {
                                name: name,
                                googlePlaceId: place_id,
                                description: `A family-friendly spot identified near ${vicinity || 'this location'} by Google. Community verification needed.`,
                                latitude: geometry.location.lat,
                                longitude: geometry.location.lng,
                                location: {
                                    type: "Point",
                                    coordinates: [geometry.location.lng, geometry.location.lat]
                                },
                                atmosphere: "Unknown",
                                groundType: IS_INDOOR_DEFAULT ? "Padded/Soft" : "Unknown",
                                equipment: [],
                                sportsCourts: [],
                                imageUrls: photos && photos.length > 0 ? [`https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photos[0].photo_reference}&key=${GOOGLE_PLACES_API_KEY}`] : [],
                                isIndoor: IS_INDOOR_DEFAULT,
                                isOutdoor: IS_OUTDOOR_DEFAULT,
                                costRange: IS_INDOOR_DEFAULT ? "$$" : "Free", // Indoor places usually cost money
                                isAccessible: false,
                                hasWalkingPath: false,
                                ageRange: "All Ages",
                                costToEnter: IS_INDOOR_DEFAULT ? "Paid admission" : "Free",
                                cleanlinessRating: 3,
                                atmosphereRating: 3,
                                crowdRating: 3,
                                modernityRating: 3,
                                safetyScore: 50,
                                amenityScore: 50,
                                playgroundType: PLAYGROUND_TYPE_DEFAULT,
                                parkingSituation: "Unknown",
                                swingTypes: [],
                                customIdentifiers: null,
                                lastUpdated: new Date(),
                                createdAt: new Date()
                            };

                            await db.collection(DB_COLLECTION).insertOne(newPlaygroundRecord);
                            console.log(`  -> Added: ${name} (${PLAYGROUND_TYPE_DEFAULT})`);
                            totalAdded++;
                        } else {
                            console.log(`  -> Skipping (already exists): ${name}`);
                            totalSkipped++;
                        }
                    }

                } catch (error) {
                    console.error(`  -> ERROR:`, error.message);
                    nextPageToken = null;
                }
                
                await sleep(1500);

            } while (nextPageToken && pageCount < 3); 
        }
    }

    console.log(`\n✅ Seed operation complete.`);
    console.log(`Total new places added: ${totalAdded}`);
    console.log(`Total places skipped: ${totalSkipped}`);
    process.exit(0);
}

runSeeding();
