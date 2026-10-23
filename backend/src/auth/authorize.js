// src/auth/authorize.js
// Central authorization check for document access across all routes.
// Security invariant 1: The server decides every access. There is ONE function,
// authorize(user, documentId, action), in src/auth/authorize.js.
// Security invariant 2: Return 404 (not 403) for documents the user cannot access,
// so existence is not leaked.

const crypto = require('crypto');
const db = require('../db');

// UUID format validation regex (matches RFC 4122 v1-v5 UUIDs)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// Custom NotFoundError ensuring uniform 404 responses without leaking document existence
class NotFoundError extends Error {
  constructor(message = 'Document not found') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

/**
 * Records an access attempt (both authorized and unauthorized) into the immutable audit_logs table
 * using a cryptographic hash chain (Invariant 6).
 */
async function recordAuditAttempt({ user, documentId, documentTitle, action, allowed, reason }) {
  try {
    // 1. Fetch latest audit log row to retrieve previous_hash
    const lastRowRes = await db.query(
      'SELECT hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1'
    );
    const prevHash = lastRowRes.rows.length > 0 ? lastRowRes.rows[0].hash : GENESIS_HASH;

    const createdAt = new Date().toISOString();
    const userId = user?.id || null;
    const username = user?.username || 'unknown';
    const userEmail = user?.email || null;
    const docId = (documentId && UUID_REGEX.test(documentId)) ? documentId : null;
    const docTitle = documentTitle || null;

    // 2. Canonical payload for cryptographic chaining:
    // previous_hash|user_id|doc_id|action|allowed|reason|created_at
    const canonicalPayload = [
      prevHash,
      userId || 'none',
      docId || 'none',
      action,
      allowed ? 'true' : 'false',
      reason,
      createdAt
    ].join('|');

    const rowHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    // 3. Insert into audit_logs table
    await db.query(
      `INSERT INTO audit_logs (
        user_id, username, user_email, document_id, document_title,
        action, allowed, reason, previous_hash, hash, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        userId,
        username,
        userEmail,
        docId,
        docTitle,
        action,
        allowed,
        reason,
        prevHash,
        rowHash,
        createdAt
      ]
    );
  } catch (err) {
    console.error('Audit log recording error:', err.message);
  }
}

/**
 * Authorizes a user to perform an action on a specific document.
 * 
 * Rules:
 * - document owner (documents.owner_id = user.id): all actions
 * - grant 'read': view_metadata, download
 * - grant 'edit': view_metadata, download, edit
 * - delete (soft delete): owner OR admin
 * - share (add or change a grant): owner only
 * - revoke (remove a grant): owner OR admin
 * - list_grants (see who has access): owner OR admin
 * - download and edit: unchanged. Admin never gets download or edit.
 * - admin (not owner, no grant): view_metadata, delete, revoke, list_grants only.
 *   Admin can only narrow access, never grant access or read file contents.
 * - deleted documents: denied for everyone
 * - everything else: denied
 *
 * @param {Object} user - Authenticated user object from req.user ({ id, role, email, ... })
 * @param {string} documentId - UUID of the target document
 * @param {'view_metadata'|'download'|'edit'|'delete'|'share'|'revoke'|'list_grants'} action - Requested action
 * @returns {Promise<Object>} The document record from database on success
 * @throws {NotFoundError} On missing document, invalid UUID, deleted doc, or authorization failure
 */
async function authorize(user, documentId, action) {
  // 1. Validate UUID format before querying the database
  if (!documentId || typeof documentId !== 'string' || !UUID_REGEX.test(documentId)) {
    await recordAuditAttempt({ user, documentId, action, allowed: false, reason: 'INVALID_UUID' });
    throw new NotFoundError();
  }

  // 2. Load document and explicit grant for this user from database on every request (no caching)
  const result = await db.query(
    `SELECT 
      d.id,
      d.owner_id,
      d.title,
      d.description,
      d.category,
      d.original_filename,
      d.storage_key,
      d.mime_type,
      d.size_bytes,
      d.sha256,
      d.created_at,
      d.deleted_at,
      g.permission AS grant_permission
     FROM documents d
     LEFT JOIN grants g ON g.document_id = d.id AND g.user_id = $2
     WHERE d.id = $1`,
    [documentId, user.id]
  );

  // Missing document: throw 404
  if (result.rows.length === 0) {
    await recordAuditAttempt({ user, documentId, action, allowed: false, reason: 'NOT_FOUND' });
    throw new NotFoundError();
  }

  const document = result.rows[0];

  // 3. Deleted documents: denied for everyone
  if (document.deleted_at !== null) {
    await recordAuditAttempt({
      user,
      documentId,
      documentTitle: document.title,
      action,
      allowed: false,
      reason: 'DELETED'
    });
    throw new NotFoundError();
  }

  const isOwner = document.owner_id === user.id;
  const grant = document.grant_permission; // 'read', 'edit', or null
  const isAdmin = user.role === 'admin';

  let allowed = false;

  // 4. Access rules evaluation
  if (isOwner) {
    // Document owner has full access to all actions
    allowed = true;
  } else {
    switch (action) {
      case 'share':
        // Share (add or change a grant): owner only. Admin can never grant access.
        allowed = false;
        break;

      case 'revoke':
        // Revoke (remove a grant): owner OR admin
        allowed = isAdmin;
        break;

      case 'list_grants':
        // List grants: owner OR admin
        allowed = isAdmin;
        break;

      case 'delete':
        // Delete: owner OR admin
        allowed = isAdmin;
        break;

      case 'edit':
        // Edit: grant 'edit' only. Admin never gets edit.
        allowed = (grant === 'edit');
        break;

      case 'download':
        // Download: grant 'read' or grant 'edit'. Admin never gets download.
        allowed = (grant === 'read' || grant === 'edit');
        break;

      case 'view_metadata':
        // View metadata: grant holders OR admin
        allowed = (Boolean(grant) || isAdmin);
        break;

      default:
        allowed = false;
        break;
    }
  }

  if (!allowed) {
    await recordAuditAttempt({
      user,
      documentId,
      documentTitle: document.title,
      action,
      allowed: false,
      reason: 'PERMISSION_DENIED'
    });
    throw new NotFoundError();
  }

  // Access granted: record audit and return document
  await recordAuditAttempt({
    user,
    documentId,
    documentTitle: document.title,
    action,
    allowed: true,
    reason: 'AUTHORIZED'
  });
  return document;
}

module.exports = {
  authorize,
  recordAuditAttempt,
  NotFoundError
};

