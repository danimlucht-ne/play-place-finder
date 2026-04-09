// services/dynamicOptionsService.js
const { getDb } = require('../database');

/**
 * Checks incoming playground data for new, unseen options and saves them for admin review.
 * @param {object} playgroundData The submitted playground object from the user.
 */
async function processAndAddNewOptions(playgroundData) {
    const db = getDb();
    const {
        customAmenities = [],
        atmosphereList = [],
        equipment = [],
        swingTypes = [],
        sportsCourts = [],
        groundType,
        playgroundType,
        expense
    } = playgroundData;

    const allSubmittedOptions = [
        ...customAmenities.map(o => ({ value: o, type: 'amenity' })),
        ...atmosphereList.map(o => ({ value: o, type: 'atmosphere' })),
        ...equipment.map(o => ({ value: o, type: 'equipment' })),
        ...swingTypes.map(o => ({ value: o, type: 'swingType' })),
        ...sportsCourts.map(o => ({ value: o, type: 'sportsCourt' })),
        { value: groundType, type: 'groundType' },
        { value: playgroundType, type: 'playgroundType' },
        { value: expense, type: 'expense' }
    ].filter(o => o.value && typeof o.value === 'string' && o.value.trim() !== '');

    if (allSubmittedOptions.length === 0) return;

    try {
        // Use a bulk write operation to efficiently check and insert new options
        const bulkOps = allSubmittedOptions.map(option => ({
            updateOne: {
                filter: { value: option.value, type: option.type },
                update: {
                    $setOnInsert: {
                        value: option.value,
                        type: option.type,
                        isApproved: false, // All new options require admin approval
                        createdAt: new Date()
                    }
                },
                upsert: true
            }
        }));

        if (bulkOps.length > 0) {
            await db.collection('dynamic_options').bulkWrite(bulkOps);
        }
    } catch (error) {
        console.error("Failed to process dynamic options:", error);
        // We don't throw an error here because the playground submission should still succeed
        // even if the dynamic option processing fails.
    }
}

/**
 * Fetches all approved dynamic options to populate the app's UI.
 */
async function getApprovedOptions() {
    const db = getDb();
    try {
        const options = await db.collection('dynamic_options').find({ isApproved: true }).toArray();
        // Group by type for easy consumption by the client
        return options.reduce((acc, option) => {
            if (!acc[option.type]) {
                acc[option.type] = [];
            }
            acc[option.type].push(option.value);
            return acc;
        }, {});
    } catch (error) {
        console.error("Failed to fetch approved options:", error);
        return {}; // Return empty object on failure
    }
}

module.exports = { processAndAddNewOptions, getApprovedOptions };
