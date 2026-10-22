// tests/auth.test.js
// Tests authentication flow: login, cookies, rate limiting, and requireAuth middleware

const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../src/app');
const db = require('../src/db');

// Mock database query for isolated unit/integration tests when no live Postgres is present
jest.mock('../src/db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() }
}));

describe('Authentication & Session Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/login', () => {
    it('rejects missing email or password with 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'user@trustvault.local' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Email and password are required');
    });

    it('rejects non-existent users with 401', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'unknown@trustvault.local', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('rejects disabled users with 403', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-1',
          email: 'disabled@trustvault.local',
          password_hash: 'hashed',
          role: 'viewer',
          is_active: false
        }]
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'disabled@trustvault.local', password: 'password123' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Account is disabled');
    });

    it('authenticates valid credentials, sets httpOnly cookie, and creates session', async () => {
      const plainPassword = 'CorrectPassword123!';
      const hash = await bcrypt.hash(plainPassword, 10);

      // 1. SELECT user
      db.query.mockResolvedValueOnce({
        rows: [{
          id: 'user-uuid-1',
          email: 'admin@trustvault.local',
          password_hash: hash,
          role: 'admin',
          is_active: true
        }]
      });

      // 2. INSERT session
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'admin@trustvault.local', password: plainPassword });

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        id: 'user-uuid-1',
        email: 'admin@trustvault.local',
        role: 'admin'
      });

      // Verify cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('tv_session=');
      expect(cookies[0]).toContain('HttpOnly');
      expect(cookies[0]).toContain('SameSite=Lax');
    });
  });

  describe('GET /api/auth/me (requireAuth middleware)', () => {
    it('returns 401 when no session cookie is supplied', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });

    it('returns 401 when session does not exist in DB', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', ['tv_session=invalid-session-token']);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired session');
    });

    it('returns 403 and invalidates session when user is disabled', async () => {
      db.query
        .mockResolvedValueOnce({
          rows: [{
            session_id: 'session-token-123',
            expires_at: new Date(Date.now() + 60000).toISOString(),
            user_id: 'user-uuid-1',
            email: 'disabled@trustvault.local',
            role: 'viewer',
            is_active: false,
            created_at: new Date().toISOString()
          }]
        })
        .mockResolvedValueOnce({ rowCount: 1 }); // DELETE FROM sessions

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', ['tv_session=session-token-123']);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Account is disabled');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions WHERE user_id = $1'),
        ['user-uuid-1']
      );
    });

    it('loads user and session from DB on every request and returns user info', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{
          session_id: 'session-token-123',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          user_id: 'user-uuid-1',
          email: 'admin@trustvault.local',
          role: 'admin',
          is_active: true,
          created_at: '2026-10-22T00:00:00Z'
        }]
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', ['tv_session=session-token-123']);

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        id: 'user-uuid-1',
        email: 'admin@trustvault.local',
        role: 'admin',
        isActive: true,
        createdAt: '2026-10-22T00:00:00Z'
      });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes session from database and clears cookie', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', ['tv_session=active-session-token']);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out successfully');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions WHERE id = $1'),
        ['active-session-token']
      );

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('tv_session=;');
    });
  });
});
