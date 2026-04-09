/**
 * Shared rules for email/password sign-up. Keep in sync with Android LoginScreen.validatePassword.
 * Firebase also supports a console password policy; align minimums there if you enable it.
 * @returns {string|null} Error message or null if valid
 */
function validatePasswordStrength(password) {
    if (typeof password !== 'string' || password.length === 0) {
        return 'Password is required.';
    }
    if (password.length < 12) {
        return 'Password must be at least 12 characters.';
    }
    if (password.length > 128) {
        return 'Password must be at most 128 characters.';
    }
    if (!/[a-z]/.test(password)) {
        return 'Password must include a lowercase letter.';
    }
    if (!/[A-Z]/.test(password)) {
        return 'Password must include an uppercase letter.';
    }
    if (!/[0-9]/.test(password)) {
        return 'Password must include a number.';
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        return 'Password must include a special character.';
    }
    return null;
}

module.exports = { validatePasswordStrength };
