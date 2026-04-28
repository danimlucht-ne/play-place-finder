const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

function build(options) {
  if (isTest) {
    return (req, res, next) => next();
  }
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    ...options,
  });
}

/** Login, register, password reset, resend verification — per IP. */
const authEndpointLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: 25,
});

/** Authenticated user uploads — per IP. */
const userImageUploadLimiter = build({
  windowMs: 60 * 1000,
  max: 30,
});

/**
 * POST/PUT/PATCH/DELETE under `/api` for user router (favorites, lists, profile, consents, …).
 */
const userMutationLimiter = build({
  windowMs: 60 * 1000,
  max: 120,
});

/** Issue reports, crowd reports, support tickets — writes only. */
const reportSupportMutationLimiter = build({
  windowMs: 15 * 60 * 1000,
  max: 60,
});

/** Admin dashboard mutations — per IP (admins should use stable egress). */
const adminMutationLimiter = build({
  windowMs: 60 * 1000,
  max: 240,
});

/**
 * @param {import('express').RequestHandler} limiter
 * @returns {import('express').RequestHandler}
 */
function limitWrites(limiter) {
  return (req, res, next) => {
    const m = req.method;
    if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
      return limiter(req, res, next);
    }
    next();
  };
}

module.exports = {
  authEndpointLimiter,
  userImageUploadLimiter,
  userMutationLimiter,
  reportSupportMutationLimiter,
  adminMutationLimiter,
  limitWrites,
};
