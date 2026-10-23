// src/middleware/rateLimiter.js
// Rate limiter specifically for the login route to mitigate brute-force attacks

const rateLimit = require('express-rate-limit');

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: process.env.LOGIN_RATE_LIMIT_MAX ? parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) : 10,
  skipSuccessfulRequests: true, // Only failed logins (non-2xx responses) consume rate limit quota
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: {
    error: 'Too many login attempts. Try again later.'
  }
});

module.exports = {
  loginRateLimiter
};
