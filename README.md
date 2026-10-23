# TrustVault

TrustVault is a secure document sharing platform featuring a cryptographic audit trail and strict server-side access control invariants.

---

## Environment Variables

Every environment variable used by TrustVault is documented below. Configure these in `.env` (or `backend/.env`).

| Variable Name | Required | Example / Placeholder | Purpose / Description |
|---|---|---|---|
| `PORT` | No | `5000` | Port on which the Express backend HTTP server listens. |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`). In production, sets secure cookies and trusts reverse proxy. |
| `CLIENT_URL` | No | `http://localhost:5173` | Allowed CORS origin(s) for the frontend web application. Supports comma-separated origins. |
| `DATABASE_URL` | **Yes** | `postgresql://<user>:<password>@localhost:5432/<database>` | PostgreSQL connection string for `pg` pool, migrations, and seeding. |
| `DATABASE_SSL` | No | `false` | Enable TLS/SSL for PostgreSQL connection (`true` on Render / managed Postgres, `false` locally). |
| `LOGIN_RATE_LIMIT_MAX` | No | `10` | Maximum failed login attempts allowed per 15-minute window per IP (successful logins do not consume quota). |
| `SEED_ADMIN_EMAIL` | No | `admin@trustvault.local` | Email address for the initial seeded administrator account. |
| `SEED_ADMIN_PASSWORD` (or `ADMIN_PASSWORD`) | **Yes** (for seed) | `<choose-a-strong-password>` | Plaintext password to hash with bcrypt for the seeded administrator account. |
| `SEED_OWNER1_EMAIL` | No | `owner1@trustvault.local` | Email address for the first seeded owner account. |
| `SEED_OWNER1_PASSWORD` (or `OWNER1_PASSWORD`) | **Yes** (for seed) | `<choose-a-strong-password>` | Plaintext password to hash with bcrypt for the first seeded owner account. |
| `SEED_OWNER2_EMAIL` | No | `owner2@trustvault.local` | Email address for the second seeded owner account. |
| `SEED_OWNER2_PASSWORD` (or `OWNER2_PASSWORD`) | **Yes** (for seed) | `<choose-a-strong-password>` | Plaintext password to hash with bcrypt for the second seeded owner account. |
| `SEED_VIEWER1_EMAIL` | No | `viewer1@trustvault.local` | Email address for the first seeded viewer account. |
| `SEED_VIEWER1_PASSWORD` (or `VIEWER1_PASSWORD`) | **Yes** (for seed) | `<choose-a-strong-password>` | Plaintext password to hash with bcrypt for the first seeded viewer account. |
| `SEED_VIEWER2_EMAIL` | No | `viewer2@trustvault.local` | Email address for the second seeded viewer account. |
| `SEED_VIEWER2_PASSWORD` (or `VIEWER2_PASSWORD`) | **Yes** (for seed) | `<choose-a-strong-password>` | Plaintext password to hash with bcrypt for the second seeded viewer account. |
| `VITE_API_URL` | No | `http://localhost:5000` | Frontend Vite proxy destination target for `/api` routes during development. |

---

## Database Architecture (`db/schema.sql`)

PostgreSQL tables:
1. `users`: Stores user identity, bcrypt `password_hash`, `role` (`admin`, `owner`, `viewer`), and `is_active` status.
2. `sessions`: Server-side sessions with `id`, `user_id`, and `expires_at`.
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
```

### 3. Frontend Application
```bash
cd frontend
npm install
npm run dev   # Runs on http://localhost:5173
```

---

## Security Invariants (Implemented)

- **Server-Side Session Validation (`requireAuth`)**: Loads user and session from the database on every request without caching. Validates that the session ID matches UUID format before touching the database, and immediately invalidates sessions for disabled accounts.
- **Secure Cookie Settings**: Authentication uses `httpOnly`, `sameSite: 'lax'`, and `secure` (in production) cookies (`tv_session`).
- **Login Rate Limiting**: Mitigates brute-force authentication attempts by restricting login requests per IP window.
