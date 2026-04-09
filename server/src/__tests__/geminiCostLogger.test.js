const { logGeminiCall } = require('../services/geminiCostLogger');

describe('geminiCostLogger', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('emits a structured one-line usage log with optional fields', () => {
    logGeminiCall({
      callSite: 'photo-classification',
      model: 'gemini-test',
      multimodal: true,
      placeId: 123,
      ms: 42.6,
      batchSize: 7,
      attempt: 2,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [prefix, json] = logSpy.mock.calls[0];
    expect(prefix).toBe('[gemini-cost]');
    expect(JSON.parse(json)).toEqual({
      callSite: 'photo-classification',
      model: 'gemini-test',
      multimodal: true,
      ms: 43,
      placeId: '123',
      batchSize: 7,
      attempt: 2,
    });
  });

  test('uses null/defaults for omitted non-required values', () => {
    logGeminiCall({ callSite: 'seed', ms: null });

    const [, json] = logSpy.mock.calls[0];
    expect(JSON.parse(json)).toEqual({
      callSite: 'seed',
      model: null,
      multimodal: false,
      ms: null,
    });
  });
});
