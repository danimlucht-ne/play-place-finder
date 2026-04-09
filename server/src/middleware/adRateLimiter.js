const rateLimit = require('express-rate-limit');

const adServingLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 60,                    // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const adEventLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,                    // 10 events per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

module.exports = { adServingLimiter, adEventLimiter };
