// src/routes/audit.js
// Admin-only activity and audit trail endpoints (Security Invariant 6)

const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

/**
 * GET /api/activity-logs
 * Retrieves immutable audit log entries.
 * Restricted strictly to admins; returns 404 to non-admins.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    // Invariant: Only admin can view audit/activity logs; return 404 to avoid role/existence leakage
    if (req.user.role !== 'admin') {
      return res.status(404).json({ error: 'Not found' });
    }

    const { status, limit = 50, offset = 0 } = req.query;

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    let whereClause = '';
    const params = [parsedLimit, parsedOffset];

    if (status === 'allowed') {
      whereClause = 'WHERE allowed = true';
    } else if (status === 'denied') {
      whereClause = 'WHERE allowed = false';
    }

    const queryText = `
      SELECT 
        id,
        user_id,
        username,
        user_email,
        document_id,
        document_title,
        action,
        allowed,
        reason,
        previous_hash,
        hash,
        created_at
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2;
    `;

    const countQuery = `
      SELECT 
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE allowed = true)::int AS allowed_count,
        COUNT(*) FILTER (WHERE allowed = false)::int AS denied_count
      FROM audit_logs;
    `;

    const [logsResult, countResult] = await Promise.all([
      db.query(queryText, params),
      db.query(countQuery)
    ]);

    return res.status(200).json({
      logs: logsResult.rows,
      counts: countResult.rows[0] || { total_count: 0, allowed_count: 0, denied_count: 0 }
    });
  } catch (err) {
    console.error('Error fetching activity logs:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
