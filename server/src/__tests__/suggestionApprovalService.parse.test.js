const { parseEquipmentSuggestionFromMessage } = require('../services/suggestionApprovalService');

describe('parseEquipmentSuggestionFromMessage', () => {
  test('parses standard app suggestion message with location suffix', () => {
    const msg =
      'New Playground Equipment suggestion: toddler swing [Location Type: Public Park]';
    expect(parseEquipmentSuggestionFromMessage(msg)).toEqual({
      category: 'Playground Equipment',
      label: 'toddler swing',
    });
  });

  test('returns null when category is unknown', () => {
    expect(parseEquipmentSuggestionFromMessage('New Unknown Cat suggestion: x')).toBeNull();
  });
});
