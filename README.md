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
| `SEED_ADMIN_USERNAME` | **Yes** (for seed) | `admin` | Required username for the seeded administrator account. |
| `SEED_ADMIN_EMAIL` | **Yes** (for seed) | `admin@trustvault.local` | Required email address for the seeded administrator account. |
| `SEED_ADMIN_PASSWORD` | **Yes** (for seed) | `<choose-a-strong-password>` | Required plaintext password to hash with bcrypt for the seeded administrator account. |
| `STORAGE_DIR` | No | `./storage` | Filesystem directory where uploaded documents are stored under random UUID keys. |
| `VITE_API_URL` | No | `http://localhost:5000` | Frontend Vite proxy destination target for `/api` routes during development. |

---

## Role Model & Database Architecture (`db/schema.sql`)

### Role Model
- `users.role` is strictly `'admin'` or `'user'`. There is no `'owner'` or `'viewer'` role on user accounts.
- **Owner**: Refers to the user who uploaded a document (`documents.owner_id`).
- **Viewer / Editor**: Refers to a user holding a grant permission (`read` or `edit` in `grants`) on a document.
- Any active `'user'` can upload documents and access documents shared with them.
- `'admin'` can manage users (enable and disable) and inspect document metadata, audit logs, and activity. Admins can never download or read file contents.

### User Accounts & Registration
- **Administrator account**: Admin accounts can only be created by the seed script (`db/seed.js`) using `SEED_ADMIN_USERNAME`, `SEED_ADMIN_EMAIL`, and `SEED_ADMIN_PASSWORD`. Seeding is safe to run multiple times: it skips the admin if the email already exists and never overwrites an existing password.
- **Regular users**: Regular users register directly through the website (`POST /api/auth/register`) and are stored in the PostgreSQL `users` table, not in `.env`. The registration endpoint always assigns role `'user'`.

### PostgreSQL tables
1. `users`: Stores user identity, case-insensitive unique `username` (3-30 chars, letters/digits/underscore), lowercased unique `email`, optional `full_name`, bcrypt `password_hash`, `role` (`admin`, `user`), and `is_active` status.
2. `sessions`: Server-side sessions with `id`, `user_id`, and `expires_at`.
3. `documents`: Tracks document metadata, `owner_id` (uploader), `original_filename`, `storage_key`, `size_bytes`, `sha256` checksum, and `deleted_at` for soft deletes.
4. `grants`: Explicit permission records (`read` or `edit`) granted on documents with unique constraint on `(document_id, user_id)`.

---

## Setup & Running

### 1. Database Migration & Seeding
Ensure PostgreSQL is running and `DATABASE_URL` is configured in your `.env`.

```bash
# Run database schema migration
cd backend
npm run db:migrate

# Seed the initial admin account using environment variables (safe to run repeatedly)
npm run db:seed

# Or reset database (drops/recreates public schema, runs migrate and seed - refuses in production)
npm run db:reset
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
