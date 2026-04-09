jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/authService', () => ({
  ensureCanSubmit: jest.fn((req, _res, next) => {
    req.user = { uid: 'user-1' };
    next();
  }),
}));
jest.mock('../services/contributionService', () => ({ recordContribution: jest.fn() }));
jest.mock('../utils/helpers', () => ({ getConsentSnapshot: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { getDb } = require('../database');
const contributionService = require('../services/contributionService');
const { getConsentSnapshot } = require('../utils/helpers');
const reportRoutes = require('../routes/reportRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', reportRoutes);
  return app;
}

function makeCursor(rows) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(rows),
  };
}

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection ${name}`);
      return collections[name];
    }),
  };
}

describe('reportRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
    getConsentSnapshot.mockResolvedValue({ adultTermsAccepted: true, adultTermsConsentVersion: 'v1' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rejects invalid crowd levels before inserting', async () => {
    getDb.mockReturnValue(makeDb({
      crowd_reports: { insertOne: jest.fn() },
    }));

    const res = await request(buildApp()).post('/crowd').send({
      placeId: 'place-1',
      crowdLevel: 'Wild',
    }).expect(400);

    expect(res.body).toEqual({ error: 'Invalid crowdLevel.' });
    expect(contributionService.recordContribution).not.toHaveBeenCalled();
  });

  test('creates crowd reports with consent snapshot and contribution credit', async () => {
    const insertOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      crowd_reports: { insertOne },
    }));

    const res = await request(buildApp()).post('/crowd').send({
      placeId: 'place-1',
      crowdLevel: 'Busy',
    }).expect(201);

    expect(insertOne).toHaveBeenCalledWith({
      placeId: 'place-1',
      crowdLevel: 'Busy',
      userId: 'user-1',
      createdAt: new Date('2026-04-09T12:00:00Z'),
      adultTermsAccepted: true,
      adultTermsConsentVersion: 'v1',
    });
    expect(contributionService.recordContribution).toHaveBeenCalledWith('user-1', 'CROWD_REPORT', 'place-1');
    expect(res.body).toEqual({ message: 'success' });
  });

  test('normalizes unknown issue types and decrements trusted affected fields', async () => {
    const insertOne = jest.fn();
    const playgroundFindOne = jest.fn().mockResolvedValue({ trustScores: { hasBathrooms: 0.05 } });
    const playgroundUpdate = jest.fn();
    getDb.mockReturnValue(makeDb({
      issue_reports: { insertOne },
      playgrounds: {
        findOne: playgroundFindOne,
        updateOne: playgroundUpdate,
      },
    }));

    const res = await request(buildApp()).post('/issue').send({
      placeId: 'place-1',
      issueType: 'strange_problem',
      description: 'Bathroom closed',
      affectedField: 'hasBathrooms',
    }).expect(201);

    expect(insertOne).toHaveBeenCalledWith({
      placeId: 'place-1',
      reportType: 'other',
      legacyIssueType: 'strange_problem',
      description: 'Bathroom closed',
      affectedField: 'hasBathrooms',
      userId: 'user-1',
      status: 'open',
      createdAt: new Date('2026-04-09T12:00:00Z'),
      adultTermsAccepted: true,
      adultTermsConsentVersion: 'v1',
    });
    expect(playgroundFindOne).toHaveBeenCalledWith(
      { _id: 'place-1' },
      { projection: { trustScores: 1 } },
    );
    expect(playgroundUpdate).toHaveBeenCalledWith(
      { _id: 'place-1' },
      { $inc: { 'trustScores.hasBathrooms': -0.05 } },
    );
    expect(contributionService.recordContribution).toHaveBeenCalledWith('user-1', 'ISSUE_REPORT', 'place-1');
    expect(res.body).toEqual({ message: 'success' });
  });

  test('does not touch playground trust scores for non-verifiable affected fields', async () => {
    const playgroundFindOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      issue_reports: { insertOne: jest.fn() },
      playgrounds: { findOne: playgroundFindOne, updateOne: jest.fn() },
    }));

    await request(buildApp()).post('/issue').send({
      placeId: 'place-1',
      issueType: 'broken_equipment',
      description: 'Broken swing',
      affectedField: 'unknownField',
    }).expect(201);

    expect(playgroundFindOne).not.toHaveBeenCalled();
  });

  test('returns latest crowd report plus active open issues for a place', async () => {
    const latestCrowd = { placeId: 'place-1', crowdLevel: 'Quiet' };
    const issues = [{ placeId: 'place-1', status: 'open', reportType: 'traffic_risk' }];
    const crowdFind = jest.fn().mockReturnValue(makeCursor([latestCrowd]));
    const issueFind = jest.fn().mockReturnValue(makeCursor(issues));
    getDb.mockReturnValue(makeDb({
      crowd_reports: { find: crowdFind },
      issue_reports: { find: issueFind },
    }));

    const res = await request(buildApp()).get('/place-1').expect(200);

    expect(crowdFind).toHaveBeenCalledWith({ placeId: 'place-1' });
    expect(issueFind).toHaveBeenCalledWith({ placeId: 'place-1', status: 'open' });
    expect(res.body).toEqual({
      message: 'success',
      data: { latestCrowd, activeIssues: issues },
    });
  });
});
