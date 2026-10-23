const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/app');
const db = require('../src/db');

describe('Admin Activity Logs and Audit Trail Invariants', () => {
  let adminUser;
  let normalUser1;
  let normalUser2;
  let adminSessionId;
  let user1SessionId;
  let user2SessionId;
  let testDocument;

  beforeAll(async () => {
    const timestamp = Date.now();

    // 1. Create admin and two regular users
    const adminRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'admin', true)
       RETURNING id, username, email`,
      [`adm_${timestamp}`.slice(0, 30), `admin_${timestamp}@trustvault.test`]
    );
    adminUser = adminRes.rows[0];

    const u1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'user', true)
       RETURNING id, username, email`,
      [`u1_${timestamp}`.slice(0, 30), `user1_${timestamp}@trustvault.test`]
    );
    normalUser1 = u1Res.rows[0];

    const u2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'user', true)
       RETURNING id, username, email`,
      [`u2_${timestamp}`.slice(0, 30), `user2_${timestamp}@trustvault.test`]
    );
    normalUser2 = u2Res.rows[0];

    // 2. Create sessions for all three
    adminSessionId = crypto.randomUUID();
    user1SessionId = crypto.randomUUID();
    user2SessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
      [
        adminSessionId, adminUser.id, expiresAt,
        user1SessionId, normalUser1.id, expiresAt,
        user2SessionId, normalUser2.id, expiresAt
      ]
    );

    // 3. Create document owned by User 1
    const docRes = await db.query(
      `INSERT INTO documents (
        owner_id, title, description, category, original_filename,
        storage_key, mime_type, size_bytes, sha256
       )
       VALUES ($1, 'Confidential Audit Target', 'Audit trial test doc', 'Finance', 'confidential.txt',
               $2, 'text/plain', 128, 'dummy_sha256')
       RETURNING id, title`,
      [normalUser1.id, crypto.randomUUID()]
    );
    testDocument = docRes.rows[0];
  });

  afterAll(async () => {
    // Clean up document
    if (testDocument) {
      await db.query('DELETE FROM documents WHERE id = $1', [testDocument.id]);
    }

    // Clean up users (cascades sessions and grants)
    const userIds = [adminUser?.id, normalUser1?.id, normalUser2?.id].filter(Boolean);
    if (userIds.length > 0) {
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }

    await db.pool.end();
  });

  test('records authorized access attempt when user with permission accesses document', async () => {
    // User 1 is owner -> authorized to view metadata
    const res = await request(app)
      .get(`/api/documents/${testDocument.id}`)
      .set('Cookie', [`tv_session=${user1SessionId}`]);

    expect(res.status).toBe(200);

    // Assert audit log row was recorded with allowed = true
    const auditRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE document_id = $1 AND user_id = $2 AND action = 'view_metadata'
       ORDER BY created_at DESC LIMIT 1`,
      [testDocument.id, normalUser1.id]
    );

    expect(auditRes.rows.length).toBe(1);
    const row = auditRes.rows[0];
    expect(row.allowed).toBe(true);
    expect(row.reason).toBe('AUTHORIZED');
    expect(row.hash).toBeDefined();
    expect(row.previous_hash).toBeDefined();
  });

  test('records unauthorized access attempt when user without permission requests document', async () => {
    // User 2 has NO grant on document owned by User 1 -> denied
    const res = await request(app)
      .get(`/api/documents/${testDocument.id}`)
      .set('Cookie', [`tv_session=${user2SessionId}`]);

    // Invariant 2: Denied attempt returns uniform 404
    expect(res.status).toBe(404);

    // Assert audit log row was recorded with allowed = false and reason = PERMISSION_DENIED
    const auditRes = await db.query(
      `SELECT * FROM audit_logs 
       WHERE document_id = $1 AND user_id = $2 AND action = 'view_metadata'
       ORDER BY created_at DESC LIMIT 1`,
      [testDocument.id, normalUser2.id]
    );

    expect(auditRes.rows.length).toBe(1);
    const row = auditRes.rows[0];
    expect(row.allowed).toBe(false);
    expect(row.reason).toBe('PERMISSION_DENIED');
  });

  test('GET /api/activity-logs is strictly forbidden for regular users and returns 404', async () => {
    const res = await request(app)
      .get('/api/activity-logs')
      .set('Cookie', [`tv_session=${user1SessionId}`]);

    expect(res.status).toBe(404);
  });

  test('GET /api/activity-logs returns all audit trail entries for admin', async () => {
    const res = await request(app)
      .get('/api/activity-logs')
      .set('Cookie', [`tv_session=${adminSessionId}`]);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.counts).toBeDefined();
    expect(res.body.counts.allowed_count).toBeGreaterThanOrEqual(1);
    expect(res.body.counts.denied_count).toBeGreaterThanOrEqual(1);

    // Filter by allowed
    const allowedRes = await request(app)
      .get('/api/activity-logs?status=allowed')
      .set('Cookie', [`tv_session=${adminSessionId}`]);

    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body.logs.every(l => l.allowed === true)).toBe(true);

    // Filter by denied
    const deniedRes = await request(app)
      .get('/api/activity-logs?status=denied')
      .set('Cookie', [`tv_session=${adminSessionId}`]);

    expect(deniedRes.status).toBe(200);
    expect(deniedRes.body.logs.every(l => l.allowed === false)).toBe(true);
  });

  test('audit_logs table enforces append-only immutability (trigger rejects UPDATE and DELETE)', async () => {
    const latestRowRes = await db.query('SELECT id FROM audit_logs ORDER BY created_at DESC LIMIT 1');
    const logId = latestRowRes.rows[0].id;

    // UPDATE attempt must fail
    await expect(
      db.query("UPDATE audit_logs SET action = 'tampered' WHERE id = $1", [logId])
    ).rejects.toThrow(/immutable and append-only/i);

    // DELETE attempt must fail
    await expect(
      db.query('DELETE FROM audit_logs WHERE id = $1', [logId])
    ).rejects.toThrow(/immutable and append-only/i);
  });
});
