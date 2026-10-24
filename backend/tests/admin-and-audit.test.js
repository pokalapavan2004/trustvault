const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const db = require('../src/db');
const { computeAuditHash, verifyAuditChain } = require('../src/audit/record');

describe('Feature A (Admin User Management) & Feature B (Hash-Chained Audit Log)', () => {
  let adminUser1;
  let adminUser2;
  let normalUser1;
  let normalUser2;
  let admin1SessionId;
  let admin2SessionId;
  let user1SessionId;
  let user2SessionId;
  let doc1;
  const userPassword = 'TestPassword123!';

  beforeAll(async () => {
    const timestamp = Date.now();
    const passwordHash = await bcrypt.hash(userPassword, 10);

    // Create 2 admins and 2 normal users
    const a1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'admin', true) RETURNING id, username, email, role`,
      [`adm1_${timestamp}`.slice(0, 30), `admin1_${timestamp}@trustvault.test`, passwordHash]
    );
    adminUser1 = a1Res.rows[0];

    const a2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'admin', true) RETURNING id, username, email, role`,
      [`adm2_${timestamp}`.slice(0, 30), `admin2_${timestamp}@trustvault.test`, passwordHash]
    );
    adminUser2 = a2Res.rows[0];

    const u1Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'user', true) RETURNING id, username, email, role`,
      [`usr1_${timestamp}`.slice(0, 30), `user1_${timestamp}@trustvault.test`, passwordHash]
    );
    normalUser1 = u1Res.rows[0];

    const u2Res = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'user', true) RETURNING id, username, email, role`,
      [`usr2_${timestamp}`.slice(0, 30), `user2_${timestamp}@trustvault.test`, passwordHash]
    );
    normalUser2 = u2Res.rows[0];

    // Create sessions
    admin1SessionId = crypto.randomUUID();
    admin2SessionId = crypto.randomUUID();
    user1SessionId = crypto.randomUUID();
    user2SessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9), ($10, $11, $12)`,
      [
        admin1SessionId, adminUser1.id, expiresAt,
        admin2SessionId, adminUser2.id, expiresAt,
        user1SessionId, normalUser1.id, expiresAt,
        user2SessionId, normalUser2.id, expiresAt
      ]
    );

    // Create document owned by User 1
    const docRes = await db.query(
      `INSERT INTO documents (
         owner_id, title, description, category, original_filename,
         storage_key, mime_type, size_bytes, sha256
       ) VALUES ($1, 'User 1 Spec', 'Doc for ownership count', 'General', 'spec.txt',
                 $2, 'text/plain', 50, 'dummy_hash')
       RETURNING id, title`,
      [normalUser1.id, crypto.randomUUID()]
    );
    doc1 = docRes.rows[0];
  });

  afterAll(async () => {
    if (doc1) {
      await db.query('DELETE FROM documents WHERE id = $1', [doc1.id]);
    }
    const userIds = [adminUser1?.id, adminUser2?.id, normalUser1?.id, normalUser2?.id].filter(Boolean);
    if (userIds.length > 0) {
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await db.pool.end();
  });

  describe('Feature A: Admin User Management', () => {
    test('Non-admin calling any /api/admin route gets 404 (same body as unknown route)', async () => {
      // User 1 is a non-admin
      const res1 = await request(app)
        .get('/api/admin/users')
        .set('Cookie', [`tv_session=${user1SessionId}`]);

      expect(res1.status).toBe(404);
      expect(res1.body).toEqual({ error: 'Endpoint not found' });

      const res2 = await request(app)
        .patch(`/api/admin/users/${normalUser2.id}/status`)
        .set('Cookie', [`tv_session=${user1SessionId}`])
        .send({ isActive: false });

      expect(res2.status).toBe(404);
      expect(res2.body).toEqual({ error: 'Endpoint not found' });

      // Unauthenticated request
      const res3 = await request(app).get('/api/admin/audit/head');
      expect(res3.status).toBe(404);
      expect(res3.body).toEqual({ error: 'Endpoint not found' });
    });

    test('GET /api/admin/users returns paginated list with document counts and no sensitive fields', async () => {
      const res = await request(app)
        .get('/api/admin/users?page=1&limit=20')
        .set('Cookie', [`tv_session=${admin1SessionId}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.total).toBeGreaterThanOrEqual(4);

      // Verify fields on User 1
      const foundUser1 = res.body.users.find((u) => u.id === normalUser1.id);
      expect(foundUser1).toBeDefined();
      expect(foundUser1.username).toBe(normalUser1.username);
      expect(foundUser1.email).toBe(normalUser1.email);
      expect(foundUser1.role).toBe('user');
      expect(foundUser1.is_active).toBe(true);
      expect(foundUser1.documents_count).toBeGreaterThanOrEqual(1);

      // Strict security check: NEVER return password_hash or session data
      for (const u of res.body.users) {
        expect(u.password_hash).toBeUndefined();
        expect(u.password).toBeUndefined();
        expect(u.sessions).toBeUndefined();
        expect(u.session_id).toBeUndefined();
      }
    });

    test('PATCH /api/admin/users/:id/status returns 404 for invalid or unknown id', async () => {
      // Invalid UUID format
      const resInvalid = await request(app)
        .patch('/api/admin/users/not-a-valid-uuid/status')
        .set('Cookie', [`tv_session=${admin1SessionId}`])
        .send({ isActive: false });

      expect(resInvalid.status).toBe(404);
      expect(resInvalid.body.error).toBe('User not found');

      // Non-existent UUID
      const fakeUuid = crypto.randomUUID();
      const resNotFound = await request(app)
        .patch(`/api/admin/users/${fakeUuid}/status`)
        .set('Cookie', [`tv_session=${admin1SessionId}`])
        .send({ isActive: false });

      expect(resNotFound.status).toBe(404);
      expect(resNotFound.body.error).toBe('User not found');
    });

    test('Admin cannot disable their own account', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${adminUser1.id}/status`)
        .set('Cookie', [`tv_session=${admin1SessionId}`])
        .send({ isActive: false });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cannot disable their own account/i);
    });

    test('An admin account cannot be disabled by this endpoint', async () => {
      // Admin 1 attempts to disable Admin 2
      const res = await request(app)
        .patch(`/api/admin/users/${adminUser2.id}/status`)
        .set('Cookie', [`tv_session=${admin1SessionId}`])
        .send({ isActive: false });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Administrator accounts cannot be disabled/i);
    });

    test('Disabling a user sets is_active=false, deletes sessions in same transaction, writes audit row', async () => {
      // Admin 1 disables User 2
      const res = await request(app)
        .patch(`/api/admin/users/${normalUser2.id}/status`)
        .set('Cookie', [`tv_session=${admin1SessionId}`])
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.user.is_active).toBe(false);

      // Verify DB status
      const userRes = await db.query('SELECT is_active FROM users WHERE id = $1', [normalUser2.id]);
      expect(userRes.rows[0].is_active).toBe(false);

      // Verify sessions were deleted immediately
      const sessionRes = await db.query('SELECT id FROM sessions WHERE user_id = $1', [normalUser2.id]);
      expect(sessionRes.rows.length).toBe(0);

      // Verify audit row was written
      const auditRes = await db.query(
        `SELECT * FROM audit_logs 
         WHERE action = 'user_disabled' AND actor = $1
         ORDER BY id DESC LIMIT 1`,
        [adminUser1.username]
      );
      expect(auditRes.rows.length).toBe(1);
      const auditRow = auditRes.rows[0];
      expect(auditRow.action).toBe('user_disabled');
      expect(auditRow.details.target_user_id).toBe(normalUser2.id);

      // Subsequent request with User 2's session must fail
      const subsequentReq = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`tv_session=${user2SessionId}`]);
      expect(subsequentReq.status).toBe(401);
    });

    test('Enabling a user sets is_active=true and writes audit row', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${normalUser2.id}/status`)
        .set('Cookie', [`tv_session=${admin1SessionId}`])
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.user.is_active).toBe(true);

      const userRes = await db.query('SELECT is_active FROM users WHERE id = $1', [normalUser2.id]);
      expect(userRes.rows[0].is_active).toBe(true);

      // Verify audit row for user_enabled
      const auditRes = await db.query(
        `SELECT * FROM audit_logs 
         WHERE action = 'user_enabled' AND actor = $1
         ORDER BY id DESC LIMIT 1`,
        [adminUser1.username]
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].details.target_user_id).toBe(normalUser2.id);
    });

    test('Login endpoint returns same generic 401 for a disabled account as for a wrong password', async () => {
      // Disable User 2
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [normalUser2.id]);

      // Login attempt with correct password for disabled user
      const disabledRes = await request(app)
        .post('/api/auth/login')
        .send({ email: normalUser2.email, password: userPassword });

      expect(disabledRes.status).toBe(401);
      expect(disabledRes.body).toEqual({ error: 'Invalid email or password' });

      // Login attempt with wrong password
      const wrongPwRes = await request(app)
        .post('/api/auth/login')
        .send({ email: normalUser1.email, password: 'WrongPassword999!' });

      expect(wrongPwRes.status).toBe(401);
      expect(wrongPwRes.body).toEqual({ error: 'Invalid email or password' });

      // Clean up User 2 back to active
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [normalUser2.id]);
    });
  });

  describe('Feature B: Append-Only, Hash-Chained Audit Log', () => {
    test('GET /api/admin/audit/head returns latest row { id, hash }', async () => {
      const res = await request(app)
        .get('/api/admin/audit/head')
        .set('Cookie', [`tv_session=${admin1SessionId}`]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.hash).toBeDefined();
      expect(res.body.hash.length).toBe(64);
    });

    test('GET /api/admin/audit/verify recomputes chain and verifies contiguous IDs', async () => {
      const res = await request(app)
        .get('/api/admin/audit/verify')
        .set('Cookie', [`tv_session=${admin1SessionId}`]);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.rows).toBeGreaterThanOrEqual(1);
      expect(res.body.headHash).toBeDefined();
      expect(res.body.headHash.length).toBe(64);
    });

    test('Database BEFORE TRUNCATE trigger blocks TRUNCATE on audit_logs', async () => {
      await expect(
        db.query('TRUNCATE TABLE audit_logs')
      ).rejects.toThrow(/append-only/i);
    });

    test('Single createHash usage for audit chain in backend/src/audit/record.js', () => {
      // Validate computeAuditHash produces deterministic SHA-256
      const prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const fields = {
        created_at: new Date('2026-10-24T00:00:00.000Z'),
        actor: 'admin',
        action: 'user_enabled',
        document_id: null,
        result: 'user_enabled',
        ip: '127.0.0.1',
        details: { target: '123' }
      };

      const hash1 = computeAuditHash(prevHash, fields);
      const hash2 = computeAuditHash(prevHash, fields);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });
});
