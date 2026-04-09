const { GoogleGenAI } = require('@google/genai');
const { logGeminiCall } = require('./geminiCostLogger');
const { resizeForGemini, getMaxEdge } = require('./geminiImageResize');

let ai;

try {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (error) {
    console.error("Error initializing GoogleGenAI. Check GEMINI_API_KEY.", error.message);
    ai = { models: { generateContent: async () => ({ text: '{ "photoUseful": false, "playgroundVisible": false, "peopleDetected": true, "recommendedAction": "REJECT", "confidence": 0.0, "notes": "AI not initialized." }' }) } };
}

async function getGeminiSummary(imageBuffer, faceCount, placeTypes = [], placeName = "") {
    if (process.env.GEMINI_DISABLE_MULTIMODAL === '1' || process.env.GEMINI_DISABLE_MULTIMODAL === 'true') {
        return {
            photoUseful: false,
            playgroundVisible: false,
            peopleDetected: faceCount > 0,
            faceCount: faceCount,
            recommendedAction: "REJECT",
            confidence: 0.0,
            relevanceScore: 0.0,
            overviewScore: 0.0,
            notes: "Multimodal Gemini disabled via GEMINI_DISABLE_MULTIMODAL.",
            aiFailed: true,
        };
    }

    const maxAttempts = parseInt(process.env.GEMINI_MAX_ATTEMPTS || "3", 10);
    const retryDelayMs = parseInt(process.env.GEMINI_RETRY_DELAY_MS || "1000", 10);
    const modelMultimodal = process.env.GEMINI_MODEL_MULTIMODAL || process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-flash";
    const modelFallback = process.env.GEMINI_MODEL_FALLBACK || "";
    const modelsToTry = modelFallback ? [modelMultimodal, modelFallback] : [modelMultimodal];

    const types = Array.isArray(placeTypes) ? placeTypes : [];
    const typesLower = types.map(t => String(t).toLowerCase());
    const nameLower = String(placeName || "").toLowerCase();

    const isLibrary = typesLower.some(t => t.includes("library"));
    const isZoo = typesLower.some(t => t.includes("zoo"));
    const isAquarium = typesLower.some(t => t.includes("aquarium"));
    const isMuseum = typesLower.some(t => t.includes("museum"));
    const isArcade = typesLower.some(t => t.includes("arcade") || t.includes("amusement_arcade"))
        || nameLower.includes("arcade")
        || nameLower.includes("beercade")
        || nameLower.includes("brewcade");
    const isWaterVenue =
        typesLower.includes("swimming_pool") ||
        /\bsplash\b|spray\s*pad|sprayground|water\s*park|waterpark|aquatic|natatorium|\bpool\b/i.test(nameLower);
    const isBarVenue =
        typesLower.some(t => t.includes("bar") || t.includes("night_club") || t.includes("liquor_store"))
        || nameLower.includes("beercade")
        || nameLower.includes("brewcade");

    // If something is marketed/typed as a bar venue, we do not treat it as a valid play place
    // (even if it also has games). This matches your "bar should not be a play place" rule.
    const contextRules = isBarVenue
        ? [
            "Location context: BAR / ADULT-ORIENTED VENUE.",
            "If the place is a bar venue, then this photo should be treated as NOT RELEVANT for a play place.",
            "Return photoUseful=false and playgroundVisible=false; recommend REJECT regardless of arcade-like signals."
        ].join(" ")
        : (isLibrary
        ? [
            "Location context: LIBRARY.",
            "Treat as RELEVANT (photoUseful=true, playgroundVisible=true) only if at least one is clearly visible:",
            "- books/reading material (e.g., shelves with books, reading area)",
            "- children's reading corner / story-time / kid activity space",
            "Treat as NOT RELEVANT (photoUseful=false, playgroundVisible=false) if the photo mainly shows:",
            "parking/entrance/exterior only, offices/desks/computers-only, adult-only areas, or generic hallways with no kid/library activity evidence."
        ].join(" ")
        : isZoo
            ? [
                "Location context: ZOO.",
                "Treat as RELEVANT (photoUseful=true, playgroundVisible=true) only if at least one is clearly visible:",
                "- animals (animal body clearly visible) OR",
                "- zoo enclosures/exhibits with animals OR",
                "- kid-friendly animal interaction signage/areas.",
                "Treat as NOT RELEVANT if the photo mainly shows:",
                "gift shop/restaurant only, empty walkway, staff-only areas, or exterior building without animal/exhibit evidence."
            ].join(" ")
        : (isAquarium || isMuseum)
                ? [
                    "Location context: MUSEUM/AQUARIUM.",
                    "Treat as RELEVANT (photoUseful=true, playgroundVisible=true) only if at least one is clearly visible:",
                    "- exhibits (artifacts/plants/displays) OR",
                    "- animals/tanks OR",
                    "- kid-friendly exhibit areas.",
                    "Treat as NOT RELEVANT if the photo mainly shows:",
                    "offices/front desk only, generic interior with no exhibits/tanks visible, or exterior building without exhibit evidence."
            ].join(" ")
        : isArcade
            ? [
                "Location context: ARCADE / FAMILY ENTERTAINMENT.",
                "Treat as RELEVANT (photoUseful=true, playgroundVisible=true) only if at least one is clearly visible:",
                "- arcade cabinets/games (screens/controls) OR",
                "- family-friendly arcade play area (tickets, claw machines, kid game areas) OR",
                "- signage/areas that indicate kid/family gameplay.",
                "Treat as NOT RELEVANT if the photo mainly shows:",
                "- adult-only gambling/lottery areas, bar/beer signage, staff-only areas, or exterior building without arcade/game evidence."
            ].join(" ")
        : isWaterVenue
            ? [
                "Location context: SPLASH PAD / POOL / AQUATIC VENUE.",
                "Treat as RELEVANT (photoUseful=true, playgroundVisible=true) only if water play is clearly visible: spray/splash features, pool water, pool deck, lifeguard stand, fencing around water, fountains, or other obvious aquatic infrastructure.",
                "Treat as NOT RELEVANT (photoUseful=false, playgroundVisible=false) if the photo shows only a house, garage, driveway, generic residential street, lawn, or trees with NO visible water features — do NOT assume a random house photo matches a splash pad or pool listing.",
                "If unsure whether water features exist in frame, set photoUseful=false and relevanceScore below 0.35."
            ].join(" ")
        : [
                "Location context: PLAY PLACE / PARK.",
                "Treat as RELEVANT (photoUseful=true, playgroundVisible=true) only if at least one is clearly visible:",
                "- play equipment/amenities OR",
                "- kid-friendly animal exhibits/enclosures OR",
                "- visible books/reading area OR",
                "- kid-friendly educational exhibits/displays.",
                "Treat as NOT RELEVANT if the photo mainly shows: generic outdoor landscaping, parking/entrance without play elements, staff-only areas, unrelated scenes, OR a single-family house/residential exterior with no park or play evidence.",
                "CRITICAL: A photo of only a house, porch, or backyard fence (no visible park/play equipment) must get photoUseful=false, relevanceScore and overviewScore below 0.35, recommendedAction=REJECT."
            ].join(" ")
        );

    const prompt = `
        Analyze this image for a family-friendly location. The photo has ${faceCount} faces detected by a separate service.
        ${contextRules}

        Provide a JSON summary:
        - photoUseful: true only if the photo includes clear evidence of the location-appropriate content described above; false otherwise.
        - playgroundVisible: true only if the primary subject is that relevant content; false otherwise.
        - relevanceScore: a number from 0.0 to 1.0 representing how applicable this photo is to the place's type/name (park vs library vs zoo vs museum vs arcade, etc.). 1.0 means strong matching evidence; 0.0 means mostly irrelevant or ambiguous.
        - overviewScore: a number from 0.0 to 1.0 representing how well the photo shows a useful "venue overview" (e.g., visible play equipment/reading area/enclosures/signage) rather than only people/kids closeups or generic exterior/entry shots. 1.0 means clear venue/equipment in the frame; 0.0 means people-only or unrelated scenes.
        - peopleDetected: true if any people are visible in the image, regardless of face count.
        - faceCount: The number of faces provided (${faceCount}).
        - recommendedAction: "AUTO_APPROVE" if photoUseful is true AND faceCount is 0. "NEEDS_ADMIN_REVIEW" if photoUseful is true AND faceCount > 0. "REJECT" otherwise.
        - confidence: your confidence (0.0 to 1.0) in the recommendedAction.
        - notes: brief explanation mentioning what evidence (books/animals/exhibits/play equipment) you used to decide.
        - detectedFeatures: an object with the following optional arrays. Only include items you can clearly see in the photo — do not guess.
          - equipment: visible play equipment from this list: "Swings", "Slide", "Climbing Wall", "Monkey Bars", "Sandbox", "Seesaw", "Spring Riders", "Balance Beam", "Zip Line", "Trampoline", "Tunnel", "Merry-Go-Round"
          - swingTypes: if swings are visible, which types: "Belt", "Bucket", "Tire", "Accessible"
          - amenities: visible amenities from this list: "Bathrooms", "Shade", "Fenced", "Picnic Tables", "Bottle Filler", "Benches", "Trash Cans", "Parking", "Splash Pad"
          - groundSurface: the ground surface type if visible: "Grass", "Rubber", "Wood Chips", "Sand", "Pea Gravel", "Concrete", "Turf"
          - sportsCourts: visible sports courts/fields: "Basketball", "Soccer", "Tennis", "Pickleball", "Volleyball", "Baseball", "Football"
        Ensure the response is valid JSON and strictly follows the schema. Do not add any text outside the JSON object.
    `;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    let resizedBuffer;
    try {
        resizedBuffer = await resizeForGemini(imageBuffer, getMaxEdge());
    } catch (_) {
        resizedBuffer = imageBuffer;
    }

    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        for (const model of modelsToTry) {
            try {
                const t0 = Date.now();
                const response = await ai.models.generateContent({
                    model,
                    contents: [
                        {
                            role: "user",
                            parts: [
                                { inlineData: { data: resizedBuffer.toString("base64"), mimeType: "image/jpeg" } },
                                { text: prompt }
                            ]
                        }
                    ],
                    config: {
                        responseMimeType: "application/json",
                        safetySettings: [
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                        ]
                    }
                });

                const responseText = response.text;
                try {
                    const parsedResponse = JSON.parse(responseText);
                    // Backfill score defaults if Gemini doesn't return them for some reason.
                    parsedResponse.relevanceScore = typeof parsedResponse.relevanceScore === "number" ? parsedResponse.relevanceScore : 0.0;
                    parsedResponse.overviewScore = typeof parsedResponse.overviewScore === "number" ? parsedResponse.overviewScore : 0.0;
                    parsedResponse.aiFailed = false;
                    logGeminiCall({
                        callSite: 'getGeminiSummary',
                        model,
                        multimodal: true,
                        ms: Date.now() - t0,
                    });
                    return parsedResponse;
                } catch (parseError) {
                    lastError = parseError;
                    // Retry if Gemini returns malformed JSON.
                }
            } catch (error) {
                lastError = error;
                // Retry for transient API errors (rate limits / timeouts / 5xx).
            }
        }

        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
    }

    console.error("Gemini getGeminiSummary failed after retries:", lastError?.message || lastError);
    return {
        photoUseful: false,
        playgroundVisible: false,
        peopleDetected: faceCount > 0,
        faceCount: faceCount,
        recommendedAction: "REJECT",
        confidence: 0.0,
        relevanceScore: 0.0,
        overviewScore: 0.0,
        notes: "AI classification failed after retries.",
        aiFailed: true
    };
}

async function getGeminiLocationValidation(places) {
    const model = process.env.GEMINI_MODEL_TEXT || process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash';
    try {
        const prompt = `
            You are an expert location moderator for a family-friendly playground finding app.
            I will provide a JSON array of places (with "id", "name", and "types").
            For each place, determine if it is genuinely a place where children go to play or explore.
            Valid family-friendly categories include: parks/playgrounds, children's museums and science centers, public libraries with children's areas/story time (or clearly kid-focused library branches), zoos and aquariums, and family-friendly arcades/amusement arcades and dedicated indoor play centers.
            STRICTLY REJECT: Hotels, resorts, hospitals, doctor's offices, clinics, supermarkets, grocery stores, generic corporate offices, banks, treasury offices, typical middle/high schools (unless it's a specific community playground), and bars/pubs/brewpubs (even if they also have games/activities). Also reject other adult-oriented venues.
            
            Return a JSON object where the keys are the place IDs and the values are booleans (true if valid play place, false if it should be rejected).
            Example output format:
            {
              "place_id_123": true,
              "place_id_456": false
            }
            Ensure the response is valid JSON and strictly follows the schema. Do not add any text outside the JSON object.
            
            Places to evaluate:
            ${JSON.stringify(places, null, 2)}
        `;
        
        const t0 = Date.now();
        const response = await ai.models.generateContent({
            model,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt }
                    ]
                }
            ],
            config: {
                responseMimeType: "application/json",
            }
        });

        const responseText = response.text;
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(responseText);
        } catch (parseError) {
            console.error("ERROR: Gemini location response was not valid JSON:", responseText, parseError);
            parsedResponse = {};
        }
        logGeminiCall({
            callSite: 'getGeminiLocationValidation',
            model,
            multimodal: false,
            batchSize: Array.isArray(places) ? places.length : 0,
            ms: Date.now() - t0,
        });
        return parsedResponse;
    } catch (error) {
        console.error("Gemini getGeminiLocationValidation failed:", error);
        return {};
    }
}

/**
 * Generates a short, kid-friendly description for a play place using Gemini.
 * Falls back gracefully if AI is unavailable.
 * @param {string} placeName
 * @param {string[]} placeTypes - Google place types array
 * @param {Buffer|null} heroImageBuffer - optional best photo buffer for visual context
 * @param {string} [editorialSummary] - optional Google editorial summary to refine
 * @returns {Promise<string>} 1-2 sentence description, or empty string on failure
 */
async function getGeminiDescription(placeName, placeTypes, heroImageBuffer = null, editorialSummary = '') {
    const skip =
        process.env.SKIP_GEMINI_DESCRIPTION === '1' ||
        process.env.SKIP_GEMINI_DESCRIPTION === 'true';
    if (skip) {
        return '';
    }

    const modelText = process.env.GEMINI_MODEL_TEXT || process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash';
    const modelMultimodal = process.env.GEMINI_MODEL_MULTIMODAL || process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash';
    const types = (placeTypes || []).join(', ');
    const summaryHint = editorialSummary
        ? `Google's summary says: "${editorialSummary}". Use this as a starting point but rewrite it to be more kid-friendly and concise.`
        : '';

    const prompt = `Write a short, friendly 1-2 sentence description for a family play place listing.
Place name: "${placeName}"
Place types: ${types}
${summaryHint}

Rules:
- Keep it under 30 words
- Focus on what makes it fun for kids and families
- Do not mention prices, hours, or specific addresses
- Do not start with "This is" or "Welcome to"
- Sound warm and inviting, not like a business listing
- Return ONLY the description text, no JSON, no quotes, no extra formatting`;

    const { retryWithBackoff } = require('./retryWithBackoff');

    const runGenerate = async (parts, model, attemptLabel) => {
        const t0 = Date.now();
        const response = await retryWithBackoff(
            () => ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts }],
            }),
            { maxRetries: 2, baseDelayMs: 2000, label: `gemini-desc-${placeName.slice(0, 20)}` }
        );
        logGeminiCall({
            callSite: 'getGeminiDescription',
            model,
            multimodal: parts.some((p) => p.inlineData),
            ms: Date.now() - t0,
            attempt: attemptLabel,
        });
        return (response.text || '').trim().replace(/^["']|["']$/g, '');
    };

    try {
        const textOnly = await runGenerate([{ text: prompt }], modelText, 'text');
        if (textOnly.length > 10) {
            return textOnly;
        }

        if (!heroImageBuffer) {
            return textOnly.length > 0 ? textOnly : '';
        }

        let imgBuf = heroImageBuffer;
        try {
            imgBuf = await resizeForGemini(heroImageBuffer, getMaxEdge());
        } catch (_) { /* use original */ }

        const withImage = await runGenerate(
            [
                { inlineData: { data: imgBuf.toString('base64'), mimeType: 'image/jpeg' } },
                { text: prompt },
            ],
            modelMultimodal,
            'image',
        );
        return withImage.length > 10 ? withImage : textOnly;
    } catch (err) {
        console.error(`[gemini] getGeminiDescription failed for "${placeName}":`, err.message);
        return '';
    }
}

module.exports = { getGeminiSummary, getGeminiLocationValidation, getGeminiDescription };
