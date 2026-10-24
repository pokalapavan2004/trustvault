// src/audit/record.js
// Append-only, hash-chained audit logging with tamper detection (Security Invariant 6)

const crypto = require('crypto');
const db = require('../db');

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const ADVISORY_LOCK_ID = 74839201; // Constant key for pg_advisory_xact_lock

/**
 * Strips ASCII control characters (0x00-0x1F, 0x7F) including newlines (\r, \n, \t)
 * and truncates to maxLength.
 */
function sanitizeString(str, maxLength = 255) {
  if (typeof str !== 'string') return str;
  return str.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Sanitizes details object:
 * Removes sensitive fields (passwords, session ids, tokens, raw file contents)
 * and strips control characters from string values.
 */
function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') return null;
  if (Array.isArray(details)) {
    return details.map(item => (typeof item === 'string' ? sanitizeString(item, 500) : sanitizeDetails(item)));
  }

  const clean = {};
  const blockedKeys = ['password', 'password_hash', 'session', 'tv_session', 'token', 'secret', 'content', 'buffer', 'file_content'];

  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    if (blockedKeys.some(blocked => lowerKey.includes(blocked))) {
      continue; // Never store passwords, session ids, or file contents
    }

    if (typeof value === 'string') {
      clean[key] = sanitizeString(value, 500);
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeDetails(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Recursively sorts object keys alphabetically to ensure deterministic canonical JSON.
 */
function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys(obj[key]);
  }
  return sorted;
}

/**
 * Canonical JSON serialization with fixed key order:
 * created_at, actor, action, document_id, result, ip, details
 */
function canonicalizeFields(fields) {
  const createdAtStr = fields.created_at instanceof Date
    ? fields.created_at.toISOString()
    : String(fields.created_at);

  const obj = {
    created_at: createdAtStr,
    actor: fields.actor !== null && fields.actor !== undefined ? String(fields.actor) : null,
    action: fields.action !== null && fields.action !== undefined ? String(fields.action) : null,
    document_id: fields.document_id !== null && fields.document_id !== undefined ? String(fields.document_id) : null,
    result: fields.result !== null && fields.result !== undefined ? String(fields.result) : null,
    ip: fields.ip !== null && fields.ip !== undefined ? String(fields.ip) : null,
    details: fields.details !== undefined && fields.details !== null ? sortObjectKeys(fields.details) : null
  };

  return JSON.stringify(obj);
}

/**
 * Computes the SHA-256 hash for an audit log entry.
 * ALL row hash computation for the audit chain MUST call this function.
 * 
 * @param {string} prevHash - 64-character SHA-256 hex string or 64 zeros
 * @param {Object} fields - Row fields { created_at, actor, action, document_id, result, ip, details }
 * @returns {string} 64-character SHA-256 hex digest
 */
function computeAuditHash(prevHash, fields) {
  const canonicalJson = canonicalizeFields(fields);
  return crypto.createHash('sha256').update((prevHash || GENESIS_HASH) + canonicalJson).digest('hex');
}

/**
 * Records an audit row in the database.
 * If client (transaction) is provided, participates in the same transaction.
 * Takes pg_advisory_xact_lock to prevent concurrent forks in the hash chain.
 */
async function recordAudit({
  client = null,
  actor,
  action,
  document_id = null,
  result,
  ip = null,
  details = null,
  user_id = null,
  username = null,
  user_email = null,
  document_title = null,
  allowed = null,
  reason = null,
  created_at = null
}) {
  const dbClient = client || (await db.pool.connect());
  const isOwnClient = !client;

  try {
    if (isOwnClient) {
      await dbClient.query('BEGIN');
    }

    // Take advisory transaction lock before reading previous hash to prevent chain forks
    await dbClient.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_ID]);

    // Read the previous hash from the latest row
    const lastRowRes = await dbClient.query(
      'SELECT id, hash FROM audit_logs ORDER BY id DESC LIMIT 1'
    );
    const prevHash = lastRowRes.rows.length > 0 ? lastRowRes.rows[0].hash : GENESIS_HASH;

    const rowCreatedAt = created_at || new Date().toISOString();

    // Strip control characters and newlines, truncate fields
    const cleanActor = sanitizeString(actor || username || user_email || 'anonymous', 255);
    const cleanAction = sanitizeString(action, 50);
    const cleanResult = sanitizeString(result || reason || (allowed ? 'AUTHORIZED' : 'DENIED'), 50);
    const cleanIp = sanitizeString(ip, 100);
    const cleanDetails = sanitizeDetails(details);
    const cleanDocTitle = sanitizeString(document_title, 255);
    const cleanUsername = sanitizeString(username, 100);
    const cleanUserEmail = sanitizeString(user_email, 255);

    const hashFields = {
      created_at: rowCreatedAt,
      actor: cleanActor,
      action: cleanAction,
      document_id: document_id || null,
      result: cleanResult,
      ip: cleanIp || null,
      details: cleanDetails
    };

    const rowHash = computeAuditHash(prevHash, hashFields);

    const isAllowed = allowed !== null
      ? Boolean(allowed)
      : (cleanResult === 'AUTHORIZED' || cleanResult === 'ALLOWED' || cleanResult === 'user_enabled' || cleanResult === 'user_disabled');

    const insertRes = await dbClient.query(
      `INSERT INTO audit_logs (
        actor, action, document_id, result, ip, details,
        prev_hash, hash, created_at,
        user_id, username, user_email, document_title, allowed, reason, previous_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, hash, prev_hash, created_at`,
      [
        cleanActor,
        cleanAction,
        document_id || null,
        cleanResult,
        cleanIp || null,
        cleanDetails ? JSON.stringify(cleanDetails) : null,
        prevHash,
        rowHash,
        rowCreatedAt,
        user_id || null,
        cleanUsername || null,
        cleanUserEmail || null,
        cleanDocTitle || null,
        isAllowed,
        cleanResult,
        prevHash
      ]
    );

    if (isOwnClient) {
      await dbClient.query('COMMIT');
    }

    return insertRes.rows[0];
  } catch (err) {
    if (isOwnClient) {
      await dbClient.query('ROLLBACK');
    }
    console.error('Audit log recording error:', err.message);
    throw err;
  } finally {
    if (isOwnClient) {
      dbClient.release();
    }
  }
}

/**
 * Recomputes the entire audit log chain, verifies hash links and contiguous IDs.
 * Returns { ok: true, rows, headHash } or { ok: false, brokenId }.
 */
async function verifyAuditChain() {
  const result = await db.query(
    `SELECT 
       id, actor, action, document_id, result, ip, details, 
       prev_hash, previous_hash, hash, created_at 
     FROM audit_logs 
     ORDER BY id ASC`
  );

  const rows = result.rows;
  if (rows.length === 0) {
    return { ok: true, rows: 0, headHash: GENESIS_HASH };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowId = Number(row.id);

    // Verify contiguous IDs
    if (i > 0) {
      const prevRowId = Number(rows[i - 1].id);
      if (rowId !== prevRowId + 1) {
        return { ok: false, brokenId: row.id, reason: 'ID sequence gap detected' };
      }
    }

    const rowPrevHash = row.prev_hash || row.previous_hash;
    if (rowPrevHash !== expectedPrevHash) {
      return { ok: false, brokenId: row.id, reason: 'Previous hash mismatch' };
    }

    // Recompute hash using computeAuditHash
    const hashFields = {
      created_at: row.created_at,
      actor: row.actor,
      action: row.action,
      document_id: row.document_id,
      result: row.result,
      ip: row.ip,
      details: row.details
    };

    const recomputedHash = computeAuditHash(rowPrevHash, hashFields);
    if (row.hash !== recomputedHash) {
      return { ok: false, brokenId: row.id, reason: 'Computed hash mismatch' };
    }

    expectedPrevHash = row.hash;
  }

  return {
    ok: true,
    rows: rows.length,
    headHash: rows[rows.length - 1].hash
  };
}

module.exports = {
  GENESIS_HASH,
  ADVISORY_LOCK_ID,
  computeAuditHash,
  recordAudit,
  verifyAuditChain,
  sanitizeString,
  sanitizeDetails
};
