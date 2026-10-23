// src/middleware/rateLimiter.js
// Rate limiters for authentication endpoints

const rateLimit = require('express-rate-limit');

// Rate limiter for login route to mitigate brute-force password guessing
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: process.env.LOGIN_RATE_LIMIT_MAX ? parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) : 10,
  skipSuccessfulRequests: true, // Only failed logins consume rate limit quota
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: {
    error: 'Too many login attempts. Try again later.'
  }
});

// Rate limiter for registration route: 5 attempts per hour per IP
const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: {
    error: 'Too many registration attempts. Please try again later.'
  }
});

module.exports = {
  loginRateLimiter,
  registerRateLimiter
};
