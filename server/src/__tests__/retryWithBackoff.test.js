const { retryWithBackoff } = require('../services/retryWithBackoff');

describe('retryWithBackoff', () => {
  let warnSpy;
  let randomSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    randomSpy.mockRestore();
  });

  test('returns immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(retryWithBackoff(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('retries retryable HTTP failures and eventually succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce({ response: { status: 503 }, message: 'temporarily down' })
      .mockResolvedValue('recovered');

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0, label: 'unit' })).resolves.toBe('recovered');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[unit] Attempt 1 failed'));
  });

  test('does not retry non-retryable failures', async () => {
    const err = Object.assign(new Error('bad input'), { status: 400 });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries transient network and quota messages until maxRetries is exhausted', async () => {
    const err = Object.assign(new Error('quota resource exhausted'), { code: 'ETIMEDOUT' });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 })).rejects.toBe(err);

    expect(fn).toHaveBeenCalledTimes(3);
  });
});
