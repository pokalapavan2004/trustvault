// src/routes/admin.js
// Admin-only management endpoints: Users and Audit Verification
// Security Invariant: Non-admins receive uniform 404 (same body as unknown routes)

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { recordAudit, verifyAuditChain, GENESIS_HASH } = require('../audit/record');

const router = express.Router();

// UUID format validation regex (matches RFC 4122 v1-v5 UUIDs)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Admin guard middleware:
 * Ensures the requester is authenticated and has role 'admin'.
 * Any non-admin or unauthenticated requester receives 404 with { error: 'Endpoint not found' }
 * exactly matching undefined route behavior to prevent route enumeration (Requirement A.3).
 */
async function requireAdmin(req, res, next) {
  const sessionId = req.cookies?.tv_session;
  if (!sessionId || typeof sessionId !== 'string' || !UUID_REGEX.test(sessionId)) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }

  try {
    const result = await db.query(
      `SELECT 
         s.id AS session_id,
         s.expires_at,
         u.id AS user_id,
         u.username,
         u.email,
         u.role,
         u.is_active
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    const row = result.rows[0];

    // Check expiration, account active status, and role
    if (new Date(row.expires_at) <= new Date() || !row.is_active || row.role !== 'admin') {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    req.user = {
      id: row.user_id,
      username: row.username,
      email: row.email,
      role: row.role,
      isActive: row.is_active
    };

    req.session = {
      id: row.session_id,
      expiresAt: row.expires_at
    };

    next();
  } catch (err) {
    console.error('requireAdmin guard error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Apply requireAdmin to all /api/admin routes
router.use(requireAdmin);

/**
 * GET /api/admin/users
 * Admin only, paginated (default 20).
 * Returns id, username, email, role, is_active, created_at, and count of documents owned.
 * Never returns password_hash or session data (Requirement A.1).
 */
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const countResult = await db.query('SELECT COUNT(*)::int AS total FROM users');
    const total = countResult.rows[0]?.total || 0;

    const usersResult = await db.query(
      `SELECT 
         u.id,
         u.username,
         u.email,
         u.role,
         u.is_active,
         u.created_at,
         COUNT(d.id)::int AS documents_count
       FROM users u
       LEFT JOIN documents d ON d.owner_id = u.id AND d.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY u.created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const users = usersResult.rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      is_active: row.is_active,
      created_at: row.created_at,
      documents_count: row.documents_count,
      documents_owned: row.documents_count
    }));

    return res.status(200).json({
      users,
      total,
      page,
      limit
    });
  } catch (err) {
    console.error('GET /api/admin/users error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 * Enables or disables a user account (admin only).
 * Body: { isActive: true|false }
 * 
 * Rules (Requirement A.2):
 * - an admin cannot disable their own account
 * - an admin account cannot be disabled by this endpoint
 * - role can never be changed through any endpoint
 * - disabling sets is_active=false AND deletes every session of that user in the SAME transaction
 * - enabling sets is_active=true
 * - each change writes an audit row (user_disabled or user_enabled, actor = admin, target user id in details) in same transaction
 * - unknown or invalid id returns 404
 */
router.patch('/users/:id/status', async (req, res) => {
  const { isActive } = req.body || {};

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive boolean is required' });
  }

  const targetId = req.params.id;

  // Validate UUID format; invalid UUID returns 404 to avoid leaking DB syntax errors
  if (!targetId || typeof targetId !== 'string' || !UUID_REGEX.test(targetId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent an admin from disabling their own account
  if (targetId === req.user.id && !isActive) {
    return res.status(400).json({ error: 'Administrators cannot disable their own account' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Retrieve target user with row-level lock
    const userResult = await client.query(
      'SELECT id, username, email, role, is_active FROM users WHERE id = $1 FOR UPDATE',
      [targetId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = userResult.rows[0];

    // Rule: An admin account cannot be disabled by this endpoint
    if (targetUser.role === 'admin' && !isActive) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Administrator accounts cannot be disabled' });
    }

    // Update is_active only (role is never altered)
    const updateResult = await client.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2
       RETURNING id, username, email, role, is_active, created_at`,
      [isActive, targetId]
    );

    // If disabling, delete all sessions for that user in the SAME transaction
    if (!isActive) {
      await client.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
    }

    // Write audit row in the SAME transaction (Requirement A.2 & B.4)
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
      user: {
        id: updateResult.rows[0].id,
        username: updateResult.rows[0].username,
        email: updateResult.rows[0].email,
        role: updateResult.rows[0].role,
        is_active: updateResult.rows[0].is_active,
        created_at: updateResult.rows[0].created_at
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/admin/users/:id/status error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/admin/audit/head
 * Returns { id, hash } of the latest row in the audit log (Requirement B.5).
 */
router.get('/audit/head', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, hash FROM audit_logs ORDER BY id DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ id: null, hash: GENESIS_HASH });
    }

    return res.status(200).json({
      id: result.rows[0].id,
      hash: result.rows[0].hash
    });
  } catch (err) {
    console.error('GET /api/admin/audit/head error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/audit/verify
 * Recomputes the entire audit log hash chain and validates that row IDs are contiguous (Requirement B.5).
 * Returns { ok: true, rows, headHash } or { ok: false, brokenId: ... }
 */
router.get('/audit/verify', async (req, res) => {
  try {
    const verification = await verifyAuditChain();
    return res.status(200).json(verification);
  } catch (err) {
    console.error('GET /api/admin/audit/verify error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
