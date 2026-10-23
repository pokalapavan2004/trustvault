// src/routes/auth.js
// Authentication routes: register, login, logout, and me

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { loginRateLimiter, registerRateLimiter } = require('../middleware/rateLimiter');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SALT_ROUNDS = 12;

// Username pattern: 3 to 30 characters, letters, digits, and underscores only
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
// Standard email validation pattern
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper to configure session cookie options
const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_DURATION_MS,
  path: '/'
});

/**
 * POST /api/auth/register
 * Registers a new user account with role 'user'.
 * Rate limited to 5 attempts per hour per IP.
 */
router.post('/register', registerRateLimiter, async (req, res) => {
  const { username, email, password, confirmPassword } = req.body || {};

  // Validate presence
  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).json({ error: 'Username, email, password, and confirm password are required' });
  }

  if (
    typeof username !== 'string' ||
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    typeof confirmPassword !== 'string'
  ) {
    return res.status(400).json({ error: 'Invalid input format' });
  }

  const cleanUsername = username.trim();
  const normalisedEmail = email.trim().toLowerCase();

  // Validate username pattern: 3 to 30 chars, letters, digits, underscore
  if (!USERNAME_REGEX.test(cleanUsername)) {
    return res.status(400).json({
      error: 'Username must be between 3 and 30 characters and contain only letters, numbers, and underscores'
    });
  }

  // Validate email pattern
  if (!EMAIL_REGEX.test(normalisedEmail) || normalisedEmail.length > 255) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  // Validate password complexity: at least 10 chars with at least one letter and one number
  if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({
      error: 'Password must be at least 10 characters long and include at least one letter and one number'
    });
  }

  // Validate password confirmation
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  try {
    // Check if username (case-insensitive) or email already exists
    const existingCheck = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)',
      [normalisedEmail, cleanUsername]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }

    // Role is ALWAYS 'user', ignore any role/id/is_active in request body
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const insertResult = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'user', true)
       RETURNING id, username, email, role, created_at`,
      [cleanUsername, normalisedEmail, passwordHash]
    );

    const newUser = insertResult.rows[0];

    // Return 201 without automatic login
    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.created_at
      }
    });
  } catch (err) {
    // Catch unique constraint violation (code 23505) in case of race condition
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or email already in use' });
    }

    console.error('Registration error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Authenticates user, applies rate limiting, sets httpOnly sameSite cookie
 */
router.post('/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const normalisedEmail = email.trim().toLowerCase();

    // Query user by email using parameterised query
    const userResult = await db.query(
      'SELECT id, username, email, full_name, password_hash, role, is_active FROM users WHERE LOWER(email) = LOWER($1)',
      [normalisedEmail]
    );

    if (userResult.rows.length === 0) {
      // Avoid user enumeration: generic invalid credentials message
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    // Check account status
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    // Compare password hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      // Same generic message for wrong password as for unknown email
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate cryptographically secure UUID session ID
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    // Save session to database (server-side session store)
    await db.query(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
      [sessionId, user.id, expiresAt]
    );

    // Set secure, httpOnly, sameSite cookie
    res.cookie('tv_session', sessionId, getCookieOptions());

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Deletes session row from DB and clears httpOnly session cookie
 */
router.post('/logout', async (req, res) => {
  try {
    const sessionId = req.cookies?.tv_session;

    if (sessionId) {
      await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    }

    res.clearCookie('tv_session', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user details from DB
 */
router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      fullName: req.user.fullName,
      role: req.user.role,
      isActive: req.user.isActive,
      createdAt: req.user.createdAt
    }
  });
});

module.exports = router;
