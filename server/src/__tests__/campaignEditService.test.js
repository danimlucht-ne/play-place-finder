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

  function mockDb({
    campaign,
    creative,
    submission = { _id: new ObjectId('64f1a9f7c2a7d9b123456781'), creativeId },
    campaignUpdateOne = jest.fn().mockResolvedValue({}),
    creativeUpdateOne = jest.fn().mockResolvedValue({}),
    creativeInsertOne = jest.fn().mockResolvedValue({}),
    submissionUpdateOne = jest.fn().mockResolvedValue({}),
  }) {
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue(campaign),
          updateOne: campaignUpdateOne,
        };
      }
      if (name === 'adCreatives') {
        return {
          findOne: jest.fn().mockResolvedValue(creative),
          updateOne: creativeUpdateOne,
          insertOne: creativeInsertOne,
        };
      }
      if (name === 'adSubmissions') {
        return {
          findOne: jest.fn().mockResolvedValue(submission),
          updateOne: submissionUpdateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });
    return { collection, campaignUpdateOne, creativeUpdateOne, creativeInsertOne, submissionUpdateOne };
  }

  test('rejects edits for missing or non-editable campaigns', async () => {
    mockDb({ campaign: null, creative: null, submission: null });
    await expect(updateCreative(campaignId, { headline: 'Better headline' })).resolves.toEqual({
      success: false,
      error: 'Campaign not found',
    });

    mockDb({ campaign: { status: 'completed' }, creative: null, submission: null });
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
    mockDb({ campaign: { status: 'active', submissionId: new ObjectId(), creativeId }, creative: { _id: creativeId } });

    await expect(updateCreative(campaignId, fields)).resolves.toEqual({ success: false, error });
  });

  test('blocks updated creative copy when family-friendliness check fails', async () => {
    mockDb({
      campaign: { status: 'active', submissionId: new ObjectId(), creativeId },
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

  test('stages active campaign creative edits for review and updates the staged creative only', async () => {
    const stagedCreativeId = new ObjectId('64f1a9f7c2a7d9b123456782');
    const creativeUpdateOne = jest.fn().mockResolvedValue({});
    const creativeInsertOne = jest.fn().mockResolvedValue({});
    const submissionUpdateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return { findOne: jest.fn().mockResolvedValue({ status: 'active', submissionId: new ObjectId(), creativeId }) };
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
          insertOne: creativeInsertOne,
        };
      }
      if (name === 'adSubmissions') {
        return {
          findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), creativeId }),
          updateOne: submissionUpdateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });
    adValidationService.checkFamilyFriendliness.mockRejectedValue(new Error('AI unavailable'));
    creativeInsertOne.mockImplementation(async (doc) => {
      doc._id = stagedCreativeId;
      return {};
    });

    await expect(updateCreative(campaignId, {
      headline: 'New family headline',
      ctaText: 'Book now',
      imageUrl: 'https://example.com/ad.jpg',
    })).resolves.toEqual({ success: true, reviewRequired: true });

    expect(creativeInsertOne).toHaveBeenCalledWith(expect.objectContaining({
      stagedFromCreativeId: creativeId,
    }));
    expect(submissionUpdateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ $set: expect.objectContaining({ creativeId: stagedCreativeId }) }),
    );

    expect(creativeUpdateOne).toHaveBeenCalledWith(
      { _id: stagedCreativeId },
      {
        $set: {
          updatedAt: expect.any(Date),
          headline: 'New family headline',
          ctaText: 'Book now',
          imageUrl: 'https://example.com/ad.jpg',
          additionalImageUrls: [],
        },
      },
    );
  });

  test('replacing imageUrl removes the old primary from additionalImageUrls on the staged creative', async () => {
    const liveCreativeId = new ObjectId('64f1a9f7c2a7d9b123456790');
    const stagedCreativeId = new ObjectId('64f1a9f7c2a7d9b123456791');
    const submissionId = new ObjectId('64f1a9f7c2a7d9b123456792');
    const creativeUpdateOne = jest.fn().mockResolvedValue({});
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            status: 'active',
            submissionId,
            creativeId: liveCreativeId,
          }),
        };
      }
      if (name === 'adCreatives') {
        return {
          findOne: jest.fn().mockImplementation((q) => {
            const id = q._id;
            if (id.equals(liveCreativeId)) {
              return {
                _id: liveCreativeId,
                headline: 'Headline',
                body: 'Body text long enough.',
                businessName: 'Play Cafe',
                businessCategory: 'Indoor play',
                imageUrl: 'https://cdn.example/old-hero.jpg',
                additionalImageUrls: ['https://cdn.example/old-hero.jpg', 'https://cdn.example/extra.jpg'],
              };
            }
            if (id.equals(stagedCreativeId)) {
              return {
                _id: stagedCreativeId,
                headline: 'Headline',
                body: 'Body text long enough.',
                businessName: 'Play Cafe',
                businessCategory: 'Indoor play',
                imageUrl: 'https://cdn.example/old-hero.jpg',
                additionalImageUrls: ['https://cdn.example/old-hero.jpg', 'https://cdn.example/extra.jpg'],
              };
            }
            return null;
          }),
          updateOne: creativeUpdateOne,
          insertOne: jest.fn(),
        };
      }
      if (name === 'adSubmissions') {
        return {
          findOne: jest.fn().mockResolvedValue({ _id: submissionId, creativeId: stagedCreativeId }),
          updateOne: jest.fn(),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });
    adValidationService.checkFamilyFriendliness.mockResolvedValue({ familyFriendly: true });

    await expect(updateCreative(campaignId, {
      imageUrl: 'https://cdn.example/new-hero.jpg',
    })).resolves.toEqual({ success: true, reviewRequired: true });

    expect(creativeUpdateOne).toHaveBeenCalledWith(
      { _id: stagedCreativeId },
      {
        $set: {
          updatedAt: expect.any(Date),
          imageUrl: 'https://cdn.example/new-hero.jpg',
          additionalImageUrls: ['https://cdn.example/extra.jpg'],
        },
      },
    );
  });

  test('validates event campaign edit constraints', async () => {
    mockDb({ campaign: { status: 'active', isEvent: false, submissionId: new ObjectId(), creativeId }, creative: { _id: creativeId } });
    await expect(updateEventFields(campaignId, { eventTime: '6 PM' })).resolves.toEqual({
      success: false,
      error: 'Event field edits are only allowed on event campaigns',
    });

    mockDb({ campaign: { status: 'active', isEvent: true, submissionId: new ObjectId(), creativeId, endDate: new Date('2026-04-20') }, creative: { _id: creativeId } });
    await expect(updateEventFields(campaignId, { eventDate: 'not-a-date' })).resolves.toEqual({
      success: false,
      error: 'eventDate must be a valid date',
    });
    await expect(updateEventFields(campaignId, { eventDate: '2026-04-30' })).resolves.toEqual({
      success: false,
      error: 'Event date must be before the campaign end date',
    });
  });

  test('stages live event edits and keeps campaign event date pending until approval', async () => {
    const campaignUpdateOne = jest.fn().mockResolvedValue({});
    const creativeUpdateOne = jest.fn().mockResolvedValue({});
    const creativeInsertOne = jest.fn().mockResolvedValue({});
    const submissionUpdateOne = jest.fn().mockResolvedValue({});
    const stagedCreativeId = new ObjectId('64f1a9f7c2a7d9b123456783');
    const collection = jest.fn((name) => {
      if (name === 'adCampaigns') {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: new ObjectId(campaignId),
            status: 'active',
            isEvent: true,
            submissionId: new ObjectId(),
            creativeId,
            endDate: new Date('2026-04-30T00:00:00Z'),
          }),
          updateOne: campaignUpdateOne,
        };
      }
      if (name === 'adCreatives') {
        return {
          findOne: jest.fn().mockResolvedValue({ _id: creativeId, eventDate: null }),
          updateOne: creativeUpdateOne,
          insertOne: creativeInsertOne,
        };
      }
      if (name === 'adSubmissions') {
        return {
          findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), creativeId }),
          updateOne: submissionUpdateOne,
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    getDb.mockReturnValue({ collection });
    creativeInsertOne.mockImplementation(async (doc) => {
      doc._id = stagedCreativeId;
      return {};
    });

    await expect(updateEventFields(campaignId, {
      eventDate: '2026-04-20T00:00:00Z',
      eventTime: '6 PM',
      eventLocation: 'Main room',
    })).resolves.toEqual({ success: true, reviewRequired: true });

    expect(creativeUpdateOne).toHaveBeenCalledWith(
      { _id: stagedCreativeId },
      { $set: expect.objectContaining({ eventTime: '6 PM', eventLocation: 'Main room' }) },
    );
    expect(campaignUpdateOne).not.toHaveBeenCalled();
    expect(submissionUpdateOne).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: expect.objectContaining({
          pendingCampaignChanges: expect.objectContaining({ eventDate: new Date('2026-04-20T00:00:00Z') }),
        }),
      },
    );
  });
});
