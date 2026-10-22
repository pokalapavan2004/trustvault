# TrustVault

TrustVault is a secure document sharing platform featuring a cryptographic audit trail and strict server-side access control invariants.

---

## Environment Variables

Every environment variable used by TrustVault is documented below. Configure these in `.env` (or `backend/.env`). A template is provided in [`.env.example`](.env.example).

| Variable Name | Required | Default / Example | Purpose / Description |
|---|---|---|---|
| `PORT` | No | `5000` | Port on which the Express backend HTTP server listens. |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`). In production, sets secure cookies and trusts reverse proxy. |
| `CLIENT_URL` | No | `http://localhost:5173` | Allowed CORS origin(s) for the frontend web application. Supports comma-separated origins. |
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@localhost:5432/trustvault` | PostgreSQL connection string for `pg` pool, migrations, and seeding. |
| `DATABASE_SSL` | No | `false` | Enable TLS/SSL for PostgreSQL connection (`true` on Render / managed Postgres, `false` locally). |
| `LOGIN_RATE_LIMIT_MAX` | No | `5` | Maximum failed or successful login attempts allowed per 15-minute window per IP. |
| `SEED_ADMIN_EMAIL` | No | `admin@trustvault.local` | Email address for the initial seeded administrator account. |
| `SEED_ADMIN_PASSWORD` (or `ADMIN_PASSWORD`) | **Yes** (for seed) | `AdminSecurePass123!` | Plaintext password to hash with bcrypt for the seeded administrator account. |
| `SEED_OWNER1_EMAIL` | No | `owner1@trustvault.local` | Email address for the first seeded owner account. |
| `SEED_OWNER1_PASSWORD` (or `OWNER1_PASSWORD`) | **Yes** (for seed) | `Owner1SecurePass123!` | Plaintext password to hash with bcrypt for the first seeded owner account. |
| `SEED_OWNER2_EMAIL` | No | `owner2@trustvault.local` | Email address for the second seeded owner account. |
| `SEED_OWNER2_PASSWORD` (or `OWNER2_PASSWORD`) | **Yes** (for seed) | `Owner2SecurePass123!` | Plaintext password to hash with bcrypt for the second seeded owner account. |
| `SEED_VIEWER1_EMAIL` | No | `viewer1@trustvault.local` | Email address for the first seeded viewer account. |
| `SEED_VIEWER1_PASSWORD` (or `VIEWER1_PASSWORD`) | **Yes** (for seed) | `Viewer1SecurePass123!` | Plaintext password to hash with bcrypt for the first seeded viewer account. |
| `SEED_VIEWER2_EMAIL` | No | `viewer2@trustvault.local` | Email address for the second seeded viewer account. |
| `SEED_VIEWER2_PASSWORD` (or `VIEWER2_PASSWORD`) | **Yes** (for seed) | `Viewer2SecurePass123!` | Plaintext password to hash with bcrypt for the second seeded viewer account. |
| `VITE_API_URL` | No | `http://localhost:5000` | Frontend Vite proxy destination target for `/api` routes during development. |

---

## Database Architecture (`db/schema.sql`)

PostgreSQL tables implemented:
1. `users`: Stores user identity, bcrypt `password_hash`, `role` (`admin`, `owner`, `viewer`), and `is_active` status.
2. `sessions`: Server-side sessions with `id`, `user_id`, and `expires_at`. Session validation checks the DB on every request and immediately revokes sessions when `is_active = false`.
3. `documents`: Tracks document metadata, `owner_id`, `original_filename`, `storage_key`, `size_bytes`, `sha256` checksum, and `deleted_at` for soft deletes.
4. `grants`: Explicit permission records (`read` or `edit`) granted on documents with unique constraint on `(document_id, user_id)`.

---

## Setup & Running

### 1. Database Migration & Seeding
Ensure PostgreSQL is running and `DATABASE_URL` is configured in your `.env`.

```bash
# Run database schema migration
cd backend
npm run db:migrate

# Seed users (1 admin, 2 owners, 2 viewers) using passwords from environment variables
npm run db:seed
```

### 2. Backend Service
```bash
cd backend
npm install
npm run dev   # Runs on http://localhost:5000 with nodemon
npm test      # Runs Jest + Supertest suite
```

### 3. Frontend Application
```bash
cd frontend
npm install
npm run dev   # Runs on http://localhost:5173
```

---

## Security Invariants

- **Centralized Authorization**: Document access is guarded by `authorize(user, documentId, action)` in `src/auth/authorize.js`.
- **404 on Unauthorized**: Non-accessible documents return 404 (not 403) to prevent resource existence leakage.
- **Server-Side Session Invalidation**: `requireAuth` loads user state directly from the database on every request without caching and rejects disabled accounts.
- **Safe Authentication**: Cookies use `httpOnly`, `sameSite: 'lax'`, and are coupled with login rate limiting.
