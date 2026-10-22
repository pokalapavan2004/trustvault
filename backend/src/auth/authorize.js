// src/auth/authorize.js
// Single point of authorization for all document access (AGENTS.md Invariant 1)

const db = require('../db');

/**
 * Checks if a user is authorized to perform an action on a document.
 * Returns the document row if authorized. Throws 404 if unauthorized or document not found
 * to prevent existence leakage (AGENTS.md Invariant 2).
 *
 * @param {Object} user - Authenticated user object from req.user
 * @param {string} documentId - UUID of the document
 * @param {string} action - 'read' | 'download' | 'preview' | 'edit' | 'delete' | 'share' | 'versions'
 * @returns {Promise<Object>} Document object if authorized
 */
async function authorize(user, documentId, action) {
  if (!user || !user.id || !documentId) {
    const error = new Error('Document not found');
    error.status = 404;
    throw error;
  }

  // 1. Fetch document (ignoring soft-deleted documents)
  const docResult = await db.query(
    'SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL',
    [documentId]
  );

  if (docResult.rows.length === 0) {
    const error = new Error('Document not found');
    error.status = 404;
    throw error;
  }

  const document = docResult.rows[0];

  // 2. Document owner has full access
  if (document.owner_id === user.id) {
    return document;
  }

  // 3. Admin has read and audit oversight (or full management)
  if (user.role === 'admin') {
    return document;
  }

  // 4. Check explicit grants in DB (no caching - AGENTS.md Invariant 4)
  const grantResult = await db.query(
    'SELECT permission FROM grants WHERE document_id = $1 AND user_id = $2',
    [documentId, user.id]
  );

  if (grantResult.rows.length > 0) {
    const permission = grantResult.rows[0].permission;

    if (permission === 'edit') {
      // Edit grant allows read, preview, download, edit, and viewing versions
      if (['read', 'preview', 'download', 'edit', 'versions'].includes(action)) {
        return document;
      }
    } else if (permission === 'read') {
      // Read grant allows read, preview, and download
      if (['read', 'preview', 'download'].includes(action)) {
        return document;
      }
    }
  }

  // AGENTS.md Invariant 2: Return 404 (not 403) for documents the user cannot access
  const error = new Error('Document not found');
  error.status = 404;
  throw error;
}

module.exports = {
  authorize
};
