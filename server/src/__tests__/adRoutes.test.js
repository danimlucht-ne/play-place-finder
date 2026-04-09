jest.mock('../services/adTrackingService', () => ({ recordEvent: jest.fn() }));
jest.mock('../services/adServingService', () => ({ getAd: jest.fn(), getAllAds: jest.fn() }));
jest.mock('../services/cityPhaseService', () => ({ getCityPhase: jest.fn() }));
jest.mock('../services/pricingService', () => ({ getPhasePrice: jest.fn() }));
jest.mock('../database', () => ({ getDb: jest.fn() }));

const express = require('express');
const request = require('supertest');
const adTrackingService = require('../services/adTrackingService');
const adServingService = require('../services/adServingService');
const cityPhaseService = require('../services/cityPhaseService');
const pricingService = require('../services/pricingService');
const { getDb } = require('../database');
const adTrackingRoutes = require('../routes/adTrackingRoutes');
const adServingRoutes = require('../routes/adServingRoutes');

function buildApp(router, mount = '/') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: 'authed-user' };
    next();
  });
  app.use(mount, router);
  return app;
}

const SAMPLE_CAMPAIGN_ID = '507f1f77bcf86cd799439011';

describe('adTrackingRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects incomplete tracking events', async () => {
    const res = await request(buildApp(adTrackingRoutes)).post('/').send({ type: 'impression' }).expect(400);

    expect(res.body.error).toBe('type, adId, campaignId, cityId, and placement are required');
    expect(adTrackingService.recordEvent).not.toHaveBeenCalled();
  });

  test('rejects invalid campaignId', async () => {
    const res = await request(buildApp(adTrackingRoutes)).post('/').send({
      type: 'click',
      adId: 'ad-1',
      campaignId: 'not-a-valid-object-id',
      cityId: 'omaha-ne',
      placement: 'featured_home',
    }).expect(400);

    expect(res.body.error).toBe('campaignId must be a valid ObjectId');
    expect(adTrackingService.recordEvent).not.toHaveBeenCalled();
  });

  test('rejects unsupported tracking event types', async () => {
    const res = await request(buildApp(adTrackingRoutes)).post('/').send({
      type: 'purchase',
      adId: 'ad-1',
      campaignId: SAMPLE_CAMPAIGN_ID,
      cityId: 'omaha-ne',
      placement: 'featured_home',
    }).expect(400);

    expect(res.body.error).toBe('type must be impression or click');
  });

  test('records valid event using authenticated user fallback', async () => {
    adTrackingService.recordEvent.mockResolvedValue();

    await request(buildApp(adTrackingRoutes)).post('/').send({
      type: 'click',
      adId: 'ad-1',
      campaignId: SAMPLE_CAMPAIGN_ID,
      cityId: 'omaha-ne',
      placement: 'featured_home',
      userId: 'spoofed-user',
    }).expect(200);

    expect(adTrackingService.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'click',
      adId: 'ad-1',
      campaignId: SAMPLE_CAMPAIGN_ID,
      cityId: 'omaha-ne',
      placement: 'featured_home',
      userId: 'authed-user',
      visitorKey: expect.any(String),
    }));
    expect(adTrackingService.recordEvent.mock.calls[0][0].userId).not.toBe('spoofed-user');
  });
});

describe('adServingRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('serves one ad for city and placement', async () => {
    adServingService.getAd.mockResolvedValue({ adId: 'ad-1' });

    const res = await request(buildApp(adServingRoutes)).get('/?city_id=omaha-ne&placement=featured_home').expect(200);

    expect(res.body).toEqual({ message: 'success', data: { adId: 'ad-1' } });
    expect(adServingService.getAd).toHaveBeenCalledWith('omaha-ne', 'featured_home');
  });

  test('serves all ads for rotation', async () => {
    adServingService.getAllAds.mockResolvedValue([{ adId: 'ad-1' }, { adId: 'ad-2' }]);

    const res = await request(buildApp(adServingRoutes)).get('/all?city_id=omaha-ne&placement=inline_listing').expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(adServingService.getAllAds).toHaveBeenCalledWith('omaha-ne', 'inline_listing');
  });

  test('returns city phase and pricing data', async () => {
    cityPhaseService.getCityPhase.mockResolvedValue({ phase: 'growing', advertisingOpen: true });
    pricingService.getPhasePrice.mockResolvedValue({ priceInCents: 9900 });

    await expect(request(buildApp(adServingRoutes)).get('/city-phase?cityId=omaha-ne').expect(200))
      .resolves.toMatchObject({ body: { data: { phase: 'growing' } } });
    await expect(request(buildApp(adServingRoutes)).get('/pricing?cityId=omaha-ne&placement=featured_home').expect(200))
      .resolves.toMatchObject({ body: { data: { priceInCents: 9900 } } });
  });

  test('counts daily impression views', async () => {
    const countDocuments = jest.fn().mockResolvedValue(14);
    getDb.mockReturnValue({ collection: jest.fn(() => ({ countDocuments })) });

    const res = await request(buildApp(adServingRoutes)).get('/daily-views?cityId=omaha-ne').expect(200);

    expect(res.body.data).toEqual({ cityId: 'omaha-ne', todayViews: 14 });
    expect(countDocuments).toHaveBeenCalledWith({
      cityId: 'omaha-ne',
      type: 'impression',
      timestamp: { $gte: expect.any(Date) },
    });
  });
});
