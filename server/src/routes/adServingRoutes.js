const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const adServingService = require('../services/adServingService');
const cityPhaseService = require('../services/cityPhaseService');
const pricingService = require('../services/pricingService');

// GET / — get a single random ad for city + placement
router.get('/', async (req, res) => {
  try {
    const { city_id, placement } = req.query;
    if (!city_id || !placement) {
      return res.status(400).json({ error: 'city_id and placement query params are required' });
    }

    const result = await adServingService.getAd(city_id, placement);
    res.json({ message: 'success', data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /all — get ALL active ads for city + placement (shuffled), for timed rotation
router.get('/all', async (req, res) => {
  try {
    const { city_id, placement } = req.query;
    if (!city_id || !placement) {
      return res.status(400).json({ error: 'city_id and placement query params are required' });
    }

    const result = await adServingService.getAllAds(city_id, placement);
    res.json({ message: 'success', data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /city-phase — public endpoint for city phase info
router.get('/city-phase', async (req, res) => {
  try {
    const { cityId } = req.query;
    if (!cityId) {
      return res.status(400).json({ error: 'cityId query param is required' });
    }
    const result = await cityPhaseService.getCityPhase(cityId);
    res.json({ message: 'success', data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /pricing — public endpoint for phase-aware pricing
router.get('/pricing', async (req, res) => {
  try {
    const { cityId, placement } = req.query;
    if (!cityId || !placement) {
      return res.status(400).json({ error: 'cityId and placement query params are required' });
    }
    const result = await pricingService.getPhasePrice(cityId, placement);
    res.json({ message: 'success', data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /daily-views — count of unique ad impressions for a city today (public)
router.get('/daily-views', async (req, res) => {
  try {
    const { cityId } = req.query;
    if (!cityId) {
      return res.status(400).json({ error: 'cityId query param is required' });
    }

    const db = getDb();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const count = await db.collection('adEvents').countDocuments({
      cityId,
      type: 'impression',
      timestamp: { $gte: startOfDay },
    });

    res.json({ message: 'success', data: { cityId, todayViews: count } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
