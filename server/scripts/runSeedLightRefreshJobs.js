require('dotenv').config();

const { runQueuedLightRefreshJobs } = require('../src/services/seedLightRefreshService');

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : undefined;

runQueuedLightRefreshJobs({ ...(Number.isFinite(limit) ? { limit } : {}) })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
