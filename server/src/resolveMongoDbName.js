'use strict';

/**
 * Resolves MongoDB database name for Playground server and scripts.
 *
 * Precedence:
 * 1. MONGODB_DB or MONGODB_DB_NAME — explicit override (backward compatible).
 * 2. MONGODB_DB_ENV — TEST → MONGODB_DB_TEST (default PlayPlaceTest), PROD → MONGODB_DB_PROD (default PlayPlaceProd).
 * 3. Legacy default PlaygroundApp when unset.
 */
function resolveMongoDbName() {
    const explicit = process.env.MONGODB_DB || process.env.MONGODB_DB_NAME;
    if (explicit) {
        return explicit;
    }

    const mode = String(process.env.MONGODB_DB_ENV || '').trim().toUpperCase();
    if (mode === 'PROD') {
        return process.env.MONGODB_DB_PROD || 'PlayPlaceProd';
    }
    if (mode === 'TEST') {
        return process.env.MONGODB_DB_TEST || 'PlayPlaceTest';
    }

    return 'PlaygroundApp';
}

module.exports = { resolveMongoDbName };
