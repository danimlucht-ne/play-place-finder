const { getDb } = require('../database');
const { regionKeyCandidates } = require('../utils/regionKeyForAds');
const cityPhaseService = require('./cityPhaseService');

/** Collapse whitespace for stable comparison (matches app calendar dedupe). */
function collapseWs(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * One logical event per fingerprint for calendar / inline listings — multiple active campaigns can
 * target the same city with the same creative payload (different Mongo campaign _id).
 */
function eventInlineDedupeKey(ad) {
  const ymd = String(ad.eventDate || '').trim().slice(0, 10);
  const fp = [
    collapseWs(ad.businessName),
    ymd,
    collapseWs(ad.eventName),
    collapseWs(ad.headline),
    collapseWs(ad.body).slice(0, 200),
  ].join('\u0001');
  const emptyMarker = '\u0001\u0001\u0001\u0001';
  if (fp && fp !== emptyMarker) return `e:${fp}`;
  return `c:${String(ad.campaignId || ad.id || '')}`;
}

/** One id per campaign — duplicate adTargeting rows must not duplicate $in / rotation lists. */
function uniqueCampaignIdsFromTargeting(targetingDocs) {
  const seen = new Set();
  const out = [];
  for (const t of targetingDocs) {
    const cid = t.campaignId;
    if (!cid) continue;
    const key = cid.toString ? cid.toString() : String(cid);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cid);
  }
  return out;
}

/**
 * Gets a random ad for a given city and placement.
 * Uses $sample for fair rotation when multiple campaigns are active.
 * Falls back to house ad if no paid campaigns exist.
 */
async function getAd(cityId, placement) {
  const db = getDb();
  const now = new Date();

  const phaseInfo = await cityPhaseService.getCityPhase(cityId);

  // Do not short-circuit on `seeding`: new cities default to seeding until `cityAdSettings` exists, but paid
  // campaigns in `adTargeting` must still serve. House/demo is only the fallback when no active campaign matches.

  // Find campaigns targeting this city via adTargeting records
  const cityCandidates = regionKeyCandidates(cityId);
  const targetingDocs = await db.collection('adTargeting').find({ cityId: { $in: cityCandidates }, placement }).toArray();
  const campaignIds = uniqueCampaignIdsFromTargeting(targetingDocs);

  const [campaign] = campaignIds.length > 0
    ? await db.collection('adCampaigns').aggregate([
        { $match: { _id: { $in: campaignIds }, status: 'active', startDate: { $lte: now }, endDate: { $gte: now } } },
        { $sample: { size: 1 } },
      ]).toArray()
    : [];

  if (campaign) {
    const creative = await db.collection('adCreatives').findOne({ _id: campaign.creativeId });
    const advertiser = await db.collection('advertisers').findOne({ _id: campaign.advertiserId });
    return {
      ad: formatPaidAd(campaign, creative, placement, advertiser),
      type: 'paid',
      cityPhase: phaseInfo.phase,
    };
  }

  const ctaText = 'Advertise Your Business Here';
  const citySettings = await db.collection('cityAdSettings').findOne({ cityId });
  if (citySettings && citySettings.houseAd) {
    return { ad: { id: `house_${cityId}`, campaignId: null, ...citySettings.houseAd, ctaText, placement }, type: 'house', cityPhase: phaseInfo.phase };
  }
  return { ad: houseAd(cityId, placement, ctaText), type: 'house', cityPhase: phaseInfo.phase };
}

/**
 * Gets ALL active ads for a city + placement, shuffled randomly.
 * Used by the home screen for timed rotation through multiple ads.
 * Falls back to a single house ad if no paid campaigns exist.
 */
async function getAllAds(cityId, placement) {
  const db = getDb();
  const now = new Date();

  const phaseInfo = await cityPhaseService.getCityPhase(cityId);

  // Same as [getAd]: serve real paid creatives whenever targeting matches, even if the city is still in
  // commercial `seeding` (no cityAdSettings row yet). Stock house ads are the fallback only when no campaigns match.

  // Fetch all active campaigns targeting this city, shuffled
  const cityCandidates = regionKeyCandidates(cityId);
  const targetingDocs = await db.collection('adTargeting').find({ cityId: { $in: cityCandidates }, placement }).toArray();
  const campaignIds = uniqueCampaignIdsFromTargeting(targetingDocs);

  // NOTE: $sample does a full collection scan on small collections (<100 docs).
  // This is fine for typical city ad volumes (2-10 campaigns). If a city ever has
  // 50+ active campaigns, consider switching to weighted random selection.
  const campaigns = campaignIds.length > 0
    ? await db.collection('adCampaigns').aggregate([
        { $match: { _id: { $in: campaignIds }, status: 'active', startDate: { $lte: now }, endDate: { $gte: now } } },
        { $sample: { size: 20 } },
      ]).toArray()
    : [];

  if (campaigns.length > 0) {
    const creativeIds = campaigns.map(c => c.creativeId);
    const creatives = await db.collection('adCreatives').find({ _id: { $in: creativeIds } }).toArray();
    const creativeMap = new Map(creatives.map(c => [c._id.toString(), c]));

    const advertiserIds = [...new Set(campaigns.map(c => c.advertiserId))];
    const advertisers = await db.collection('advertisers').find({ _id: { $in: advertiserIds } }).toArray();
    const advertiserMap = new Map(advertisers.map(a => [a._id.toString(), a]));

    const rawAds = campaigns.map(campaign => formatPaidAd(campaign, creativeMap.get(campaign.creativeId.toString()), placement, advertiserMap.get(campaign.advertiserId.toString())));
    const adSeen = new Set();
    const ads = [];
    for (const ad of rawAds) {
      const k = ad.isEvent
        ? eventInlineDedupeKey(ad)
        : `c:${String(ad.campaignId || ad.id || '')}`;
      if (!k || k === 'c:' || adSeen.has(k)) continue;
      adSeen.add(k);
      ads.push(ad);
    }
    if (ads.length > 0) {
      return { ads, type: 'paid', cityPhase: phaseInfo.phase };
    }
    // Matched campaigns but nothing survived dedupe / payload shaping — fall back so clients never get paid+[].
  }

  const ctaText = 'Advertise Your Business Here';
  return { ads: [houseAd(cityId, placement, ctaText)], type: 'house', cityPhase: phaseInfo.phase };
}

/**
 * Gets inline sponsored listings for search results, randomly shuffled.
 */
async function getInlineAds(cityId, resultCount) {
  const db = getDb();
  const now = new Date();

  const slotCount = Math.floor(resultCount / 5);
  if (slotCount === 0) return [];

  // Use $sample for random ordering instead of FIFO, via adTargeting for multi-region
  const cityCandidates = regionKeyCandidates(cityId);
  const targetingDocs = await db.collection('adTargeting').find({ cityId: { $in: cityCandidates }, placement: 'inline_listing' }).toArray();
  const campaignIds = uniqueCampaignIdsFromTargeting(targetingDocs);

  const campaigns = campaignIds.length > 0
    ? await db.collection('adCampaigns').aggregate([
        { $match: { _id: { $in: campaignIds }, status: 'active', startDate: { $lte: now }, endDate: { $gte: now } } },
        { $sample: { size: slotCount } },
      ]).toArray()
    : [];

  if (campaigns.length === 0) return [];

  const creativeIds = campaigns.map(c => c.creativeId);
  const creatives = await db.collection('adCreatives').find({ _id: { $in: creativeIds } }).toArray();
  const creativeMap = new Map(creatives.map(c => [c._id.toString(), c]));

  const advertiserIds = [...new Set(campaigns.map(c => c.advertiserId))];
  const advertisers = await db.collection('advertisers').find({ _id: { $in: advertiserIds } }).toArray();
  const advertiserMap = new Map(advertisers.map(a => [a._id.toString(), a]));

  return campaigns.map(campaign => formatPaidAd(campaign, creativeMap.get(campaign.creativeId.toString()), 'inline_listing', advertiserMap.get(campaign.advertiserId.toString())));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPaidAd(campaign, creative, placement, advertiser) {
  const campaignIdStr = campaign && campaign._id != null ? String(campaign._id) : '';
  return {
    id: campaignIdStr,
    campaignId: campaignIdStr,
    headline: creative ? creative.headline : '',
    body: creative ? creative.body : '',
    imageUrl: creative ? creative.imageUrl : null,
    imageAlignment: creative && creative.imageAlignment ? String(creative.imageAlignment) : 'center',
    ctaText: creative ? creative.ctaText : '',
    ctaUrl: creative ? creative.ctaUrl : '',
    businessName: creative ? creative.businessName : '',
    businessCategory: creative ? creative.businessCategory : '',
    placement,
    isFoundingAdvertiser: false,
    isEvent: campaign.isEvent || false,
    eventName: creative ? creative.eventName || null : null,
    eventDate: campaign.eventDate || (creative ? creative.eventDate || null : null),
    eventTime: creative ? creative.eventTime || null : null,
    isRecurring: campaign.isRecurring || false,
    eventLocation: creative ? creative.eventLocation || null : null,
    businessLat: advertiser && Number.isFinite(Number(advertiser.businessLat)) ? Number(advertiser.businessLat) : 0,
    businessLng: advertiser && Number.isFinite(Number(advertiser.businessLng)) ? Number(advertiser.businessLng) : 0,
    showDistance: creative ? creative.showDistance || false : false,
  };
}

/** Stock creative for house/demo ads (Unsplash — family indoor play). */
const HOUSE_AD_STOCK_IMAGE_URL =
  'https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=960&q=80';

function houseAd(cityId, placement, ctaText) {
  return {
    id: `house_${cityId}`,
    campaignId: null,
    headline: 'Sunny Day Play Café',
    // Headline is the sample business name; omit businessName so clients don’t show a duplicate placeholder line.
    businessName: '',
    body: 'Indoor play area, coffee bar & snacks for the whole family. Book a birthday party today!',
    imageUrl: HOUSE_AD_STOCK_IMAGE_URL,
    imageAlignment: 'center',
    ctaText,
    ctaUrl: '/advertise',
    placement,
  };
}

module.exports = { getAd, getAllAds, getInlineAds };
