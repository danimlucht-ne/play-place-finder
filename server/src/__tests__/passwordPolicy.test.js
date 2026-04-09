const { validatePasswordStrength } = require('../utils/passwordPolicy');

describe('validatePasswordStrength', () => {
  test.each([
    [undefined, 'Password is required.'],
    ['', 'Password is required.'],
    ['Short1!', 'Password must be at least 12 characters.'],
    ['a'.repeat(129) + 'A1!', 'Password must be at most 128 characters.'],
    ['ALLUPPERCASE1!', 'Password must include a lowercase letter.'],
    ['alllowercase1!', 'Password must include an uppercase letter.'],
    ['NoNumberHere!', 'Password must include a number.'],
    ['NoSpecial1234', 'Password must include a special character.'],
  ])('rejects invalid password %#', (password, expected) => {
    expect(validatePasswordStrength(password)).toBe(expected);
  });

  test('accepts a strong password', () => {
    expect(validatePasswordStrength('FamilyFun123!')).toBeNull();
  });
});
