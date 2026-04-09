const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const { verifyAdminToken } = require('../services/authService');
const seedOrchestratorService = require('../services/seedOrchestratorService');
const { initPhotoUpload, processPhoto } = require('../services/photoUploadService');
const { getConsentSnapshot, transformPlayground } = require('../utils/helpers');

// POST hybrid search — also registered on app before verifyToken (see index.js); handler must stay in sync.
async function hybridSearchHandler(req, res) {
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: "Latitude and Longitude are required." });

    try {
        const result = await seedOrchestratorService.handleHybridSearch(lat, lng, req.user?.uid ?? null);
        if (result.places) {
            const favIds = new Set();
            if (req.user?.uid) {
                const db = getDb();
                const favs = await db.collection("favorites").find({ userId: req.user.uid }).toArray();
                favs.forEach(f => favIds.add(f.placeId));
            }
            result.places = result.places.map(p => {
                const t = transformPlayground(p);
                const idStr = (p._id || p.id || '').toString();
                t.isFavorited = favIds.has(idStr);
                return t;
            });
        }
        res.json(result);
    } catch (error) {
        console.error("Hybrid search failed:", error);
        res.status(500).json({ error: "An unexpected error occurred during search." });
    }
}

// POST init photo upload
router.post("/photos/init", async (req, res) => {
    const { filename, contentType } = req.body;
    try {
        const consentSnapshot = await getConsentSnapshot(req.user.uid);
        const result = await initPhotoUpload(filename, contentType, consentSnapshot);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST process photo
router.post("/photos/process", async (req, res) => {
    const { photoRecordId, playgroundId } = req.body;
    try {
        const result = await processPhoto(photoRecordId, playgroundId, req.user.uid);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST create business (admin only)
router.post("/businesses", verifyAdminToken, async (req, res) => {
    const db = getDb();
    const { name, category, description, websiteUrl, latitude, longitude } = req.body;
    const business = {
        name, category, description, websiteUrl,
        location: { type: "Point", coordinates: [parseFloat(longitude), parseFloat(latitude)] }
    };
    try {
        await db.collection("businesses").insertOne(business);
        res.status(201).json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET nearby sponsors — contextual-only targeting (7.5)
// Only accepts lat, lng, and optional category — no user profile fields
router.get("/sponsors/nearby", async (req, res) => {
    const db = getDb();
    const { lat, lng, category } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Coordinates required" });
    try {
        const geoQuery = {
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                    $maxDistance: 3000
                }
            }
        };
        // Only filter by category if provided — never by user profile data
        if (category) geoQuery.category = category;

        const sponsors = await db.collection("businesses")
            .find(geoQuery)
            .limit(2)
            .project({ name: 1, category: 1, description: 1, websiteUrl: 1, location: 1 })
            .toArray();
        res.json({ message: "success", data: sponsors });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/advertisers — advertiser intake form (7.6)
router.post("/advertisers", async (req, res) => {
    const db = getDb();
    const { businessName, contactEmail, category, city, websiteUrl, description } = req.body || {};

    // Validate required fields
    if (!businessName || !contactEmail || !category || !city) {
        return res.status(400).json({ error: "businessName, contactEmail, category, and city are required." });
    }

    // Derive regionKey from city — never store behavioral data
    function normalizeRegionKey(c) {
        return c.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }
    const targetRegionKey = normalizeRegionKey(city);

    try {
        // Check for duplicate contactEmail
        const existing = await db.collection("advertiser_intakes").findOne({ contactEmail });
        if (existing) {
            return res.status(409).json({ error: "An intake with this contact email already exists." });
        }

        await db.collection("advertiser_intakes").insertOne({
            businessName,
            contactEmail,
            category,
            city,
            targetRegionKey,
            websiteUrl: websiteUrl || null,
            description: description ? description.slice(0, 300) : null,
            status: 'pending',
            createdAt: new Date(),
        });

        // Notify admin
        try {
            const { sendAdminNotificationEmail } = require('../services/notificationService');
            await sendAdminNotificationEmail(
                `New Advertiser Intake: ${businessName}`,
                `Business: ${businessName}\nEmail: ${contactEmail}\nCategory: ${category}\nCity: ${city}`,
                `<p><b>${businessName}</b> submitted an advertiser intake.<br>Email: ${contactEmail}<br>Category: ${category}<br>City: ${city}</p>`
            );
        } catch (notifyErr) {
            console.warn('Could not send admin notification for advertiser intake:', notifyErr.message);
        }

        res.status(201).json({ message: "success" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Single export so hybridSearchHandler is always on the same object Express returns (some Router builds drop late module.exports.* assigns).
module.exports = Object.assign(router, { hybridSearchHandler });
