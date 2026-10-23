// src/routes/auth.js
// Authentication routes: login, logout, and me

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { loginRateLimiter } = require('../middleware/rateLimiter');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Helper to configure session cookie options
const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_DURATION_MS,
  path: '/'
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
      'SELECT id, email, password_hash, role, is_active FROM users WHERE LOWER(email) = LOWER($1)',
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
        email: user.email,
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
      email: req.user.email,
      role: req.user.role,
      isActive: req.user.isActive,
      createdAt: req.user.createdAt
    }
  });
});

module.exports = router;
