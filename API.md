# TrustVault API Documentation

TrustVault enforces strict server-side access control invariants and a cryptographic audit trail. Access decisions are evaluated on every request from the database (no caching).

---

## 1. Role & Access Model

TrustVault distinguishes between global user roles and per-document resource permissions:

| Entity | Type | Description |
|---|---|---|
| **`admin`** | Global Account Role (`users.role`) | Can manage user accounts (enable/disable), view system-wide document metadata, list grants, revoke grants, delete documents, and inspect/verify audit logs. **Admin can never download or read file contents, and can never grant access.** |
| **`user`** | Global Account Role (`users.role`) | Standard user account. Can upload documents, manage documents they own, and access documents shared with them. |
| **Owner** | Resource Relationship (`documents.owner_id`) | The user who uploaded the document. Has full rights on that document (view metadata, download, edit metadata, delete, share/grant, revoke grants). |
| **Viewer** | Document Grant (`grants.permission = 'read'`) | Named user granted read access. Can view document metadata and download file contents. |
| **Editor** | Document Grant (`grants.permission = 'edit'`) | Named user granted edit access. Can view metadata, download file contents, and edit document title/description/category. |

---

## 2. Security & Authorization Invariants

1. **Centralized Document Authorization**: All routes touching a document call `authorize(user, documentId, action)` in `src/auth/authorize.js`.
2. **Document Existence Oracle Protection**: Any unauthorized request to a document returns HTTP **`404 Not Found`** (not `403 Forbidden`) so document existence is not leaked to unauthorized callers.
3. **Admin Route Cloaking**: Unauthenticated callers and non-admin users calling `/api/admin/*` receive HTTP **`404 Not Found`** with `{"error": "Endpoint not found"}` matching undefined routes.
4. **Append-Only Audit Logging**: All document access attempts (both authorized and denied) are recorded in the tamper-evident, SHA-256 hash-chained `audit_logs` table.
5. **Session Invalidation**: When an admin disables a user, all active sessions for that user are immediately deleted in the same transaction.

---

## 3. Endpoints Matrix Summary

| Method | Endpoint | Allowed Callers | Auth Required | Action / Invariant |
|---|---|---|---|---|
| `GET` | `/health` | **Anyone** (Public) | No | Health check |
| `POST` | `/api/auth/register` | **Anyone** (Public) | No (Rate-limited) | Creates a new user with role `'user'` |
| `POST` | `/api/auth/login` | **Anyone** (Public) | No (Rate-limited) | Validates credentials, sets `tv_session` cookie |
| `POST` | `/api/auth/logout` | **Anyone** | Optional | Clears session cookie & deletes session in DB |
| `GET` | `/api/auth/me` | **Active User / Admin** | Yes | Returns current authenticated user |
| `GET` | `/api/profile` | **Active User / Admin** | Yes | Returns caller's profile |
| `PATCH` | `/api/profile` | **Active User / Admin** | Yes | Updates username or full name |
| `POST` | `/api/profile/password` | **Active User / Admin** | Yes | Changes password & revokes other sessions |
| `POST` | `/api/documents` | **Active User / Admin** | Yes | Uploads file; uploader becomes Owner |
| `GET` | `/api/documents` | **Active User / Admin** | Yes | Lists accessible documents (filtered in SQL) |
| `GET` | `/api/documents/:id` | **Owner, Viewer, Editor, Admin** | Yes | Views document metadata (`404` if unauthorized) |
| `GET` | `/api/documents/:id/download` | **Owner, Viewer, Editor** (**NO Admin**) | Yes | Downloads file with security headers |
| `PATCH` | `/api/documents/:id` | **Owner, Editor** (**NO Admin**) | Yes | Updates document title, description, category |
| `DELETE` | `/api/documents/:id` | **Owner, Admin** | Yes | Soft-deletes document (`deleted_at = NOW()`) |
| `GET` | `/api/documents/:id/grants` | **Owner, Admin** | Yes | Lists active grants for the document |
| `POST` | `/api/documents/:id/grants` | **Owner Only** (**NO Admin**) | Yes | Grants or updates `read` or `edit` permission |
| `DELETE` | `/api/documents/:id/grants/:userId`| **Owner, Admin** | Yes | Revokes user's grant |
| `GET` | `/api/admin/users` | **Admin Only** | Yes (Admin) | Paginated list of users (`404` for non-admins) |
| `PATCH` | `/api/admin/users/:id/status` | **Admin Only** | Yes (Admin) | Enables/disables account & purges sessions |
| `GET` | `/api/admin/audit/head` | **Admin Only** | Yes (Admin) | Gets latest audit log ID and hash |
| `GET` | `/api/admin/audit/verify` | **Admin Only** | Yes (Admin) | Verifies cryptographic audit log integrity |
| `GET` | `/api/activity-logs` | **Admin Only** | Yes (Admin) | Queries audit logs (`404` for non-admins) |

---

## 4. Endpoint Details

### 4.1 System & Health

#### `GET /health`
- **Allowed Callers**: Anyone (Public).
- **Description**: Returns server status and current timestamp.
- **Success Response**: `200 OK`
  ```json
  { "status": "ok", "timestamp": "2026-10-25T11:50:00.000Z" }
  ```

---

### 4.2 Authentication (`/api/auth`)

#### `POST /api/auth/register`
- **Allowed Callers**: Anyone (Public). Rate limited to 5 attempts per hour per IP.
- **Request Body**:
  ```json
  {
    "username": "alice",
    "email": "alice@example.com",
    "password": "Password123",
    "confirmPassword": "Password123"
  }
  ```
- **Rules**:
  - Always creates user with role `'user'`. Any supplied role in request is ignored.
  - Username: 3–30 chars (alphanumeric and underscores).
  - Password: minimum 10 characters with at least one letter and one number.
- **Success Response**: `201 Created`
  ```json
  {
    "message": "User registered successfully",
    "user": { "id": "<uuid>", "username": "alice", "email": "alice@example.com", "role": "user" }
  }
  ```
- **Error Responses**: `400 Bad Request` (validation failed), `409 Conflict` (username or email taken), `429 Too Many Requests`.

#### `POST /api/auth/login`
- **Allowed Callers**: Anyone (Public). Rate limited to 10 failed attempts per 15 minutes per IP.
- **Request Body**:
  ```json
  {
    "email": "alice@example.com",
    "password": "Password123"
  }
  ```
- **Rules**:
  - Validates credentials and verifies account is active (`is_active = true`).
  - Disabled accounts and incorrect credentials return the exact same generic `401` to prevent user enumeration.
  - On success, issues a secure `tv_session` HTTP-only cookie.
- **Success Response**: `200 OK`
  ```json
  {
    "user": { "id": "<uuid>", "username": "alice", "email": "alice@example.com", "role": "user" }
  }
  ```
- **Error Responses**: `400 Bad Request`, `401 Unauthorized` (`"Invalid email or password"`), `429 Too Many Requests`.

#### `POST /api/auth/logout`
- **Allowed Callers**: Anyone (Authenticated or unauthenticated).
- **Description**: Clears `tv_session` cookie and deletes session record from the database.
- **Success Response**: `200 OK`
  ```json
  { "message": "Logged out successfully" }
  ```

#### `GET /api/auth/me`
- **Allowed Callers**: Authenticated active user (`user` or `admin`).
- **Success Response**: `200 OK`
  ```json
  {
    "user": {
      "id": "<uuid>",
      "username": "alice",
      "email": "alice@example.com",
      "role": "user",
      "isActive": true
    }
  }
  ```
- **Error Responses**: `401 Unauthorized` (no session or expired), `403 Forbidden` (account disabled).

---

### 4.3 Profile Management (`/api/profile`)

#### `GET /api/profile`
- **Allowed Callers**: Authenticated user (`user` or `admin`).
- **Success Response**: `200 OK` (returns caller's `id`, `username`, `email`, `full_name`, `role`, `created_at`).

#### `PATCH /api/profile`
- **Allowed Callers**: Authenticated user (`user` or `admin`).
- **Request Body**: `{ "username"?: string, "full_name"?: string | null }`
- **Rules**: Only `username` and `full_name` can be changed. `role`, `email`, and `id` cannot be modified here.
- **Success Response**: `200 OK`

#### `POST /api/profile/password`
- **Allowed Callers**: Authenticated user (`user` or `admin`).
- **Request Body**: `{ "currentPassword": "...", "newPassword": "...", "confirmPassword": "..." }`
- **Rules**: Validates current password, updates hash, and terminates all **other** active sessions of this user.
- **Success Response**: `200 OK` (`"Password updated successfully"`)

---

### 4.4 Document Operations (`/api/documents`)

Document routes strictly enforce `authorize(user, documentId, action)`. Unauthorized access always returns **`404 Not Found`**.

#### `POST /api/documents`
- **Allowed Callers**: Authenticated active user (`user` or `admin`).
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `file`: binary file (max 10 MB, allowed extensions: `.pdf`, `.txt`, `.docx`, `.xlsx`, `.csv`, `.png`, `.jpg`, `.jpeg`).
  - `title`: string (1–255 chars).
  - `description`: optional string.
  - `category`: optional string (`General`, `Finance`, `HR`, `Legal`, `IT`, `Education`, `Personal`).
  - `sharedWith`: optional JSON string array of recipients: `[{"email": "bob@example.com", "permission": "read"}]`.
- **Rules**:
  - Validates magic bytes against file extension.
  - Uploader is assigned as the immutable **Owner** (`owner_id = req.user.id`).
  - Computes and stores SHA-256 checksum.
  - Records upload in audit log.
- **Success Response**: `201 Created`

#### `GET /api/documents`
- **Allowed Callers**: Authenticated active user (`user` or `admin`).
- **Query Parameters**: `?scope=mine|shared|all`
- **Filtering Rules (enforced in SQL)**:
  - **Regular User**:
    - `scope=mine`: only documents where `owner_id = user.id`.
    - `scope=shared`: documents where user has an active grant (`read` or `edit`).
    - `scope=all` (default): owned OR shared documents.
  - **Admin**:
    - `scope=mine`: documents uploaded by the admin.
    - `scope=shared`: documents shared with the admin.
    - `scope=all` (default): metadata of **all** active documents across the platform.
- **Success Response**: `200 OK` with array of document metadata items (including `is_owner`, `my_permission`, `shared_count`).

#### `GET /api/documents/:id`
- **Allowed Callers**:
  - Document **Owner**
  - Users with active **`read`** or **`edit`** grant
  - **Admin** (metadata inspection only)
- **Central Action**: `'view_metadata'`
- **Error Response**: `404 Not Found` for any caller without access or if document does not exist.
- **Audit Effect**: Logs attempt (result: `AUTHORIZED` or `DENIED`).

#### `GET /api/documents/:id/download`
- **Allowed Callers**:
  - Document **Owner**
  - Users with active **`read`** or **`edit`** grant
  - **Strictly Denied: Admin** (Admins can never download or read file contents)
- **Central Action**: `'download'`
- **Rules**:
  - Re-computes SHA-256 hash of file buffer and verifies against `documents.sha256`.
  - Sends security response headers:
    - `Content-Disposition: attachment; filename="<sanitized_filename>"`
    - `X-Content-Type-Options: nosniff`
    - `Cache-Control: no-store`
- **Error Response**: `404 Not Found` if caller is not the owner or grant holder (including admins).
- **Audit Effect**: Logs download attempt in audit log.

#### `PATCH /api/documents/:id`
- **Allowed Callers**:
  - Document **Owner**
  - Users with active **`edit`** grant
  - **Strictly Denied: Users with `read` only, and Admin**
- **Central Action**: `'edit'`
- **Request Body**: `{ "title"?: string, "description"?: string, "category"?: string }`
- **Error Response**: `404 Not Found` if caller lacks `edit` permission or ownership.

#### `DELETE /api/documents/:id`
- **Allowed Callers**:
  - Document **Owner**
  - **Admin**
- **Central Action**: `'delete'`
- **Description**: Performs soft-delete (`deleted_at = NOW()`). Once deleted, all future operations on the document are denied for everyone (`404`).
- **Success Response**: `200 OK` (`"Document deleted successfully"`)
- **Error Response**: `404 Not Found` if caller is neither owner nor admin.

#### `GET /api/documents/:id/grants`
- **Allowed Callers**:
  - Document **Owner**
  - **Admin**
- **Central Action**: `'list_grants'`
- **Success Response**: `200 OK` with list of grants (`id`, `user_id`, `username`, `email`, `permission`, `created_at`).
- **Error Response**: `404 Not Found` for non-owners/non-admins.

#### `POST /api/documents/:id/grants`
- **Allowed Callers**:
  - Document **Owner ONLY**
  - **Strictly Denied: Admin** (Admin can only narrow or revoke access, never grant access)
- **Central Action**: `'share'`
- **Request Body**:
  ```json
  {
    "email": "recipient@example.com",
    "permission": "read" // or "edit"
  }
  ```
- **Rules**:
  - Recipient must be an active registered user with role `'user'`.
  - Cannot grant permissions to document owner (owner already has full access).
  - Upserts grant on conflict.
- **Success Response**: `200 OK` (`"Grant updated successfully"`)
- **Error Response**: `404 Not Found` for non-owners; `400 Bad Request` if recipient not found, inactive, or invalid.

#### `DELETE /api/documents/:id/grants/:userId`
- **Allowed Callers**:
  - Document **Owner**
  - **Admin** (Admins are permitted to narrow/revoke access)
- **Central Action**: `'revoke'`
- **Description**: Revokes the user's permission. Effective immediately on subsequent requests.
- **Success Response**: `200 OK` (`"Grant revoked successfully"`)
- **Error Response**: `404 Not Found` if not authorized or grant not found.

---

### 4.5 Administrative Console (`/api/admin`)

All `/api/admin/*` endpoints are protected by `requireAdmin`. Unauthenticated or non-admin requests receive **`404 Not Found`** with `{"error": "Endpoint not found"}`.

#### `GET /api/admin/users`
- **Allowed Callers**: Admin only.
- **Query Parameters**: `?page=1&limit=20`
- **Description**: Returns paginated list of all users with document count. Never returns passwords or sessions.
- **Success Response**: `200 OK`
  ```json
  {
    "users": [
      {
        "id": "<uuid>",
        "username": "user1",
        "email": "user1@example.com",
        "role": "user",
        "is_active": true,
        "created_at": "...",
        "documents_count": 3
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
  ```

#### `PATCH /api/admin/users/:id/status`
- **Allowed Callers**: Admin only.
- **Request Body**: `{ "isActive": false }` (or `true`)
- **Rules**:
  - Admin cannot disable their own account (`400 Bad Request`).
  - An admin account cannot be disabled through this endpoint (`400 Bad Request`).
  - User role can **never** be changed through any endpoint.
  - When disabling, sets `is_active = false` and deletes **all sessions** of that user in the **same transaction**.
  - Writes an audit log record (`user_disabled` or `user_enabled`) in the same transaction.
- **Success Response**: `200 OK`

#### `GET /api/admin/audit/head`
- **Allowed Callers**: Admin only.
- **Description**: Returns `{ id, hash }` of the latest row in the append-only audit log.
- **Success Response**: `200 OK`
  ```json
  {
    "id": 42,
    "hash": "a1b2c3d4..."
  }
  ```

#### `GET /api/admin/audit/verify`
- **Allowed Callers**: Admin only.
- **Description**: Recomputes the SHA-256 hash chain for all rows and checks contiguous IDs.
- **Success Response**: `200 OK`
  ```json
  {
    "ok": true,
    "count": 42,
    "headHash": "a1b2c3d4..."
  }
  ```
  *(If corrupted: `{ "ok": false, "brokenId": 12, "reason": "Hash mismatch" }`)*

---

### 4.6 Audit Trail (`/api/activity-logs`)

#### `GET /api/activity-logs`
- **Allowed Callers**: Admin only (non-admins receive `404 Not Found`).
- **Query Parameters**:
  - `status`: optional (`allowed` or `denied`)
  - `limit`: optional integer (default 50, max 200)
  - `offset`: optional integer (default 0)
- **Description**: Retrieves audit log records including actor, action, result, timestamp, and hash chain data (`prev_hash`, `hash`).
- **Success Response**: `200 OK`
  ```json
  {
    "logs": [
      {
        "id": 1,
        "actor": "admin",
        "action": "user_disabled",
        "allowed": true,
        "result": "user_disabled",
        "previous_hash": "0000000000000000000000000000000000000000000000000000000000000000",
        "hash": "...",
        "created_at": "..."
      }
    ]
  }
  ```
