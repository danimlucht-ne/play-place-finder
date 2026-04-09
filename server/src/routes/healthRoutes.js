const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

const startedAt = new Date();

// GET /health — public health check for uptime monitors (UptimeRobot, etc.)
router.get('/', async (req, res) => {
  const start = Date.now();
  try {
    const db = getDb();

    // Quick DB ping
    const pingOk = await db.command({ ping: 1 }).then(() => true).catch(() => false);

    // DB stats (data size, collections, indexes)
    const dbStats = await db.stats().catch(() => null);

    // Collection counts (lightweight)
    const [playgrounds, users, regions, campaigns, submissions] = await Promise.all([
      db.collection('playgrounds').estimatedDocumentCount().catch(() => -1),
      db.collection('users').estimatedDocumentCount().catch(() => -1),
      db.collection('seeded_regions').estimatedDocumentCount().catch(() => -1),
      db.collection('adCampaigns').estimatedDocumentCount().catch(() => -1),
      db.collection('adSubmissions').estimatedDocumentCount().catch(() => -1),
    ]);

    // Node process memory
    const mem = process.memoryUsage();

    const responseTimeMs = Date.now() - start;

    res.json({
      status: pingOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        startedAt: startedAt.toISOString(),
      },
      database: {
        connected: pingOk,
        dataSize: dbStats ? formatBytes(dbStats.dataSize) : 'unknown',
        dataSizeBytes: dbStats?.dataSize || 0,
        storageSize: dbStats ? formatBytes(dbStats.storageSize) : 'unknown',
        storageSizeBytes: dbStats?.storageSize || 0,
        indexSize: dbStats ? formatBytes(dbStats.indexSize) : 'unknown',
        collections: dbStats?.collections || 0,
        indexes: dbStats?.indexes || 0,
      },
      counts: {
        playgrounds,
        users,
        seededRegions: regions,
        adCampaigns: campaigns,
        adSubmissions: submissions,
      },
      memory: {
        rss: formatBytes(mem.rss),
        heapUsed: formatBytes(mem.heapUsed),
        heapTotal: formatBytes(mem.heapTotal),
        rssMB: Math.round(mem.rss / 1024 / 1024),
      },
      responseTimeMs,
      nodeVersion: process.version,
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
    });
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;
