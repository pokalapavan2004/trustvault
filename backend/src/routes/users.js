// src/routes/users.js
// User management endpoints for administrators

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Middleware to restrict access strictly to administrators
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied: administrator privileges required' });
  }
  next();
}

/**
 * GET /api/users
 * Returns list of all user accounts for admin console
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, email, full_name, role, is_active, created_at
       FROM users
       ORDER BY created_at ASC`
    );

    return res.status(200).json({
      users: result.rows
    });
  } catch (err) {
    console.error('GET /api/users error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/users/:id/status
 * Enables or disables a user account (admin only).
 * Disabling immediately revokes and terminates all server-side sessions.
 */
router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { is_active } = req.body || {};

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active boolean is required' });
  }

  // Prevent admin from disabling their own account
  if (req.params.id === req.user.id && !is_active) {
    return res.status(400).json({ error: 'Administrators cannot disable their own account' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, username, email, full_name, role, is_active`,
      [is_active, req.params.id]
    );

    if (updateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    // Invalidate sessions immediately if user is disabled (Security Invariant 4)
    if (!is_active) {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: `User account has been ${is_active ? 'enabled' : 'disabled'}`,
      user: updateRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/users/:id/status error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
