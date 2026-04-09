const { classifyPlaceForValidation } = require('../services/placeValidityRules');

describe('placeValidityRules', () => {
  test('accepts park', () => {
    expect(
      classifyPlaceForValidation({
        id: 'x',
        name: 'Sun Park',
        types: ['park', 'point_of_interest'],
      }).decision,
    ).toBe('accept');
  });

  test('rejects lodging type', () => {
    expect(
      classifyPlaceForValidation({
        id: 'x',
        name: 'Stay Inn',
        types: ['lodging'],
      }).decision,
    ).toBe('reject');
  });

  test('rejects hotel in name', () => {
    expect(
      classifyPlaceForValidation({
        id: 'x',
        name: 'Grand Hotel Playground',
        types: ['establishment'],
      }).decision,
    ).toBe('reject');
  });

  test('llm for ambiguous types', () => {
    expect(
      classifyPlaceForValidation({
        id: 'x',
        name: 'Mystery Spot',
        types: ['establishment', 'point_of_interest'],
      }).decision,
    ).toBe('llm');
  });
});
