// src/middleware/requireAuth.js
// Loads user and session from the DB on every request. Rejects and cleans up disabled users.

const db = require('../db');

async function requireAuth(req, res, next) {
  try {
    // Read session ID from httpOnly cookie or Authorization Bearer header
    const sessionId = req.cookies?.tv_session || 
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

    if (!sessionId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Query DB for session and user details on every request (no caching)
    const result = await db.query(
      `SELECT 
        s.id AS session_id,
        s.expires_at,
        u.id AS user_id,
        u.email,
        u.role,
        u.is_active,
        u.created_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      res.clearCookie('tv_session', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    const row = result.rows[0];

    // Check session expiry
    if (new Date(row.expires_at) <= new Date()) {
      await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      res.clearCookie('tv_session', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
      return res.status(401).json({ error: 'Session has expired' });
    }

    // Check if user is disabled - invalidate sessions immediately
    if (!row.is_active) {
      await db.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
      res.clearCookie('tv_session', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
      return res.status(403).json({ error: 'Account is disabled' });
    }

    // Attach trusted user and session info from DB
    req.user = {
      id: row.user_id,
      email: row.email,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at
    };

    req.session = {
      id: row.session_id,
      expiresAt: row.expires_at
    };

    next();
  } catch (err) {
    console.error('requireAuth middleware error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = requireAuth;
