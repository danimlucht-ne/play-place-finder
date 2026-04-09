'use strict';

const { isDevDiscountEnvironment } = require('../utils/devDiscountEnvironment');

function normalizeRegionKey(v) {
  return String(v || '').trim().toLowerCase().replace(/_/g, '-');
}

/**
 * Throws with statusCode on business-rule violations (same messages as legacy checks).
 * @param {object} discountCode — discountCodes doc
 * @param {object} submission — adSubmissions doc
 * @param {object|null} advertiser — advertisers doc for submission.advertiserId (required when code has regionKey)
 * @param {Date} [now]
 */
function assertDiscountApplicable(discountCode, submission, advertiser, now = new Date()) {
  if (!discountCode.active) {
    const e = new Error('This discount code is no longer active');
    e.statusCode = 400;
    throw e;
  }

  if (discountCode.devOnly && !isDevDiscountEnvironment()) {
    const e = new Error('Invalid discount code');
    e.statusCode = 404;
    throw e;
  }

  if (!discountCode.unlimitedValidity) {
    if (now < discountCode.startDate || now > discountCode.endDate) {
      const e = new Error('This discount code is not currently valid');
      e.statusCode = 400;
      throw e;
    }
  }

  if (discountCode.maxUses > 0 && discountCode.usageCount >= discountCode.maxUses) {
    const e = new Error('This discount code has reached its usage limit');
    e.statusCode = 400;
    throw e;
  }

  if (discountCode.advertiserId && String(discountCode.advertiserId) !== String(submission.advertiserId)) {
    const e = new Error('This discount code is not valid for your account');
    e.statusCode = 400;
    throw e;
  }

  if (discountCode.regionKey && String(discountCode.regionKey).trim()) {
    const want = normalizeRegionKey(discountCode.regionKey);
    const got = normalizeRegionKey(advertiser?.regionKey);
    if (!got || got !== want) {
      const e = new Error('This discount code is not valid for your region');
      e.statusCode = 400;
      throw e;
    }
  }

  const percentOff = Number(discountCode.percentOff) || 0;
  if (percentOff <= 0) {
    const e = new Error('This discount code does not apply a discount');
    e.statusCode = 400;
    throw e;
  }
}

module.exports = { assertDiscountApplicable, normalizeRegionKey };
