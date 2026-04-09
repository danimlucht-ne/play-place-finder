jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/authService', () => ({
  verifyAdminToken: jest.fn((req, _res, next) => {
    req.user = { uid: 'admin-1' };
    next();
  }),
}));
jest.mock('../utils/devDiscountEnvironment', () => ({
  isDevDiscountEnvironment: jest.fn(() => true),
}));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const { isDevDiscountEnvironment } = require('../utils/devDiscountEnvironment');
const { adminRouter, validateRouter } = require('../routes/adDiscountRoutes');

function buildApp(router) {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

function makeCursor(rows) {
  return {
    sort: jest.fn().mockReturnThis(),
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

describe('adDiscountRoutes admin router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isDevDiscountEnvironment.mockReturnValue(true);
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('validates required create fields before inserting', async () => {
    const res = await request(buildApp(adminRouter)).post('/').send({ percentOff: 10 }).expect(400);

    expect(res.body).toEqual({ error: 'code is required' });
  });

  test('creates a normalized discount code when input is valid', async () => {
    const insertedId = new ObjectId();
    const findOne = jest.fn().mockResolvedValue(null);
    const insertOne = jest.fn().mockResolvedValue({ insertedId });
    getDb.mockReturnValue(makeDb({ discountCodes: { findOne, insertOne } }));

    const res = await request(buildApp(adminRouter)).post('/').send({
      code: ' SPRING ',
      percentOff: 12.9,
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-05-01T00:00:00Z',
      maxUses: 5.8,
    }).expect(201);

    expect(findOne).toHaveBeenCalledWith(
      { code: 'SPRING' },
      { collation: { locale: 'en', strength: 2 } },
    );
    // Route mutates the same doc with _id after insert; assert on captured fields only.
    expect(insertOne.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        code: 'SPRING',
        percentOff: 12,
        startDate: new Date('2026-04-01T00:00:00Z'),
        endDate: new Date('2026-05-01T00:00:00Z'),
        maxUses: 5,
        usageCount: 0,
        createdBy: 'admin-1',
        active: true,
        createdAt: new Date('2026-04-09T12:00:00Z'),
        updatedAt: new Date('2026-04-09T12:00:00Z'),
      }),
    );
    expect(res.body.data).toMatchObject({
      _id: insertedId.toHexString(),
      code: 'SPRING',
      percentOff: 12,
      maxUses: 5,
      active: true,
    });
  });

  test('rejects devOnly when server environment disallows dev codes', async () => {
    isDevDiscountEnvironment.mockReturnValue(false);
    const insertOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(null), insertOne },
    }));

    const res = await request(buildApp(adminRouter)).post('/').send({
      code: 'DEVONLY',
      percentOff: 100,
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-05-01T00:00:00Z',
      maxUses: 0,
      devOnly: true,
    }).expect(403);

    expect(res.body.error).toMatch(/Dev-only/i);
    expect(insertOne).not.toHaveBeenCalled();
  });

  test('rejects unlimitedValidity without devOnly', async () => {
    const insertOne = jest.fn();
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(null), insertOne },
    }));

    const res = await request(buildApp(adminRouter)).post('/').send({
      code: 'BAD',
      percentOff: 100,
      startDate: '2026-04-01T00:00:00Z',
      endDate: '2026-05-02T00:00:00Z',
      unlimitedValidity: true,
    }).expect(400);

    expect(res.body).toEqual({ error: 'unlimitedValidity is only allowed together with devOnly' });
    expect(insertOne).not.toHaveBeenCalled();
  });

  test('creates dev-only unlimited-validity code with wide date window', async () => {
    const insertedId = new ObjectId();
    const insertOne = jest.fn().mockResolvedValue({ insertedId });
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(null), insertOne },
    }));

    await request(buildApp(adminRouter)).post('/').send({
      code: 'FREETEST',
      percentOff: 100,
      startDate: '',
      endDate: '',
      maxUses: 0,
      devOnly: true,
      unlimitedValidity: true,
    }).expect(201);

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FREETEST',
        percentOff: 100,
        maxUses: 0,
        devOnly: true,
        unlimitedValidity: true,
        startDate: new Date('2000-01-01T00:00:00.000Z'),
        endDate: new Date('2100-01-01T00:00:00.000Z'),
      }),
    );
  });

  test('rejects duplicate discount code names', async () => {
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue({ _id: 'existing' }) },
    }));

    const res = await request(buildApp(adminRouter)).post('/').send({
      code: 'SPRING',
      percentOff: 10,
      startDate: '2026-04-01',
      endDate: '2026-05-01',
    }).expect(409);

    expect(res.body).toEqual({ error: 'A discount code with this name already exists' });
  });

  test('lists discount codes newest first', async () => {
    const rows = [{ code: 'NEW' }, { code: 'OLD' }];
    const find = jest.fn().mockReturnValue(makeCursor(rows));
    getDb.mockReturnValue(makeDb({ discountCodes: { find } }));

    const res = await request(buildApp(adminRouter)).get('/').expect(200);

    expect(find).toHaveBeenCalledWith({});
    expect(res.body).toEqual({ message: 'success', data: rows });
  });

  test('updates only supported fields and validates effective date order', async () => {
    const id = new ObjectId();
    const existing = {
      _id: id,
      startDate: new Date('2026-04-01T00:00:00Z'),
      endDate: new Date('2026-05-01T00:00:00Z'),
    };
    const updated = { ...existing, percentOff: 25, active: false };
    const findOneAndUpdate = jest.fn().mockResolvedValue(updated);
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue(existing),
        findOneAndUpdate,
      },
    }));

    const res = await request(buildApp(adminRouter)).put(`/${id.toHexString()}`).send({
      percentOff: 25.9,
      maxUses: -1,
      active: false,
      endDate: '2026-05-15T00:00:00Z',
    }).expect(200);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id },
      {
        $set: {
          percentOff: 25,
          endDate: new Date('2026-05-15T00:00:00Z'),
          maxUses: 0,
          active: false,
          updatedAt: new Date('2026-04-09T12:00:00Z'),
        },
      },
      { returnDocument: 'after' },
    );
    expect(res.body).toEqual({ message: 'success', data: expect.any(Object) });
  });

  test('soft deletes discount codes and returns redemption history', async () => {
    const id = new ObjectId();
    const findOneAndUpdate = jest.fn().mockResolvedValue({ _id: id, code: 'SPRING', active: false });
    const redemptions = [{ code: 'SPRING', userId: 'user-1' }];
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOneAndUpdate },
      discountRedemptions: { find: jest.fn().mockReturnValue(makeCursor(redemptions)) },
    }));

    await request(buildApp(adminRouter)).delete(`/${id.toHexString()}`).expect(200);
    const history = await request(buildApp(adminRouter)).get(`/${id.toHexString()}/redemptions`).expect(200);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id },
      { $set: { active: false, updatedAt: new Date('2026-04-09T12:00:00Z') } },
      { returnDocument: 'after' },
    );
    expect(history.body).toEqual({ message: 'success', data: redemptions });
  });
});

describe('adDiscountRoutes validate router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('requires code and a valid submission id', async () => {
    await request(buildApp(validateRouter)).post('/validate').send({}).expect(400);

    const malformed = await request(buildApp(validateRouter))
      .post('/validate')
      .send({ code: 'SPRING', submissionId: 'bad-id' })
      .expect(400);

    expect(malformed.body).toEqual({ error: 'Invalid submission ID' });
  });

  test('rejects missing, inactive, expired, and exhausted discount codes', async () => {
    const id = new ObjectId();
    const submissionStub = { _id: id, package: { priceInCents: 1000 } };
    const findOne = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ active: false })
      .mockResolvedValueOnce({
        active: true,
        startDate: new Date('2026-04-10T00:00:00Z'),
        endDate: new Date('2026-04-30T00:00:00Z'),
      })
      .mockResolvedValueOnce({
        active: true,
        startDate: new Date('2026-04-01T00:00:00Z'),
        endDate: new Date('2026-04-30T00:00:00Z'),
        maxUses: 2,
        usageCount: 2,
      });
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne },
      adSubmissions: { findOne: jest.fn().mockResolvedValue(submissionStub) },
    }));

    await request(buildApp(validateRouter)).post('/validate').send({ code: 'NOPE', submissionId: id.toHexString() }).expect(404);
    await request(buildApp(validateRouter)).post('/validate').send({ code: 'OLD', submissionId: id.toHexString() }).expect(400);
    await request(buildApp(validateRouter)).post('/validate').send({ code: 'SOON', submissionId: id.toHexString() }).expect(400);
    await request(buildApp(validateRouter)).post('/validate').send({ code: 'USED', submissionId: id.toHexString() }).expect(400);
  });

  test('calculates discounted amount from the submission package price', async () => {
    const submissionId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue({
          _id: new ObjectId(),
          code: 'HALF',
          active: true,
          percentOff: 50,
          startDate: new Date('2026-04-01T00:00:00Z'),
          endDate: new Date('2026-04-30T00:00:00Z'),
          maxUses: 0,
          usageCount: 0,
        }),
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({ _id: submissionId, package: { priceInCents: 1999 } }),
      },
    }));

    const res = await request(buildApp(validateRouter)).post('/validate').send({
      code: 'half',
      submissionId: submissionId.toHexString(),
    }).expect(200);

    expect(res.body).toEqual({
      message: 'success',
      data: {
        percentOff: 50,
        originalAmountInCents: 1999,
        discountedAmountInCents: 999,
      },
    });
  });

  test('uses totalPriceInCents when set instead of package.priceInCents', async () => {
    const submissionId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue({
          _id: new ObjectId(),
          code: 'TEN',
          active: true,
          percentOff: 10,
          startDate: new Date('2026-04-01T00:00:00Z'),
          endDate: new Date('2026-04-30T00:00:00Z'),
          maxUses: 0,
          usageCount: 0,
        }),
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          totalPriceInCents: 10000,
          package: { priceInCents: 500 },
        }),
      },
    }));

    const res = await request(buildApp(validateRouter)).post('/validate').send({
      code: 'TEN',
      submissionId: submissionId.toHexString(),
    }).expect(200);

    expect(res.body.data).toEqual({
      percentOff: 10,
      originalAmountInCents: 10000,
      discountedAmountInCents: 9000,
    });
  });

  test('returns 400 for zero percent discount codes', async () => {
    const submissionId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue({
          active: true,
          percentOff: 0,
          startDate: new Date('2026-04-01T00:00:00Z'),
          endDate: new Date('2026-04-30T00:00:00Z'),
          maxUses: 0,
          usageCount: 0,
        }),
      },
      adSubmissions: { findOne: jest.fn().mockResolvedValue({ _id: submissionId, package: { priceInCents: 5000 } }) },
    }));

    const res = await request(buildApp(validateRouter)).post('/validate').send({
      code: 'noop',
      submissionId: submissionId.toHexString(),
    }).expect(400);

    expect(res.body.error).toBe('This discount code does not apply a discount');
  });

  test('returns 400 when submission has no positive order total', async () => {
    const submissionId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue({
          active: true,
          percentOff: 50,
          startDate: new Date('2026-04-01T00:00:00Z'),
          endDate: new Date('2026-04-30T00:00:00Z'),
          maxUses: 0,
          usageCount: 0,
        }),
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          totalPriceInCents: 0,
          package: { priceInCents: 0 },
        }),
      },
    }));

    const res = await request(buildApp(validateRouter)).post('/validate').send({
      code: 'half',
      submissionId: submissionId.toHexString(),
    }).expect(400);

    expect(res.body.error).toBe('Order total is not available yet; finish package selection and try again');
  });
});
