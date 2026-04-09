describe('stripeService.releaseAuthorization', () => {
  let stripeClient;
  let stripeFactory;
  let db;
  let updateOne;
  let releaseAuthorization;

  beforeEach(() => {
    jest.resetModules();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';

    updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    db = {
      collection: jest.fn().mockReturnValue({
        updateOne,
      }),
    };

    stripeClient = {
      paymentIntents: {
        retrieve: jest.fn(),
        cancel: jest.fn(),
      },
      refunds: { create: jest.fn() },
      setupIntents: { create: jest.fn(), retrieve: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
      customers: { create: jest.fn() },
    };
    stripeFactory = jest.fn(() => stripeClient);

    jest.doMock('../database', () => ({
      getDb: jest.fn(() => db),
    }));
    jest.doMock('stripe', () => stripeFactory);

    ({ releaseAuthorization } = require('../services/stripeService'));
  });

  test('noops when paymentIntentId is missing', async () => {
    await releaseAuthorization('', 'reason');
    expect(stripeFactory).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('marks transaction cancelled when PI already canceled', async () => {
    stripeClient.paymentIntents.retrieve.mockResolvedValue({ status: 'canceled' });

    await releaseAuthorization('pi_123', 'already canceled');

    expect(stripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  test('cancels PI and marks transaction cancelled for cancelable states', async () => {
    stripeClient.paymentIntents.retrieve.mockResolvedValue({ status: 'requires_capture' });
    stripeClient.paymentIntents.cancel.mockResolvedValue({ id: 'pi_123', status: 'canceled' });

    await releaseAuthorization('pi_123', 'admin reject');

    expect(stripeClient.paymentIntents.cancel).toHaveBeenCalledWith('pi_123');
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  test('treats already-canceled cancel error as noop and still updates DB', async () => {
    stripeClient.paymentIntents.retrieve.mockResolvedValue({ status: 'requires_capture' });
    stripeClient.paymentIntents.cancel.mockRejectedValue({
      code: 'payment_intent_unexpected_state',
      message: 'Cannot cancel this PaymentIntent because it has a status of canceled',
    });

    await releaseAuthorization('pi_123', 'admin reject');

    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  test('returns without DB updates when PI was already captured', async () => {
    stripeClient.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded' });

    await releaseAuthorization('pi_123', 'admin reject');

    expect(stripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  test('returns without throwing when PI retrieve fails', async () => {
    stripeClient.paymentIntents.retrieve.mockRejectedValue(new Error('network down'));

    await expect(releaseAuthorization('pi_123', 'admin reject')).resolves.toBeUndefined();

    expect(updateOne).not.toHaveBeenCalled();
  });
});
