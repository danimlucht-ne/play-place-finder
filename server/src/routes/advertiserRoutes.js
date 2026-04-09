const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /me — return the authenticated user's advertiser record
router.get('/me', async (req, res) => {
  try {
    const db = getDb();
    const advertiser = await db.collection('advertisers').findOne({ userId: req.user.uid });
    if (!advertiser) {
      return res.status(404).json({ error: 'Advertiser not found' });
    }
    res.json({ message: 'success', data: advertiser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
