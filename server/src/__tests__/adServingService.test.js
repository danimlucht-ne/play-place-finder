jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/cityPhaseService', () => ({ getCityPhase: jest.fn() }));

const { getDb } = require('../database');
const cityPhaseService = require('../services/cityPhaseService');
const { getAd, getAllAds, getInlineAds } = require('../services/adServingService');

function id(value) {
  return { value, toString: () => value };
}

describe('adServingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns house ad immediately for seeding cities', async () => {
    cityPhaseService.getCityPhase.mockResolvedValue({
      phase: 'seeding',
      slotsRemaining: { featured: 0, sponsored: 0 },
    });
    getDb.mockReturnValue({ collection: jest.fn() });

    await expect(getAd('omaha-ne', 'featured_home')).resolves.toMatchObject({
      type: 'house',
      cityPhase: 'seeding',
      slotsRemaining: 0,
      ad: {
        id: 'house_omaha-ne',
        headline: expect.stringContaining('Sunny Day Play'),
        ctaText: 'Advertise Your Business',
        placement: 'featured_home',
        imageUrl: expect.stringContaining('images.unsplash.com'),
      },
    });
  });

  test('returns a formatted paid ad when an active targeted campaign exists', async () => {
    const campaignId = id('campaign-1');
    const creativeId = id('creative-1');
    const advertiserId = id('advertiser-1');
    cityPhaseService.getCityPhase.mockResolvedValue({
      phase: 'growth',
      slotsRemaining: { featured: 1, sponsored: 2 },
    });
    const collection = jest.fn((name) => {
      if (name === 'adTargeting') {
        return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ campaignId }]) })) };
      }
      if (name === 'adCampaigns') {
        return {
          aggregate: jest.fn(() => ({
            toArray: jest.fn().mockResolvedValue([{
              _id: campaignId,
              creativeId,
              advertiserId,
              pricingLock: { isFoundingAdvertiser: true },
              isEvent: true,
              eventDate: new Date('2026-04-20T00:00:00Z'),
            }]),
          })),
        };
      }
      if (name === 'adCreatives') {
        return { findOne: jest.fn().mockResolvedValue({
          _id: creativeId,
          headline: 'Family Fun Night',
          body: 'Come play indoors',
          imageUrl: 'https://img.example/ad.jpg',
          ctaText: 'Book now',
          ctaUrl: 'https://example.com',
          businessName: 'Play Cafe',
          businessCategory: 'Indoor play',
          eventName: 'Launch Party',
          eventTime: '6 PM',
          eventLocation: 'Main room',
          showDistance: true,
        }) };
      }
      if (name === 'advertisers') {
        return { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, businessLat: 41.1, businessLng: -96.1 }) };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    const result = await getAd('omaha-ne', 'featured_home');

    expect(result).toMatchObject({
      type: 'paid',
      cityPhase: 'growth',
      slotsRemaining: 1,
      ad: {
        id: 'campaign-1',
        campaignId: 'campaign-1',
        headline: 'Family Fun Night',
        isFoundingAdvertiser: false,
        isEvent: true,
        businessLat: 41.1,
        businessLng: -96.1,
        showDistance: true,
      },
    });
  });

  test('falls back to city-configured house ad when no paid campaign is active', async () => {
    cityPhaseService.getCityPhase.mockResolvedValue({
      phase: 'growth',
      slotsRemaining: { featured: 0, sponsored: 4 },
    });
    const collection = jest.fn((name) => {
      if (name === 'adTargeting') return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })) };
      if (name === 'cityAdSettings') return { findOne: jest.fn().mockResolvedValue({ houseAd: { headline: 'Local promo', body: 'Sponsor this city' } }) };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await expect(getAd('omaha-ne', 'inline_listing')).resolves.toMatchObject({
      type: 'house',
      cityPhase: 'growth',
      ad: {
        id: 'house_omaha-ne',
        headline: 'Local promo',
        body: 'Sponsor this city',
        ctaText: 'Advertise Your Business Here',
        placement: 'inline_listing',
      },
    });
  });

  test('returns all active paid ads for rotation', async () => {
    const campaignId = id('campaign-1');
    const creativeId = id('creative-1');
    const advertiserId = id('advertiser-1');
    cityPhaseService.getCityPhase.mockResolvedValue({
      phase: 'mature',
      slotsRemaining: { featured: 0, sponsored: 7 },
    });
    const collection = jest.fn((name) => {
      if (name === 'adTargeting') return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ campaignId }]) })) };
      if (name === 'adCampaigns') return { aggregate: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ _id: campaignId, creativeId, advertiserId }]) })) };
      if (name === 'adCreatives') return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ _id: creativeId, headline: 'Ad 1', body: 'Body' }]) })) };
      if (name === 'advertisers') return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ _id: advertiserId }]) })) };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await expect(getAllAds('omaha-ne', 'inline_listing')).resolves.toMatchObject({
      type: 'paid',
      ads: [{ headline: 'Ad 1', placement: 'inline_listing' }],
    });
  });

  test('getAllAds falls back to house when paid campaigns dedupe to zero', async () => {
    const emptyId = { toString: () => '', valueOf: () => '' };
    const creativeId = id('creative-1');
    const advertiserId = id('advertiser-1');
    cityPhaseService.getCityPhase.mockResolvedValue({
      phase: 'growth',
      slotsRemaining: { featured: 1, sponsored: 3 },
    });
    const collection = jest.fn((name) => {
      if (name === 'adTargeting') return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ campaignId: emptyId }]) })) };
      if (name === 'adCampaigns') {
        return {
          aggregate: jest.fn(() => ({
            toArray: jest.fn().mockResolvedValue([{
              _id: emptyId,
              creativeId,
              advertiserId,
              isEvent: false,
            }]),
          })),
        };
      }
      if (name === 'adCreatives') {
        return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ _id: creativeId, headline: 'X', body: 'Y' }]) })) };
      }
      if (name === 'advertisers') {
        return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([{ _id: advertiserId }]) })) };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await expect(getAllAds('omaha-ne', 'featured_home')).resolves.toMatchObject({
      type: 'house',
      ads: [{ id: 'house_omaha-ne' }],
    });
  });

  test('returns no inline ads when result count is too low or no campaigns match', async () => {
    await expect(getInlineAds('omaha-ne', 4)).resolves.toEqual([]);

    const collection = jest.fn((name) => {
      if (name === 'adTargeting') return { find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })) };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await expect(getInlineAds('omaha-ne', 10)).resolves.toEqual([]);
  });
});
