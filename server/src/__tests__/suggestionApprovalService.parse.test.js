const { parseFeatureSuggestionMessage } = require('../services/suggestionApprovalService');

describe('parseFeatureSuggestionMessage', () => {
  test('parses standard app suggestion message with location suffix', () => {
    const msg =
      'New Playground Equipment suggestion: toddler swing [Location Type: Public Park]';
    expect(parseFeatureSuggestionMessage(msg)).toEqual({
      category: 'Playground Equipment',
      label: 'toddler swing',
    });
  });

  test('extracts category and label from any "New … suggestion:" line (caller validates category)', () => {
    expect(parseFeatureSuggestionMessage('New Unknown Cat suggestion: x')).toEqual({
      category: 'Unknown Cat',
      label: 'x',
    });
  });

  test('returns null category and label when message does not match pattern', () => {
    expect(parseFeatureSuggestionMessage('plain text')).toEqual({
      category: null,
      label: null,
    });
  });
});
