const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = require('../src/app');
const db = require('../src/db');

describe('Document Upload and Sharing Invariants', () => {
  let uploaderUser;
  let recipientUser;
  let uploaderSessionId;
  let recipientSessionId;
  let testFilePath;
  let createdDocumentIds = [];

  beforeAll(async () => {
    // 1. Create unique test users
    const uniqueSuffix = Date.now();
    const uploaderEmail = `uploader_${uniqueSuffix}@trustvault.test`;
    const recipientEmail = `recipient_${uniqueSuffix}@trustvault.test`;

    const uploaderRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'user', true)
       RETURNING id, username, email`,
      [`upl_${uniqueSuffix}`.slice(0, 30), uploaderEmail]
    );
    uploaderUser = uploaderRes.rows[0];

    const recipientRes = await db.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, 'dummy_hash', 'user', true)
       RETURNING id, username, email`,
      [`rec_${uniqueSuffix}`.slice(0, 30), recipientEmail]
    );
    recipientUser = recipientRes.rows[0];

    // 2. Create active sessions for both
    uploaderSessionId = crypto.randomUUID();
    recipientSessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3), ($4, $5, $6)',
      [uploaderSessionId, uploaderUser.id, expiresAt, recipientSessionId, recipientUser.id, expiresAt]
    );

    // 3. Prepare temporary valid text file
    testFilePath = path.join(__dirname, `test_file_${uniqueSuffix}.txt`);
    fs.writeFileSync(testFilePath, 'TrustVault confidential shared file contents');
  });

  afterAll(async () => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      try {
        fs.unlinkSync(testFilePath);
      } catch (e) {
        // ignore
      }
    }

    // Clean up documents and storage files
    if (createdDocumentIds.length > 0) {
      const docRes = await db.query(
        'SELECT storage_key FROM documents WHERE id = ANY($1::uuid[])',
        [createdDocumentIds]
      );
      const storageDir = process.env.STORAGE_DIR || path.resolve(__dirname, '../../../storage');
      for (const row of docRes.rows) {
        const storedPath = path.join(storageDir, row.storage_key);
        if (fs.existsSync(storedPath)) {
          try {
            fs.unlinkSync(storedPath);
          } catch (e) {
            // ignore
          }
        }
      }
      await db.query('DELETE FROM documents WHERE id = ANY($1::uuid[])', [createdDocumentIds]);
    }

    // Clean up test users (cascades sessions and grants)
    if (uploaderUser && recipientUser) {
      await db.query('DELETE FROM users WHERE id IN ($1, $2)', [uploaderUser.id, recipientUser.id]);
    }

    // Close db pool so Jest exits cleanly
    await db.pool.end();
  });

  test('POST /api/documents with sharedWith creates document and grant atomically, visible to shared user', async () => {
    const uploadRes = await request(app)
      .post('/api/documents')
      .set('Cookie', [`tv_session=${uploaderSessionId}`])
      .field('title', 'Quarterly Financial Statement')
      .field('description', 'Q4 financial report shared for review')
      .field('category', 'Finance')
      .attach('file', testFilePath)
      .field('sharedWith', JSON.stringify([
        { email: recipientUser.email, permission: 'read' }
      ]));

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.document).toBeDefined();
    const docId = uploadRes.body.document.id;
    createdDocumentIds.push(docId);

    // 1. Assert row exists in grants table in DB
    const grantsRes = await db.query(
      'SELECT id, document_id, user_id, permission, granted_by FROM grants WHERE document_id = $1',
      [docId]
    );
    expect(grantsRes.rows.length).toBe(1);
    expect(grantsRes.rows[0].user_id).toBe(recipientUser.id);
    expect(grantsRes.rows[0].permission).toBe('read');
    expect(grantsRes.rows[0].granted_by).toBe(uploaderUser.id);

    // 2. Assert shared user sees the document via GET /api/documents?scope=shared
    const recipientGetRes = await request(app)
      .get('/api/documents?scope=shared')
      .set('Cookie', [`tv_session=${recipientSessionId}`]);

    expect(recipientGetRes.status).toBe(200);
    expect(Array.isArray(recipientGetRes.body.documents)).toBe(true);

    const foundDoc = recipientGetRes.body.documents.find((d) => d.id === docId);
    expect(foundDoc).toBeDefined();
    expect(foundDoc.title).toBe('Quarterly Financial Statement');
    expect(foundDoc.is_owner).toBe(false);
    expect(foundDoc.my_permission).toBe('read');
    expect(foundDoc.owner_username).toBe(uploaderUser.username);
  });

  test('POST /api/documents fails atomically when sharedWith contains an unknown email', async () => {
    const invalidEmail = 'nonexistent_user_99999@trustvault.test';

    const uploadRes = await request(app)
      .post('/api/documents')
      .set('Cookie', [`tv_session=${uploaderSessionId}`])
      .field('title', 'Document With Invalid Recipient')
      .field('category', 'General')
      .attach('file', testFilePath)
      .field('sharedWith', JSON.stringify([
        { email: invalidEmail, permission: 'read' }
      ]));

    expect(uploadRes.status).toBe(400);
    expect(uploadRes.body.error).toMatch(/invalid or unknown/i);

    // Assert that no document with this title was committed
    const docCheck = await db.query(
      'SELECT id FROM documents WHERE title = $1 AND owner_id = $2',
      ['Document With Invalid Recipient', uploaderUser.id]
    );
    expect(docCheck.rows.length).toBe(0);

    // Assert that no grant was inserted for this non-existent document
    const grantCheck = await db.query(
      'SELECT id FROM grants WHERE granted_by = $1 AND created_at > NOW() - INTERVAL \'1 minute\'',
      [uploaderUser.id]
    );
    // Only the grant from the first test should exist
    expect(grantCheck.rows.length).toBe(1);
  });
});
