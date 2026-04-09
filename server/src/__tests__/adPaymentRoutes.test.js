jest.mock('../database', () => ({ getDb: jest.fn() }));
jest.mock('../services/stripeService', () => ({
  createPaymentIntent: jest.fn(),
  handleWebhook: jest.fn(),
  reconcileSubmissionAfterCheckout: jest.fn(),
}));
jest.mock('../services/adValidationService', () => ({ runValidation: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');
const { getDb } = require('../database');
const stripeService = require('../services/stripeService');
const adValidationService = require('../services/adValidationService');
const adPaymentRoutes = require('../routes/adPaymentRoutes');

function buildApp(uid = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid };
    next();
  });
  app.use('/', adPaymentRoutes);
  return app;
}

function makeDb(collections) {
  return {
    collection: jest.fn((name) => {
      if (collections[name] != null) return collections[name];
      // validateDiscountCode loads advertisers for scoped discount rules
      if (name === 'advertisers') {
        return { findOne: jest.fn().mockResolvedValue(null) };
      }
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
}

function validDiscount(overrides = {}) {
  return {
    _id: new ObjectId(),
    code: 'HALF',
    active: true,
    percentOff: 50,
    startDate: new Date('2026-04-01T00:00:00Z'),
    endDate: new Date('2026-04-30T00:00:00Z'),
    maxUses: 0,
    usageCount: 0,
    ...overrides,
  };
}

describe('adPaymentRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('create-intent requires a valid submission id before calling Stripe', async () => {
    await request(buildApp()).post('/create-intent').send({}).expect(400);

    const malformed = await request(buildApp())
      .post('/create-intent')
      .send({ submissionId: 'bad-id' })
      .expect(400);

    expect(malformed.body).toEqual({ error: 'Invalid submission ID' });
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  test('create-intent passes discount info to Stripe and records redemption side effects', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const discount = validDiscount();
    const submission = {
      _id: submissionId,
      advertiserId,
      userId: 'user-1',
      totalPriceInCents: 3000,
      package: { priceInCents: 4000 },
    };
    const updateDiscount = jest.fn();
    const insertRedemption = jest.fn();
    const updateSubmission = jest.fn();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue(discount),
        updateOne: updateDiscount,
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue(submission),
        updateOne: updateSubmission,
      },
      discountRedemptions: { insertOne: insertRedemption },
    }));
    stripeService.createPaymentIntent.mockResolvedValue({ clientSecret: 'sec_123' });

    const res = await request(buildApp()).post('/create-intent').send({
      submissionId: submissionId.toHexString(),
      discountCode: 'half',
    }).expect(200);

    expect(stripeService.createPaymentIntent).toHaveBeenCalledWith(submissionId, {
      discountedAmountInCents: 1500,
      discountCodeId: discount._id,
      discountCode: 'HALF',
      percentOff: 50,
      originalAmountInCents: 3000,
    });
    expect(updateDiscount).toHaveBeenCalledWith(
      { _id: discount._id },
      { $inc: { usageCount: 1 }, $set: { updatedAt: new Date('2026-04-09T12:00:00Z') } },
    );
    expect(insertRedemption).toHaveBeenCalledWith(expect.objectContaining({
      discountCodeId: discount._id,
      submissionId,
      advertiserId,
      userId: 'user-1',
      originalAmountInCents: 3000,
      discountedAmountInCents: 1500,
      redeemedAt: new Date('2026-04-09T12:00:00Z'),
    }));
    expect(updateSubmission).toHaveBeenCalledWith(
      { _id: submissionId },
      { $set: expect.objectContaining({ discountCode: 'HALF', discountedAmountInCents: 1500 }) },
    );
    expect(res.body).toEqual({ message: 'success', data: { clientSecret: 'sec_123' } });
  });

  test('create-intent rejects zero-percent codes before calling Stripe', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const discount = validDiscount({ percentOff: 0 });
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(discount) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          advertiserId,
          userId: 'user-1',
          package: { priceInCents: 5000 },
        }),
      },
    }));

    const res = await request(buildApp()).post('/create-intent').send({
      submissionId: submissionId.toHexString(),
      discountCode: 'HALF',
    }).expect(400);

    expect(res.body.error).toBe('This discount code does not apply a discount');
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  test('create-intent skips Stripe for 100 percent discount with zero total', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const discount = validDiscount({
      code: 'FREE',
      percentOff: 100,
    });
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(discount) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          advertiserId,
          userId: 'user-1',
          totalPriceInCents: 3900,
          package: { priceInCents: 3900 },
        }),
      },
    }));

    const res = await request(buildApp()).post('/create-intent').send({
      submissionId: submissionId.toHexString(),
      discountCode: 'FREE',
    }).expect(200);

    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      message: 'success',
      data: {
        clientSecret: '',
        paymentIntentId: '',
        freeCheckout: true,
      },
    });
  });

  test('create-intent rejects discount when submission has no positive order total', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const discount = validDiscount({ percentOff: 50 });
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(discount) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: submissionId,
          advertiserId,
          userId: 'user-1',
          totalPriceInCents: 0,
          package: { priceInCents: 0 },
        }),
      },
    }));

    const res = await request(buildApp()).post('/create-intent').send({
      submissionId: submissionId.toHexString(),
      discountCode: 'HALF',
    }).expect(400);

    expect(res.body.error).toBe('Order total is not available yet; finish package selection and try again');
    expect(stripeService.createPaymentIntent).not.toHaveBeenCalled();
  });

  test('free-submission rejects partial discounts and processes 100 percent discounts', async () => {
    const partialSubmissionId = new ObjectId();
    getDb.mockReturnValueOnce(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(validDiscount({ percentOff: 50 })) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: partialSubmissionId,
          advertiserId: new ObjectId(),
          package: { priceInCents: 1000 },
        }),
      },
    }));

    await request(buildApp()).post('/free-submission').send({
      submissionId: partialSubmissionId.toHexString(),
      discountCode: 'HALF',
    }).expect(400);

    const freeSubmissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const discount = validDiscount({ code: 'FREE', percentOff: 100 });
    const updateDiscount = jest.fn();
    const insertRedemption = jest.fn();
    const updateSubmission = jest.fn();
    const insertPayment = jest.fn();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue(discount),
        updateOne: updateDiscount,
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: freeSubmissionId,
          advertiserId,
          userId: 'user-1',
          package: { priceInCents: 1000 },
        }),
        updateOne: updateSubmission,
      },
      discountRedemptions: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: insertRedemption,
      },
      paymentTransactions: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: insertPayment,
      },
    }));

    const res = await request(buildApp()).post('/free-submission').send({
      submissionId: freeSubmissionId.toHexString(),
      discountCode: 'FREE',
    }).expect(200);

    expect(updateDiscount).toHaveBeenCalled();
    expect(insertRedemption).toHaveBeenCalledWith(expect.objectContaining({
      discountCodeId: discount._id,
      discountedAmountInCents: 0,
    }));
    expect(insertPayment).toHaveBeenCalledWith(expect.objectContaining({
      submissionId: freeSubmissionId,
      advertiserId,
      stripePaymentIntentId: `free_submission:${freeSubmissionId.toHexString()}`,
      amountInCents: 0,
      status: 'succeeded',
      discountCode: 'FREE',
    }));
    expect(updateSubmission).toHaveBeenLastCalledWith(
      { _id: freeSubmissionId },
      { $set: expect.objectContaining({ status: 'paid', paidAt: new Date('2026-04-09T12:00:00Z') }) },
    );
    expect(adValidationService.runValidation).toHaveBeenCalledWith(freeSubmissionId);
    expect(res.body).toEqual({ message: 'success' });
  });

  test('free-submission completes when redemption already exists (retry after partial failure)', async () => {
    const freeSubmissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const discount = validDiscount({ code: 'FREE', percentOff: 100 });
    const updateDiscount = jest.fn();
    const insertRedemption = jest.fn();
    const updateSubmission = jest.fn();
    const insertPayment = jest.fn();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue(discount),
        updateOne: updateDiscount,
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: freeSubmissionId,
          advertiserId,
          userId: 'user-1',
          package: { priceInCents: 1000 },
        }),
        updateOne: updateSubmission,
      },
      discountRedemptions: {
        findOne: jest.fn().mockResolvedValue({
          submissionId: freeSubmissionId,
          code: 'FREE',
          discountCodeId: discount._id,
        }),
        insertOne: insertRedemption,
      },
      paymentTransactions: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: insertPayment,
      },
    }));

    const res = await request(buildApp()).post('/free-submission').send({
      submissionId: freeSubmissionId.toHexString(),
      discountCode: 'free',
    }).expect(200);

    expect(updateDiscount).not.toHaveBeenCalled();
    expect(insertRedemption).not.toHaveBeenCalled();
    expect(insertPayment).toHaveBeenCalled();
    expect(updateSubmission).toHaveBeenCalled();
    expect(adValidationService.runValidation).toHaveBeenCalledWith(freeSubmissionId);
    expect(res.body).toEqual({ message: 'success' });
  });

  test('free-submission is a no-op when already paid with a succeeded transaction', async () => {
    const freeSubmissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const discount = validDiscount({ code: 'FREE', percentOff: 100 });
    const updateDiscount = jest.fn();
    const insertRedemption = jest.fn();
    const insertPayment = jest.fn();
    const updateSubmission = jest.fn();
    getDb.mockReturnValue(makeDb({
      discountCodes: {
        findOne: jest.fn().mockResolvedValue(discount),
        updateOne: updateDiscount,
      },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: freeSubmissionId,
          advertiserId,
          userId: 'user-1',
          package: { priceInCents: 1000 },
          status: 'paid',
          paidAt: new Date('2026-04-08T00:00:00Z'),
        }),
        updateOne: updateSubmission,
      },
      discountRedemptions: {
        findOne: jest.fn().mockResolvedValue({ code: 'FREE' }),
        insertOne: insertRedemption,
      },
      paymentTransactions: {
        findOne: jest.fn().mockResolvedValue({
          submissionId: freeSubmissionId,
          status: 'succeeded',
        }),
        insertOne: insertPayment,
      },
    }));

    const res = await request(buildApp()).post('/free-submission').send({
      submissionId: freeSubmissionId.toHexString(),
      discountCode: 'FREE',
    }).expect(200);

    expect(updateDiscount).not.toHaveBeenCalled();
    expect(insertRedemption).not.toHaveBeenCalled();
    expect(insertPayment).not.toHaveBeenCalled();
    expect(updateSubmission).not.toHaveBeenCalled();
    expect(adValidationService.runValidation).not.toHaveBeenCalled();
    expect(res.body).toEqual({ message: 'success' });
  });

  test('free-submission rejects when order total is not positive even with a 100% code', async () => {
    const freeSubmissionId = new ObjectId();
    const discount = validDiscount({ code: 'FREE', percentOff: 100 });
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(discount) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: freeSubmissionId,
          advertiserId: new ObjectId(),
          userId: 'user-1',
          package: { priceInCents: 0 },
        }),
      },
    }));

    const res = await request(buildApp()).post('/free-submission').send({
      submissionId: freeSubmissionId.toHexString(),
      discountCode: 'FREE',
    }).expect(400);

    expect(res.body.error).toBe('Order total is not available yet; finish package selection and try again');
    expect(adValidationService.runValidation).not.toHaveBeenCalled();
  });

  test('free-submission rejects when discounted total is not zero', async () => {
    const freeSubmissionId = new ObjectId();
    const discount = validDiscount({ code: 'ALMOST', percentOff: 99 });
    getDb.mockReturnValue(makeDb({
      discountCodes: { findOne: jest.fn().mockResolvedValue(discount) },
      adSubmissions: {
        findOne: jest.fn().mockResolvedValue({
          _id: freeSubmissionId,
          advertiserId: new ObjectId(),
          userId: 'user-1',
          package: { priceInCents: 10000 },
        }),
      },
    }));

    const res = await request(buildApp()).post('/free-submission').send({
      submissionId: freeSubmissionId.toHexString(),
      discountCode: 'ALMOST',
    }).expect(400);

    expect(res.body.error).toBe('Discount does not cover full amount');
    expect(adValidationService.runValidation).not.toHaveBeenCalled();
  });

  test('webhook requires a Stripe signature and returns handler result', async () => {
    const missing = await request(buildApp()).post('/webhook').send({}).expect(400);
    expect(missing.body).toEqual({ error: 'Missing Stripe-Signature header' });

    stripeService.handleWebhook.mockResolvedValue({ type: 'payment_intent.succeeded' });
    const res = await request(buildApp())
      .post('/webhook')
      .set('stripe-signature', 'sig_123')
      .send({ id: 'evt_1' })
      .expect(200);

    expect(stripeService.handleWebhook).toHaveBeenCalledWith({ id: 'evt_1' }, 'sig_123');
    expect(res.body).toEqual({ received: true, type: 'payment_intent.succeeded' });
  });

  test('reconcile verifies advertiser ownership before reconciling checkout', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    getDb.mockReturnValue(makeDb({
      adSubmissions: { findOne: jest.fn().mockResolvedValue({ _id: submissionId, advertiserId }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
    }));
    stripeService.reconcileSubmissionAfterCheckout.mockResolvedValue({ reconciled: true });

    const res = await request(buildApp()).post(`/reconcile/${submissionId.toHexString()}`).expect(200);

    expect(stripeService.reconcileSubmissionAfterCheckout).toHaveBeenCalledWith(submissionId.toHexString());
    expect(res.body).toEqual({ message: 'success', data: { reconciled: true } });
  });

  test('receipt endpoint requires succeeded receipt and matching advertiser owner', async () => {
    const submissionId = new ObjectId();
    const advertiserId = new ObjectId();
    const receipt = { receiptUrl: 'https://stripe.example/receipt' };
    getDb.mockReturnValue(makeDb({
      paymentTransactions: {
        findOne: jest.fn().mockResolvedValue({
          submissionId,
          status: 'succeeded',
          receipt,
        }),
      },
      adSubmissions: { findOne: jest.fn().mockResolvedValue({ _id: submissionId, advertiserId }) },
      advertisers: { findOne: jest.fn().mockResolvedValue({ _id: advertiserId, userId: 'user-1' }) },
    }));

    const res = await request(buildApp()).get(`/receipt/${submissionId.toHexString()}`).expect(200);

    expect(res.body).toEqual({ message: 'success', data: receipt });
  });
});
