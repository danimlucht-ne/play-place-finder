'use strict';

/**
 * Dev-only discount codes ([devOnly] on discountCodes) may only be created and redeemed when this is true.
 * Production must stay false unless explicitly overridden for a dedicated test stack.
 */
function isDevDiscountEnvironment() {
  const flag = String(process.env.ALLOW_DEV_DISCOUNT_CODES || '').toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'yes') return true;
  const env = String(process.env.NODE_ENV || 'development').toLowerCase();
  return env !== 'production';
}

module.exports = { isDevDiscountEnvironment };
