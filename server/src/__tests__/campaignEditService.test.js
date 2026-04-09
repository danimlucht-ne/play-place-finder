jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/adValidationService', () => ({ checkFamilyFriendliness: jest.fn() }));

const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const adValidationService = require('../services/adValidationService');
const { updateCreative, updateEventFields } = require('../services/campaignEditService');

describe('campaignEditService', () => {
  const campaignId = '64f1a9f7c2a7d9b123456789';
  const creativeId = new ObjectId('64f1a9f7c2a7d9b123456780');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mockDb({ campaign, creative, updateOne = jest.fn().mockResolvedValue({}) }) {
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue(campaign),
          updateOne,
        };
      }
      if (name === 'adCreatives') {
        return {
          findOne: jest.fn().mockResolvedValue(creative),
          updateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });
    return { collection, updateOne };
  }

  test('rejects edits for missing or non-editable campaigns', async () => {
    mockDb({ campaign: null, creative: null });
    await expect(updateCreative(campaignId, { headline: 'Better headline' })).resolves.toEqual({
      success: false,
      error: 'Campaign not found',
    });

    mockDb({ campaign: { status: 'completed' }, creative: null });
    await expect(updateCreative(campaignId, { headline: 'Better headline' })).resolves.toEqual({
      success: false,
      error: 'Campaign cannot be edited in its current status',
    });
  });

  test.each([
    [{ headline: 'bad' }, 'headline must be 5-50 characters'],
    [{ headline: '<b>Bad headline</b>' }, 'headline must not contain HTML'],
    [{ body: 'too short' }, 'body must be 10-150 characters'],
    [{ ctaText: 'x' }, 'ctaText must be 2-25 characters'],
    [{ ctaUrl: 'http://example.com' }, 'ctaUrl must be a valid HTTPS URL'],
  ])('validates creative fields %#', async (fields, error) => {
    mockDb({ campaign: { status: 'active', creativeId }, creative: { _id: creativeId } });

    await expect(updateCreative(campaignId, fields)).resolves.toEqual({ success: false, error });
  });

  test('blocks updated creative copy when family-friendliness check fails', async () => {
    mockDb({
      campaign: { status: 'active', creativeId },
      creative: {
        _id: creativeId,
        headline: 'Old headline',
        body: 'Old body copy here',
        businessName: 'Play Cafe',
        businessCategory: 'Indoor play',
      },
    });
    adValidationService.checkFamilyFriendliness.mockResolvedValue({
      familyFriendly: false,
      reason: 'Unsafe claim',
    });

    await expect(updateCreative(campaignId, { headline: 'New family headline' })).resolves.toEqual({
      success: false,
      error: 'Unsafe claim',
    });
  });

  test('updates valid creative fields and allows AI check failures to fail open', async () => {
    const creativeUpdateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return { findOne: jest.fn().mockResolvedValue({ status: 'scheduled', creativeId }) };
      }
      if (name === 'adCreatives') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: creativeId,
            headline: 'Old headline',
            body: 'Old body copy here',
            businessName: 'Play Cafe',
            businessCategory: 'Indoor play',
          }),
          updateOne: creativeUpdateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });
    adValidationService.checkFamilyFriendliness.mockRejectedValue(new Error('AI unavailable'));

    await expect(updateCreative(campaignId, {
      headline: 'New family headline',
      ctaText: 'Book now',
      imageUrl: 'https://example.com/ad.jpg',
    })).resolves.toEqual({ success: true });

    expect(creativeUpdateOne).toHaveBeenCalledWith(
      { _id: creativeId },
      {
        $set: {
          updatedAt: new Date('2026-04-09T12:00:00Z'),
          headline: 'New family headline',
          ctaText: 'Book now',
          imageUrl: 'https://example.com/ad.jpg',
        },
      },
    );
  });

  test('validates event campaign edit constraints', async () => {
    mockDb({ campaign: { status: 'active', isEvent: false, creativeId }, creative: null });
    await expect(updateEventFields(campaignId, { eventTime: '6 PM' })).resolves.toEqual({
      success: false,
      error: 'Event field edits are only allowed on event campaigns',
    });

    mockDb({ campaign: { status: 'active', isEvent: true, creativeId, endDate: new Date('2026-04-20') }, creative: null });
    await expect(updateEventFields(campaignId, { eventDate: 'not-a-date' })).resolves.toEqual({
      success: false,
      error: 'eventDate must be a valid date',
    });
    await expect(updateEventFields(campaignId, { eventDate: '2026-04-30' })).resolves.toEqual({
      success: false,
      error: 'Event date must be before the campaign end date',
    });
  });

  test('updates event date on both campaign and creative records', async () => {
    const campaignUpdateOne = jest.fn().mockResolvedValue({});
    const creativeUpdateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            status: 'active',
            isEvent: true,
            creativeId,
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
          updateOne: campaignUpdateOne,
        };
      }
      if (name === 'adCreatives') return { updateOne: creativeUpdateOne };
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });

    await expect(updateEventFields(campaignId, {
      eventDate: '2026-04-20T00:00:00Z',
      eventTime: '6 PM',
      eventLocation: 'Main room',
    })).resolves.toEqual({ success: true });

    expect(creativeUpdateOne).toHaveBeenCalledWith(
      { _id: creativeId },
      { $set: expect.objectContaining({ eventTime: '6 PM', eventLocation: 'Main room' }) },
    );
    expect(campaignUpdateOne).toHaveBeenCalledWith(
      { _id: new ObjectId(campaignId) },
      { $set: expect.objectContaining({ eventDate: new Date('2026-04-20T00:00:00Z') }) },
    );
  });
});
