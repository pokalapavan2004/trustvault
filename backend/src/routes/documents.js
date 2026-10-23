// src/routes/documents.js
// Document management routes with central authorization via src/auth/authorize.js

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { authorize, NotFoundError } = require('../auth/authorize');

const router = express.Router();

// UUID format validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Configure storage directory outside public access
const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// 10 MB maximum upload limit
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.docx', '.xlsx', '.csv', '.png', '.jpg', '.jpeg'];

// Allowed categories
const ALLOWED_CATEGORIES = ['General', 'Finance', 'HR', 'Legal', 'IT', 'Education', 'Personal'];

// Multer disk storage storing files under random UUIDs with no extension
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STORAGE_DIR),
  filename: (req, file, cb) => {
    const randomKey = crypto.randomUUID();
    cb(null, randomKey);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE }
});

/**
 * Validates file magic bytes against allowed formats
 * @param {string} filePath - Absolute path to stored file
 * @param {string} ext - Lowercase file extension with leading dot
 * @returns {boolean} True if magic bytes match extension
 */
function validateMagicBytes(filePath, ext) {
  const buffer = Buffer.alloc(512);
  const fd = fs.openSync(filePath, 'r');
  const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
  fs.closeSync(fd);

  if (bytesRead === 0) return false;

  switch (ext) {
    case '.pdf':
      return buffer.slice(0, 4).toString('ascii') === '%PDF';

    case '.png':
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );

    case '.jpg':
    case '.jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    case '.docx':
    case '.xlsx':
      return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;

    case '.txt':
    case '.csv':
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0x00) return false;
      }
      return true;

    default:
      return false;
  }
}

/**
 * POST /api/documents
 * Uploads a document and creates initial grants in ONE database transaction.
 */
router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'File is required' });
  }

  const filePath = req.file.path;

  const cleanupFile = () => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      console.error('Failed to cleanup uploaded file:', e.message);
    }
  };

  const { title, description, category, sharedWith } = req.body || {};

  // 1. Validate title
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    cleanupFile();
    return res.status(400).json({ error: 'Title is required' });
  }

  if (title.trim().length > 255) {
    cleanupFile();
    return res.status(400).json({ error: 'Title cannot exceed 255 characters' });
  }

  // 2. Validate category
  const selectedCategory = category ? category.trim() : 'General';
  if (!ALLOWED_CATEGORIES.includes(selectedCategory)) {
    cleanupFile();
    return res.status(400).json({
      error: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
    });
  }

  // 3. Validate file extension and magic bytes
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    cleanupFile();
    return res.status(400).json({
      error: `File type not allowed. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`
    });
  }

  if (!validateMagicBytes(filePath, ext)) {
    cleanupFile();
    return res.status(400).json({
      error: 'File content does not match the declared file extension'
    });
  }

  // 4. Parse sharedWith recipients
  let parsedShares = [];
  if (sharedWith) {
    try {
      parsedShares = typeof sharedWith === 'string' ? JSON.parse(sharedWith) : sharedWith;
      if (!Array.isArray(parsedShares)) {
        throw new Error('sharedWith must be an array');
      }
    } catch (err) {
      cleanupFile();
      return res.status(400).json({ error: 'sharedWith must be a valid JSON array of recipients' });
    }
  }

  // 5. Calculate file SHA256 checksum
  let sha256;
  try {
    const fileBuffer = fs.readFileSync(filePath);
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch (err) {
    cleanupFile();
    return res.status(500).json({ error: 'Failed to process uploaded file' });
  }

  // 6. Database Transaction: insert document and grants atomically
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Insert document record
    const insertDocQuery = `
      INSERT INTO documents (
        owner_id, title, description, category, original_filename,
        storage_key, mime_type, size_bytes, sha256
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, owner_id, title, description, category, original_filename, mime_type, size_bytes, sha256, created_at;
    `;

    const docResult = await client.query(insertDocQuery, [
      req.user.id,
      title.trim(),
      description && typeof description === 'string' ? description.trim() : null,
      selectedCategory,
      req.file.originalname,
      req.file.filename,
      req.file.mimetype || 'application/octet-stream',
      req.file.size,
      sha256
    ]);

    const createdDoc = docResult.rows[0];

    // Resolve and insert grants if provided
    if (parsedShares.length > 0) {
      for (const share of parsedShares) {
        if (!share.email || typeof share.email !== 'string' || !['read', 'edit'].includes(share.permission)) {
          await client.query('ROLLBACK');
          cleanupFile();
          return res.status(400).json({
            error: 'Each shared recipient must have a valid email and permission (read or edit)'
          });
        }
      }

      const shareMap = new Map();
      for (const share of parsedShares) {
        shareMap.set(share.email.trim().toLowerCase(), share.permission);
      }

      const targetEmails = Array.from(shareMap.keys());

      // Query database for target users (active users with role 'user', not the uploader)
      const usersQuery = `
        SELECT id, LOWER(email) AS email, role, is_active
        FROM users
        WHERE LOWER(email) = ANY($1::text[])
      `;
      const usersResult = await client.query(usersQuery, [targetEmails]);

      const validUsersMap = new Map();
      for (const u of usersResult.rows) {
        if (u.is_active && u.role === 'user' && u.id !== req.user.id) {
          validUsersMap.set(u.email, u.id);
        }
      }

      // Rollback if any recipient email is unknown or ineligible
      const unknownEmails = targetEmails.filter((email) => !validUsersMap.has(email));
      if (unknownEmails.length > 0) {
        await client.query('ROLLBACK');
        cleanupFile();
        return res.status(400).json({
          error: 'One or more recipient emails are invalid or unknown',
          unknownEmails
        });
      }

      // Insert grant for each recipient in the same transaction
      for (const [email, permission] of shareMap.entries()) {
        const recipientUserId = validUsersMap.get(email);
        await client.query(
          `INSERT INTO grants (document_id, user_id, permission, granted_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (document_id, user_id)
           DO UPDATE SET permission = EXCLUDED.permission`,
          [createdDoc.id, recipientUserId, permission, req.user.id]
        );
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Document uploaded successfully',
      document: createdDoc
    });
  } catch (err) {
    await client.query('ROLLBACK');
    cleanupFile();
    console.error('Document upload error:', err.message);
    return res.status(500).json({ error: 'Internal server error during document upload' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/documents
 * Supports scope=mine (owned), scope=shared (shared with caller), or default all.
 * Single SQL query filtering by grants and ownership.
 * Returns: is_owner (boolean), my_permission ('owner', 'read', 'edit'), owner_username.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const scope = (req.query.scope || 'all').toLowerCase();

    let whereScopeClause = '';
    const queryParams = [req.user.id];

    if (isAdmin) {
      if (scope === 'mine') {
        whereScopeClause = 'AND d.owner_id = $1';
      } else if (scope === 'shared') {
        whereScopeClause = 'AND g.id IS NOT NULL AND d.owner_id != $1';
      }
      // default 'all': admin sees all non-deleted metadata
    } else {
      if (scope === 'mine') {
        whereScopeClause = 'AND d.owner_id = $1';
      } else if (scope === 'shared') {
        whereScopeClause = 'AND g.id IS NOT NULL AND d.owner_id != $1';
      } else {
        // default 'all': owned OR shared with me
        whereScopeClause = 'AND (d.owner_id = $1 OR g.id IS NOT NULL)';
      }
    }

    const queryText = `
      SELECT 
        d.id,
        d.owner_id,
        u.username AS owner_username,
        u.email AS owner_email,
        d.title,
        d.description,
        d.category,
        d.original_filename,
        d.mime_type,
        d.size_bytes,
        d.sha256,
        d.created_at,
        (d.owner_id = $1) AS is_owner,
        CASE 
          WHEN d.owner_id = $1 THEN 'owner'
          WHEN g.permission IS NOT NULL THEN g.permission
          ELSE 'admin_view'
        END AS my_permission,
        COALESCE(grant_counts.cnt, 0)::int AS shared_count
      FROM documents d
      JOIN users u ON d.owner_id = u.id
      LEFT JOIN grants g ON g.document_id = d.id AND g.user_id = $1
      LEFT JOIN (
        SELECT document_id, COUNT(*) AS cnt
        FROM grants
        GROUP BY document_id
      ) grant_counts ON grant_counts.document_id = d.id
      WHERE d.deleted_at IS NULL
        ${whereScopeClause}
      ORDER BY d.created_at DESC;
    `;

    const result = await db.query(queryText, queryParams);

    return res.status(200).json({
      documents: result.rows
    });
  } catch (err) {
    console.error('GET /api/documents error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/documents/:id
 * Retrieves document metadata. Calls authorize first before any work.
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    // Central authorization check: called first before any work
    const doc = await authorize(req.user, req.params.id, 'view_metadata');

    return res.status(200).json({
      document: {
        id: doc.id,
        owner_id: doc.owner_id,
        title: doc.title,
        description: doc.description,
        category: doc.category,
        original_filename: doc.original_filename,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        sha256: doc.sha256,
        created_at: doc.created_at,
        grant_permission: doc.grant_permission
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/:id/download
 * Downloads document file contents. Calls authorize first before any work.
 */
router.get('/:id/download', requireAuth, async (req, res, next) => {
  try {
    // Central authorization check: called first before any work
    const doc = await authorize(req.user, req.params.id, 'download');

    const filePath = path.join(STORAGE_DIR, doc.storage_key);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundError();
    }

    const sanitisedFilename = path.basename(doc.original_filename).replace(/["\r\n\/\\]/g, '_');

    res.setHeader('Content-Disposition', `attachment; filename="${sanitisedFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      console.error('File streaming error:', streamErr.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });

    return stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/documents/:id
 * Updates document title, description, or category. Calls authorize first before any work.
 */
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    // Central authorization check: called first before any work
    await authorize(req.user, req.params.id, 'edit');

    const { title, description, category } = req.body || {};

    if (title === undefined && description === undefined && category === undefined) {
      return res.status(400).json({
        error: 'At least one field (title, description, category) must be provided'
      });
    }

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      if (title.trim().length > 255) {
        return res.status(400).json({ error: 'Title cannot exceed 255 characters' });
      }
      updates.push(`title = $${paramIndex++}`);
      params.push(title.trim());
    }

    if (description !== undefined) {
      if (description !== null && typeof description !== 'string') {
        return res.status(400).json({ error: 'Description must be a string or null' });
      }
      updates.push(`description = $${paramIndex++}`);
      params.push(typeof description === 'string' ? description.trim() : null);
    }

    if (category !== undefined) {
      if (!ALLOWED_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`
        });
      }
      updates.push(`category = $${paramIndex++}`);
      params.push(category);
    }

    params.push(req.params.id);
    const updateQuery = `
      UPDATE documents
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND deleted_at IS NULL
      RETURNING id, owner_id, title, description, category, original_filename, mime_type, size_bytes, sha256, created_at;
    `;

    const result = await db.query(updateQuery, params);

    return res.status(200).json({
      document: result.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/documents/:id
 * Soft deletes document (owner or admin). Calls authorize first before any work.
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    // Central authorization check: called first before any work
    await authorize(req.user, req.params.id, 'delete');

    await db.query('UPDATE documents SET deleted_at = NOW() WHERE id = $1', [req.params.id]);

    return res.status(200).json({
      message: 'Document deleted successfully'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/:id/grants
 * Lists current document grants (owner or admin). Calls authorize first before any work.
 */
router.get('/:id/grants', requireAuth, async (req, res, next) => {
  try {
    // Central authorization check: called first before any work
    await authorize(req.user, req.params.id, 'list_grants');

    const result = await db.query(
      `SELECT 
        g.id,
        g.user_id,
        g.permission,
        g.created_at,
        u.username,
        u.email
       FROM grants g
       JOIN users u ON g.user_id = u.id
       WHERE g.document_id = $1
       ORDER BY g.created_at ASC`,
      [req.params.id]
    );

    return res.status(200).json({
      grants: result.rows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/:id/grants
 * Adds or updates a document grant (owner only). Calls authorize first before any work.
 */
router.post('/:id/grants', requireAuth, async (req, res, next) => {
  try {
    // Central authorization check: called first before any work
    const doc = await authorize(req.user, req.params.id, 'share');

    const { email, permission } = req.body || {};

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }

    if (!permission || !['read', 'edit'].includes(permission)) {
      return res.status(400).json({ error: 'Permission must be either "read" or "edit"' });
    }

    const normalisedEmail = email.trim().toLowerCase();

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Resolve email to active user with role 'user', not the owner
      const userRes = await client.query(
        'SELECT id, username, LOWER(email) AS email, role, is_active FROM users WHERE LOWER(email) = LOWER($1)',
        [normalisedEmail]
      );

      if (userRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `User with email "${normalisedEmail}" was not found.` });
      }

      const targetUser = userRes.rows[0];

      if (!targetUser.is_active) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot grant access to an inactive user account.' });
      }

      if (targetUser.role !== 'user') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Grants can only be extended to regular user accounts.' });
      }

      if (targetUser.id === doc.owner_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Document owner already has full access.' });
      }

      // Upsert grant
      const grantRes = await client.query(
        `INSERT INTO grants (document_id, user_id, permission, granted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, user_id)
         DO UPDATE SET permission = EXCLUDED.permission
         RETURNING id, document_id, user_id, permission, created_at`,
        [doc.id, targetUser.id, permission, req.user.id]
      );

      await client.query('COMMIT');

      return res.status(200).json({
        message: 'Grant updated successfully',
        grant: {
          ...grantRes.rows[0],
          username: targetUser.username,
          email: targetUser.email
        }
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/documents/:id/grants/:userId
 * Revokes a document grant (owner or admin). Calls authorize first before any work.
 */
router.delete('/:id/grants/:userId', requireAuth, async (req, res, next) => {
  try {
    // Central authorization check: called first before any work
    await authorize(req.user, req.params.id, 'revoke');

    if (!UUID_REGEX.test(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const delRes = await client.query(
        'DELETE FROM grants WHERE document_id = $1 AND user_id = $2 RETURNING id',
        [req.params.id, req.params.userId]
      );

      if (delRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Grant not found' });
      }

      await client.query('COMMIT');

      return res.status(200).json({
        message: 'Grant revoked successfully'
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
