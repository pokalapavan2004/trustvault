// src/routes/profile.js
// Profile management routes: GET profile, PATCH profile, POST change-password

const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
const SALT_ROUNDS = 12;

// Username pattern: 3 to 30 characters, letters, digits, and underscores only
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

/**
 * GET /api/profile
 * Returns authenticated user's own profile: id, username, email, full_name, role, created_at
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, email, full_name, role, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    return res.status(200).json({
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      created_at: user.created_at
    });
  } catch (err) {
    console.error('GET /api/profile error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/profile
 * Updates only username and full_name. Ignores all other fields.
 */
router.patch('/', requireAuth, async (req, res) => {
  const { username, full_name } = req.body || {};

  if (username === undefined && full_name === undefined) {
    return res.status(400).json({ error: 'At least one field (username or full_name) must be provided' });
  }

  const updates = [];
  const params = [];
  let paramIndex = 1;

  // Validate and prepare username update if provided
  if (username !== undefined) {
    if (typeof username !== 'string') {
      return res.status(400).json({ error: 'Username must be a string' });
    }

    const cleanUsername = username.trim();

    if (!USERNAME_REGEX.test(cleanUsername)) {
      return res.status(400).json({
        error: 'Username must be between 3 and 30 characters and contain only letters, numbers, and underscores'
      });
    }

    // Check case-insensitive uniqueness against other users
    const duplicateCheck = await db.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2',
      [cleanUsername, req.user.id]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Username already in use' });
    }

    updates.push(`username = $${paramIndex++}`);
    params.push(cleanUsername);
  }

  // Validate and prepare full_name update if provided
  if (full_name !== undefined) {
    if (full_name !== null && typeof full_name !== 'string') {
      return res.status(400).json({ error: 'Full name must be a string or null' });
    }

    const cleanFullName = typeof full_name === 'string' ? full_name.trim() : null;

    if (cleanFullName && cleanFullName.length > 100) {
      return res.status(400).json({ error: 'Full name must not exceed 100 characters' });
    }

    updates.push(`full_name = $${paramIndex++}`);
    params.push(cleanFullName || null);
  }

  try {
    params.push(req.user.id);
    const updateQuery = `
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, username, email, full_name, role, created_at;
    `;

    const result = await db.query(updateQuery, params);
    const updatedUser = result.rows[0];

    return res.status(200).json({
      id: updatedUser.id,
      username: updatedUser.username,
      email: updatedUser.email,
      full_name: updatedUser.full_name,
      role: updatedUser.role,
      created_at: updatedUser.created_at
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already in use' });
    }

    console.error('PATCH /api/profile error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/profile/password
 * Changes user password. Verifies currentPassword, updates password_hash,
 * and deletes all OTHER sessions of that user.
 */
router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};

  // Check required inputs
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({
      error: 'currentPassword, newPassword, and confirmPassword are required'
    });
  }

  if (
    typeof currentPassword !== 'string' ||
    typeof newPassword !== 'string' ||
    typeof confirmPassword !== 'string'
  ) {
    return res.status(400).json({ error: 'Invalid password format' });
  }

  // Validate new password complexity: at least 10 chars, letter and number
  if (newPassword.length < 10 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({
      error: 'New password must be at least 10 characters long and include at least one letter and one number'
    });
  }

  // Validate confirmation matches
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirm password do not match' });
  }

  try {
    // Fetch current user password hash
    const userResult = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password_hash } = userResult.rows[0];

    // Verify current password
    const isCurrentValid = await bcrypt.compare(currentPassword, password_hash);
    if (!isCurrentValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password in database
    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, req.user.id]
    );

    // Delete all OTHER sessions of this user (keep current session active)
    await db.query(
      'DELETE FROM sessions WHERE user_id = $1 AND id != $2',
      [req.user.id, req.session.id]
    );

    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('POST /api/profile/password error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
