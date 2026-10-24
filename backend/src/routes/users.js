// src/routes/users.js
// User management endpoints for administrators

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const { recordAudit } = require('../audit/record');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Middleware to restrict access strictly to administrators
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied: administrator privileges required' });
  }
  next();
}

/**
 * GET /api/users
 * Returns list of user accounts with documents count for admin console
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
         u.id, 
         u.username, 
         u.email, 
         u.full_name, 
         u.role, 
         u.is_active, 
         u.created_at,
         COUNT(d.id)::int AS documents_count,
         COUNT(d.id)::int AS documents_owned
       FROM users u
       LEFT JOIN documents d ON d.owner_id = u.id AND d.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY u.created_at ASC`
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
 */
router.patch('/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const isActive = req.body.isActive !== undefined ? req.body.isActive : req.body.is_active;

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive boolean is required' });
  }

  if (!UUID_REGEX.test(req.params.id)) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent admin from disabling their own account
  if (req.params.id === req.user.id && !isActive) {
    return res.status(400).json({ error: 'Administrators cannot disable their own account' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const userCheck = await client.query(
      'SELECT id, username, email, role, is_active FROM users WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userCheck.rows[0];

    if (targetUser.role === 'admin' && !isActive) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Administrator accounts cannot be disabled' });
    }

    const updateRes = await client.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, username, email, full_name, role, is_active`,
      [isActive, req.params.id]
    );

    // Invalidate sessions immediately if user is disabled
    if (!isActive) {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    }

    const action = isActive ? 'user_enabled' : 'user_disabled';
    await recordAudit({
      client,
      actor: req.user.username,
      action,
      result: action,
      ip: req.ip || req.socket?.remoteAddress || null,
      details: {
        target_user_id: targetUser.id,
        target_username: targetUser.username
      },
      user_id: req.user.id,
      username: req.user.username,
      user_email: req.user.email,
      allowed: true,
      reason: action
    });

    await client.query('COMMIT');

    return res.status(200).json({
      message: `User account has been ${isActive ? 'enabled' : 'disabled'}`,
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
