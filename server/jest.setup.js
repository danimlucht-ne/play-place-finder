const path = require('path');
const fs = require('fs');

// Load the same .env the server uses so MONGODB_URI in server/.env is visible to Jest.
// (dotenv does not override vars already in process.env, but see below: we set defaults
// only after this, so a real URI in .env is used; shell export still wins over .env.)
const dotenvPath = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
].find((p) => fs.existsSync(p));
require('dotenv').config(dotenvPath ? { path: dotenvPath } : {});

// Default local URI only if neither shell nor .env provided one (unit tests with mocks).
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jest';
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'jest-test-key';
