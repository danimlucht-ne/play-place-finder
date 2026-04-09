const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { ObjectId } = require('mongodb');
const adTrackingService = require('../services/adTrackingService');
const { calendarYmdFromValue, regionKeyToLabelMap } = require('../services/adCampaignDisplayHelpers');
const { inferDemoCampaign } = require('../utils/inferDemoCreative');

function creativeToPreview(creative) {
  if (!creative) return null;
  return {
    headline: creative.headline || '',
    body: creative.body || '',
    imageUrl: creative.imageUrl || null,
    ctaText: creative.ctaText || '',
    ctaUrl: creative.ctaUrl || '',
    businessName: creative.businessName || '',
  };
}

// GET /campaigns — list advertiser's campaigns with stats (same aggregation as campaign detail)
router.get('/campaigns', async (req, res) => {
  try {
    const db = getDb();
    const advertiser = await db.collection('advertisers').findOne({ userId: req.user.uid });
    if (!advertiser) return res.json({ message: 'success', data: [] });

    const campaigns = await db.collection('adCampaigns')
      .find({ advertiserId: advertiser._id })
      .sort({ createdAt: -1 })
      .toArray();

    const creativeIds = [...new Set(campaigns.map((c) => c.creativeId).filter(Boolean))];
    const creatives = creativeIds.length
      ? await db.collection('adCreatives').find({ _id: { $in: creativeIds } }).toArray()
      : [];
    const creativeMap = new Map(creatives.map((cr) => [cr._id.toString(), cr]));

    const allKeys = campaigns.flatMap((c) => {
      const keys = c.targetedRegionKeys && c.targetedRegionKeys.length
        ? c.targetedRegionKeys
        : [c.cityId].filter(Boolean);
      return keys;
    });
    const labelMap = await regionKeyToLabelMap(db, allKeys);

    const metricsMap = await adTrackingService.getCampaignListMetricsBatch(campaigns);

    const data = campaigns.map((c) => {
      const analytics = metricsMap.get(c._id.toString()) || { impressions: 0, clicks: 0, ctr: 0 };
      const cr = c.creativeId ? creativeMap.get(c.creativeId.toString()) : null;
      const keys = c.targetedRegionKeys && c.targetedRegionKeys.length
        ? c.targetedRegionKeys.map((k) => String(k))
        : [c.cityId].filter(Boolean).map((k) => String(k));
      const targetedCityLabels = keys.map((k) => labelMap[k] || k);
      return {
        _id: c._id.toString(),
        submissionId: c.submissionId ? c.submissionId.toString() : '',
        impressions: analytics.impressions || 0,
        clicks: analytics.clicks || 0,
        ctr: analytics.ctr || 0,
        headline: cr?.headline || '',
        imageUrl: cr?.imageUrl || null,
        businessName: cr?.businessName || '',
        placement: c.placement || '',
        status: c.status || '',
        targetedRegionKeys: keys,
        targetedCityLabels,
        startDateCalendar: c.startDateCalendar || calendarYmdFromValue(c.startDate),
        endDateCalendar: c.endDateCalendar || calendarYmdFromValue(c.endDate),
        targetingRadiusMiles: c.targetingRadiusMiles || 20,
        cityId: c.cityId ? String(c.cityId) : '',
        isDemoCampaign: inferDemoCampaign(cr),
      };
    });

    res.json({ message: 'success', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /campaigns/:id — detailed analytics with daily breakdown
router.get('/campaigns/:id', async (req, res) => {
  try {
    const db = getDb();
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid campaign id' });
    }
    const campaignId = new ObjectId(req.params.id);
    const campaign = await db.collection('adCampaigns').findOne({ _id: campaignId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Verify ownership — only return data for campaigns owned by authenticated advertiser
    const advertiser = await db.collection('advertisers').findOne({ userId: req.user.uid });
    if (!advertiser || campaign.advertiserId.toString() !== advertiser._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const analytics = await adTrackingService.getCampaignAnalytics(
      campaignId,
      campaign.startDate,
      campaign.endDate
    );

    const keys = campaign.targetedRegionKeys && campaign.targetedRegionKeys.length
      ? campaign.targetedRegionKeys.map((k) => String(k))
      : [campaign.cityId].filter(Boolean).map((k) => String(k));
    const labelMap = await regionKeyToLabelMap(db, keys);
    const targetedCityLabels = keys.map((k) => labelMap[k] || k);

    const creative = campaign.creativeId
      ? await db.collection('adCreatives').findOne({ _id: campaign.creativeId })
      : null;

    const submission = campaign.submissionId
      ? await db.collection('adSubmissions').findOne({ _id: campaign.submissionId })
      : null;

    let pendingCreative = null;
    if (
      submission?.creativeId
      && campaign.creativeId
      && String(submission.creativeId) !== String(campaign.creativeId)
    ) {
      pendingCreative = await db.collection('adCreatives').findOne({ _id: submission.creativeId });
    }

    const campaignOut = {
      ...campaign,
      _id: campaign._id.toString(),
      submissionId: campaign.submissionId ? campaign.submissionId.toString() : '',
      advertiserId: campaign.advertiserId ? campaign.advertiserId.toString() : '',
      creativeId: campaign.creativeId ? campaign.creativeId.toString() : '',
      targetedRegionKeys: keys,
      targetedCityLabels,
      startDateCalendar: campaign.startDateCalendar || calendarYmdFromValue(campaign.startDate),
      endDateCalendar: campaign.endDateCalendar || calendarYmdFromValue(campaign.endDate),
      isDemoCampaign: inferDemoCampaign(creative),
      creativePreview: creativeToPreview(creative),
      pendingCreativePreview: creativeToPreview(pendingCreative),
    };

    res.json({ message: 'success', data: { campaign: campaignOut, analytics } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
