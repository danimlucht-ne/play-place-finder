describe('captureOrChargeSubmission', () => {
  let stripeClient, stripeFactory, db, findOne, updateOne, insertOne;
  let captureOrChargeSubmission;

  beforeEach(() => {
    jest.resetModules();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    findOne = jest.fn();
    updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    insertOne = jest.fn().mockResolvedValue({ acknowledged: true });
    db = { collection: jest.fn().mockReturnValue({ findOne, updateOne, insertOne }) };

    stripeClient = {
      paymentIntents: { retrieve: jest.fn(), capture: jest.fn(), create: jest.fn(), cancel: jest.fn() },
      refunds: { create: jest.fn() },
      setupIntents: { create: jest.fn(), retrieve: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
      customers: { create: jest.fn() },
    };
    stripeFactory = jest.fn(() => stripeClient);

    jest.doMock('../database', () => ({ getDb: jest.fn(() => db) }));
    jest.doMock('stripe', () => stripeFactory);
    jest.doMock('../services/adValidationService', () => ({ runValidation: jest.fn().mockResolvedValue({}) }));
    jest.doMock('../services/adCampaignEmailTriggers', () => ({ notifyPaymentCapturedIfNeeded: jest.fn().mockResolvedValue() }));

    ({ captureOrChargeSubmission } = require('../services/stripeService'));
  });

  test('captures manual_capture PaymentIntent successfully', async () => {
    findOne.mockResolvedValue({ _id: 'tx1', amountInCents: 4999 });
    stripeClient.paymentIntents.capture.mockResolvedValue({ status: 'succeeded', id: 'pi_123' });

    const result = await captureOrChargeSubmission({
      _id: 'sub1', paymentMode: 'manual_capture', paymentIntentId: 'pi_123',
    });
    expect(result).toEqual({ mode: 'manual_capture', paymentIntentId: 'pi_123' });
  });

  test('throws when capture fails', async () => {
    findOne.mockResolvedValue({ _id: 'tx1', amountInCents: 4999 });
    stripeClient.paymentIntents.capture.mockResolvedValue({ status: 'requires_payment_method', id: 'pi_123' });

    await expect(captureOrChargeSubmission({
      _id: 'sub1', paymentMode: 'manual_capture', paymentIntentId: 'pi_123',
    })).rejects.toThrow();
  });

  test('charges setup_intent with saved payment method', async () => {
    findOne.mockResolvedValue({ _id: 'tx1', amountInCents: 4999 });
    stripeClient.paymentIntents.create.mockResolvedValue({ status: 'succeeded', id: 'pi_new' });

    const result = await captureOrChargeSubmission({
      _id: 'sub1', advertiserId: 'adv1', paymentMode: 'setup_intent',
      paymentMethodId: 'pm_123', stripeCustomerId: 'cus_1', package: { type: 'featured_home' },
    });
    expect(result).toEqual(expect.objectContaining({ mode: 'setup_intent' }));
    expect(insertOne).toHaveBeenCalled();
  });

  test('throws when no payment method for setup_intent', async () => {
    findOne.mockResolvedValue({ _id: 'tx1', amountInCents: 4999 });

    await expect(captureOrChargeSubmission({
      _id: 'sub1', paymentMode: 'setup_intent',
    })).rejects.toThrow('No saved payment method');
  });

  test('throws when no payment transaction found', async () => {
    findOne.mockResolvedValue(null);

    await expect(captureOrChargeSubmission({ _id: 'sub1' })).rejects.toThrow('Missing payment transaction');
  });

  test('throws for unsupported paymentMode', async () => {
    findOne.mockResolvedValue({ _id: 'tx1', amountInCents: 4999 });

    await expect(captureOrChargeSubmission({
      _id: 'sub1', paymentMode: 'unknown',
    })).rejects.toThrow();
  });
});

describe('reconcileSubmissionAfterCheckout', () => {
  let stripeClient, stripeFactory, db, findOne, updateOne, insertOne;
  let reconcileSubmissionAfterCheckout, runValidation;

  beforeEach(() => {
    jest.resetModules();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    findOne = jest.fn();
    updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    insertOne = jest.fn().mockResolvedValue({ acknowledged: true });
    db = { collection: jest.fn().mockReturnValue({ findOne, updateOne, insertOne }) };

    stripeClient = {
      paymentIntents: { retrieve: jest.fn(), capture: jest.fn(), create: jest.fn(), cancel: jest.fn() },
      refunds: { create: jest.fn() },
      setupIntents: { create: jest.fn(), retrieve: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
      customers: { create: jest.fn() },
    };
    stripeFactory = jest.fn(() => stripeClient);

    runValidation = jest.fn().mockResolvedValue({});
    jest.doMock('../database', () => ({ getDb: jest.fn(() => db) }));
    jest.doMock('stripe', () => stripeFactory);
    jest.doMock('../services/adValidationService', () => ({ runValidation }));
    jest.doMock('../services/adCampaignEmailTriggers', () => ({ notifyPaymentCapturedIfNeeded: jest.fn().mockResolvedValue() }));

    ({ reconcileSubmissionAfterCheckout } = require('../services/stripeService'));
  });

  test('captures requires_capture PI and runs validation', async () => {
    const sub = { _id: 'sub1', paymentMode: 'manual_capture', paymentIntentId: 'pi_123' };
    findOne
      .mockResolvedValueOnce(sub)                                          // initial findOne
      .mockResolvedValueOnce({ _id: 'tx1', amountInCents: 4999 })         // captureOrCharge tx lookup
      .mockResolvedValueOnce({ ...sub, validationResult: undefined });     // re-fetch after capture
    stripeClient.paymentIntents.retrieve.mockResolvedValue({ status: 'requires_capture' });
    stripeClient.paymentIntents.capture.mockResolvedValue({ status: 'succeeded', id: 'pi_123' });

    const result = await reconcileSubmissionAfterCheckout('sub1');
    expect(result.ok).toBe(true);
    expect(runValidation).toHaveBeenCalled();
  });

  test('throws when submission not found', async () => {
    findOne.mockResolvedValue(null);
    await expect(reconcileSubmissionAfterCheckout('sub1')).rejects.toThrow('Submission not found');
  });

  test('skips when paymentMode is not manual_capture', async () => {
    findOne.mockResolvedValue({ _id: 'sub1', paymentMode: 'other' });

    const result = await reconcileSubmissionAfterCheckout('sub1');
    expect(result).toEqual({ ok: true, skipped: true });
  });

  test('handles setup_intent succeeded', async () => {
    const sub = { _id: 'sub1', paymentMode: 'setup_intent', setupIntentId: 'seti_1' };
    findOne
      .mockResolvedValueOnce(sub)
      .mockResolvedValueOnce({ ...sub, paymentMethodId: 'pm_123', validationResult: undefined });
    stripeClient.setupIntents.retrieve.mockResolvedValue({ status: 'succeeded', payment_method: 'pm_123' });

    const result = await reconcileSubmissionAfterCheckout('sub1');
    expect(result.ok).toBe(true);
    expect(updateOne).toHaveBeenCalled();
    expect(runValidation).toHaveBeenCalled();
  });
});
