const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const adTrackingService = require('../services/adTrackingService');

function hashVisitorKey(req) {
  if (req.user?.uid) {
    return crypto.createHash('sha256').update(`uid:${req.user.uid}`).digest('hex');
  }
  const sessionId = req.get('x-ad-session-id') || req.get('x-session-id') || '';
  const ua = req.get('user-agent') || '';
  const ip = req.ip || req.socket?.remoteAddress || '';
  const source = sessionId ? `sid:${sessionId}` : `anon:${ip}:${ua}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

// POST / — record impression or click event
router.post('/', async (req, res) => {
  try {
    const { type, adId, campaignId, cityId, placement } = req.body;

    if (!type || !adId || !cityId || !placement) {
      return res.status(400).json({ error: 'type, adId, cityId, and placement are required' });
    }

    if (!['impression', 'click'].includes(type)) {
      return res.status(400).json({ error: 'type must be impression or click' });
    }

    await adTrackingService.recordEvent({
      type,
      adId,
      campaignId,
      cityId,
      placement,
      userId: req.user?.uid || null,
      visitorKey: hashVisitorKey(req),
    });

    res.json({ message: 'success' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
