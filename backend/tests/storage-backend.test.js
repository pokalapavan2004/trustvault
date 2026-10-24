const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const db = require('../src/db');

describe('Storage Backend and Production Invariants', () => {
  let user;
  let admin;
  let unauthorizedUser;
  let userSessionId;
  let adminSessionId;
  let unauthorizedSessionId;
  let testFilePath;
  let uploadedDocId;
  const fileContent = 'Secret content stored securely in PostgreSQL bytea table document_files';

  beforeAll(async () => {
    process.env.STORAGE_BACKEND = 'db';
    const suffix = Date.now();
    const userEmail = `storeuser_${suffix}@trustvault.test`;
    const adminEmail = `storeadmin_${suffix}@trustvault.test`;
    const unauthEmail = `storeunauth_${suffix}@trustvault.test`;

    const userRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'user', true)
       RETURNING id, username, email`,
      [`stu_${suffix}`.slice(0, 30), userEmail]
    );
    user = userRes.rows[0];

    const adminRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'admin', true)
       RETURNING id, username, email`,
      [`sta_${suffix}`.slice(0, 30), adminEmail]
    );
    admin = adminRes.rows[0];

    const unauthRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'user', true)
       RETURNING id, username, email`,
      [`stx_${suffix}`.slice(0, 30), unauthEmail]
    );
    unauthorizedUser = unauthRes.rows[0];

    userSessionId = crypto.randomUUID();
    adminSessionId = crypto.randomUUID();
    unauthorizedSessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)',
      [
        userSessionId, user.id, expiresAt,
        adminSessionId, admin.id, expiresAt,
        unauthorizedSessionId, unauthorizedUser.id, expiresAt
      ]
    );

    testFilePath = path.join(__dirname, `storage_test_${suffix}.txt`);
    fs.writeFileSync(testFilePath, fileContent);
  });

  afterAll(async () => {
    if (fs.existsSync(testFilePath)) {
      try {
        fs.unlinkSync(testFilePath);
      } catch (_) {}
    }

    if (uploadedDocId) {
      await db.query('DELETE FROM document_files WHERE document_id = $1', [uploadedDocId]);
      await db.query('DELETE FROM grants WHERE document_id = $1', [uploadedDocId]);
      await db.query('DELETE FROM documents WHERE id = $1', [uploadedDocId]);
    }

    await db.query('DELETE FROM sessions WHERE id IN ($1, $2, $3)', [
      userSessionId,
      adminSessionId,
      unauthorizedSessionId
    ]);
    await db.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [
      user.id,
      admin.id,
      unauthorizedUser.id
    ]);
  });

  test('Upload stores document in document_files (bytea) and calculates correct SHA-256', async () => {
    const expectedSha256 = crypto.createHash('sha256').update(fileContent).digest('hex');

    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', `tv_session=${userSessionId}`)
      .field('title', 'Bytea Test Document')
      .field('category', 'Finance')
      .attach('file', testFilePath);

    expect(res.status).toBe(201);
    expect(res.body.document).toBeDefined();
    expect(res.body.document.sha256).toBe(expectedSha256);

    uploadedDocId = res.body.document.id;

    // Verify row was stored in document_files
    const fileRow = await db.query(
      'SELECT content FROM document_files WHERE document_id = $1',
      [uploadedDocId]
    );

    expect(fileRow.rows.length).toBe(1);
    expect(fileRow.rows[0].content.toString('utf8')).toBe(fileContent);
  });

  test('Download retrieves file from document_files with SHA-256 integrity and security headers', async () => {
    const res = await request(app)
      .get(`/api/documents/${uploadedDocId}/download`)
      .set('Cookie', `tv_session=${userSessionId}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toContain('attachment; filename=');
    expect(res.text).toBe(fileContent);
  });

  test('Admin is denied download (receives 404 - admin never gets download or edit)', async () => {
    const res = await request(app)
      .get(`/api/documents/${uploadedDocId}/download`)
      .set('Cookie', `tv_session=${adminSessionId}`);

    expect(res.status).toBe(404);
  });

  test('Unauthorized user is denied download (receives 404)', async () => {
    const res = await request(app)
      .get(`/api/documents/${uploadedDocId}/download`)
      .set('Cookie', `tv_session=${unauthorizedSessionId}`);

    expect(res.status).toBe(404);
  });

  test('Non-existing /api route returns 404 JSON', async () => {
    const res = await request(app).get('/api/this-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Endpoint not found' });
  });
});
