# TrustVault

TrustVault is a secure document sharing platform featuring a cryptographic audit trail and strict server-side access control invariants.

---

## Environment Variables

Every environment variable used by TrustVault is documented below. Configure these in `.env` (or `backend/.env`).

| Variable Name | Required | Example / Placeholder | Purpose / Description |
|---|---|---|---|
| `PORT` | No | `5000` | Port on which the Express backend HTTP server listens (provided dynamically by Render via `process.env.PORT`). |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`). In production, sets secure cookies, serves built frontend static files, and trusts reverse proxy. |
| `STORAGE_BACKEND` | No | `db` (prod) / `disk` (dev) | File storage backend: `'db'` stores files in PostgreSQL `document_files` (bytea), `'disk'` stores on filesystem in `STORAGE_DIR`. |
| `CLIENT_URL` | No | `http://localhost:5173` | Allowed CORS origin(s) for frontend requests during development. Supports comma-separated origins. |
| `DATABASE_URL` | **Yes** | `postgresql://<user>:<password>@localhost:5432/<database>` | PostgreSQL connection string for `pg` pool, migrations, and seeding. In Render, automatically populated from `trustvault-db`. |
| `DATABASE_SSL` | No | `false` | Enable TLS/SSL for PostgreSQL connection (`true` on Render / managed Postgres, `false` locally). |
| `LOGIN_RATE_LIMIT_MAX` | No | `10` | Maximum failed login attempts allowed per 15-minute window per IP (successful logins do not consume quota). |
| `SEED_ADMIN_USERNAME` | **Yes** (for seed) | `admin` | Required username for the seeded administrator account (`sync: false` in Render). |
| `SEED_ADMIN_EMAIL` | **Yes** (for seed) | `admin@trustvault.local` | Required email address for the seeded administrator account (`sync: false` in Render). |
| `SEED_ADMIN_PASSWORD` | **Yes** (for seed) | `<choose-a-strong-password>` | Required plaintext password to hash with bcrypt for the seeded administrator account (`sync: false` in Render). |
| `STORAGE_DIR` | No | `./storage` | Filesystem directory where uploaded documents are stored under random UUID keys when `STORAGE_BACKEND = 'disk'`. |
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
5. `document_files`: Stores uploaded file payloads in PostgreSQL (`document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, content BYTEA NOT NULL`) when `STORAGE_BACKEND = 'db'`.
6. `audit_logs`: The audit log is append-only (database triggers block edits and deletes) and hash-chained with SHA-256. A database owner could still bypass the triggers directly, as analyzed in [THREATS.md](file:///c:/Users/DELL/OneDrive/Desktop/snovasys%20task/trustvault/THREATS.md).

---

## Setup & Running

### 1. Database Migration & Seeding
Ensure PostgreSQL is running and `DATABASE_URL` is configured in your `.env`.

```bash
# Run database schema migration (safe to run repeatedly)
cd backend
npm run db:migrate

# Seed the initial admin account using environment variables (safe to run repeatedly)
npm run db:seed

# Or reset database (drops/recreates public schema, runs migrate and seed - strictly refuses in production)
npm run db:reset
```

### 2. Backend Service (Development)
```bash
cd backend
npm install
npm run dev   # Runs on http://localhost:5000 with nodemon
```

### 3. Frontend Application (Development)
```bash
cd frontend
npm install
npm run dev   # Runs on http://localhost:5173
```

---

## Deploying to Render (Single Web Service)

TrustVault is configured to deploy as a **single web service** on Render that builds and serves the frontend SPA alongside the Express API from the same origin, backed by a managed PostgreSQL database.

### Blueprint Deployment via `render.yaml`
1. Connect your GitHub repository to [Render](https://render.com).
2. Choose **Blueprints** and select the repository. Render will automatically parse [render.yaml](file:///c:/Users/DELL/OneDrive/Desktop/snovasys%20task/trustvault/render.yaml).
3. The blueprint provisions:
   - **PostgreSQL Database** (`trustvault-db`): Free-tier managed PostgreSQL instance.
   - **Web Service** (`trustvault`): Node.js service running on a single origin.
4. Enter the required secret environment variables in the Render dashboard:
   - `SEED_ADMIN_USERNAME`: Administrator username (e.g. `admin`)
   - `SEED_ADMIN_EMAIL`: Administrator email (e.g. `admin@trustvault.local`)
   - `SEED_ADMIN_PASSWORD`: Strong password for the admin account
5. Click **Apply Blueprint**.

### Build and Start Pipeline
- **Build Command**:
  ```bash
  npm --prefix frontend install && npm --prefix frontend run build && npm --prefix backend install
  ```
  Installs dependencies and builds the React frontend to `frontend/dist`, then installs backend production dependencies.
- **Start Command**:
  ```bash
  cd backend && npm run db:migrate && npm run db:seed && npm start
  ```
  Runs idempotent database migrations, seeds the administrator if not already present (never overwriting existing passwords), and launches the Express server with `npm start`.

### Production Runtime Invariants
- **Same-Origin Static Serving**: Express serves `frontend/dist` static assets and redirects all non-`/api` requests to `index.html`. API routes remain exclusively under `/api`.
- **Ephemeral Filesystem Mitigation**: Files are stored as binary buffers (`bytea`) in PostgreSQL table `document_files` (`STORAGE_BACKEND=db`), ensuring files persist across restarts.
- **Reverse Proxy & Cookies**: `app.set('trust proxy', 1)` is enabled; session cookies are sent with `httpOnly`, `sameSite: 'lax'`, and `secure: true`.
- **Production Guard**: `npm run db:reset` will terminate with an error and exit code `1` if executed with `NODE_ENV=production`.

---

## Security Invariants (Implemented)

- **Server-Side Session Validation (`requireAuth`)**: Loads user and session from the database on every request without caching. Validates that the session ID matches UUID format before touching the database, and immediately invalidates sessions for disabled accounts.
- **Secure Cookie Settings**: Authentication uses `httpOnly`, `sameSite: 'lax'`, and `secure` (in production) cookies (`tv_session`).
- **Central Authorization (`authorize`)**: Every document route checks permissions first; unauthorized or forbidden attempts trigger audit log entries and return 404 (preventing document existence oracle leaks).
- **Cryptographic Audit Trail (`audit_logs`)**: The audit log is append-only (database triggers block edits and deletes) and hash-chained with SHA-256. A database owner could still bypass the triggers directly, as analyzed in [THREATS.md](file:///c:/Users/DELL/OneDrive/Desktop/snovasys%20task/trustvault/THREATS.md).
- **File Integrity & Security**: Magic bytes verification, extension allowlisting, and SHA-256 integrity checks on download ensure tamper-proof file storage.
- **Login Rate Limiting**: Mitigates brute-force authentication attempts by restricting login requests per IP window.


## Demo accounts

| Role  | Login          | Password         |
|-------|----------------|------------------|
| Admin | admin@gmail.com| admin@1234       |
| User1 | user1@gmail.com| user1@1234       |
| User2 | user2@gmail.com| user2@1234       |
| User3 | user3@gmail.com| user3@1234       |