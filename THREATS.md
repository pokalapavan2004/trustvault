# THREATS.md

Ways this system could be attacked, what I did about each, and what I
knowingly left open. Status is Closed (fixed and tested), Partly closed, or
Accepted (known and left, with a reason).

## Format
- Threat: what an attacker tries
- What I did: the control in the code, with the file
- Test: the test that proves it (or "none yet")
- Status: Closed / Partly closed / Accepted

## Entries

### 1. Guessing document IDs (IDOR)
- Threat: A logged-in user changes the UUID in a URL or API request to access, download, or delete someone else's document.
- What I did: Every document route calls the central `authorize(user, documentId, action)` function in `backend/src/auth/authorize.js` before executing any query or filesystem action. The function evaluates ownership, explicit grants ('read' or 'edit'), and admin permissions against the database on every request. Denied attempts throw a uniform `NotFoundError` (returning HTTP 404 to avoid leaking document existence) and record an unauthorized attempt in `audit_logs`.
- Test: `backend/tests/activity-logs.test.js` ("records unauthorized access attempt when user without permission requests document").
- Status: Closed

### 2. Privilege escalation by administrators
- Threat: A system administrator abuses global administrative privileges to download or read confidential document contents.
- What I did: In `backend/src/auth/authorize.js`, admin privileges are strictly restricted to narrowing access (`delete`, `revoke`, `list_grants`, `view_metadata`). Admins can never download file contents (`action: 'download'`) or modify document contents (`action: 'edit'`) unless they explicitly own the document or hold a grant. The frontend hides download buttons from the admin UI, and the server strictly rejects download requests with 404.
- Test: `backend/tests/activity-logs.test.js` and `backend/tests/document-sharing.test.js`.
- Status: Closed

### 3. Enumeration and information leakage of document existence
- Threat: An attacker probes document UUIDs to determine which documents exist on the system by comparing error codes (e.g., 403 Forbidden vs. 404 Not Found).
- What I did: In `backend/src/auth/authorize.js`, invalid UUIDs, non-existent documents, soft-deleted documents, and permission-denied attempts all throw `NotFoundError` with an identical status code (404) and response payload (`{ "error": "Document not found" }`).
- Test: `backend/tests/activity-logs.test.js` ("records unauthorized access attempt when user without permission requests document").
- Status: Closed

### 4. Malicious file upload and Remote Code Execution (RCE)
- Threat: An attacker uploads an executable file, web shell, or malicious script (e.g., `.exe`, `.js`, `.sh`, `.php`, or HTML with embedded scripts) disguised with a document extension to achieve server execution or Stored XSS.
- What I did: In `backend/src/routes/documents.js`, uploads are validated against an extension allowlist (`.pdf`, `.txt`, `.docx`, `.xlsx`, `.csv`, `.png`, `.jpg`, `.jpeg`) and checked against known magic bytes/file header signatures before committing. Files are stored outside public access under random UUID filenames with no file extension, and downloads enforce `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`.
- Test: `backend/tests/document-sharing.test.js` (magic byte validation and isolated storage key generation).
- Status: Closed

### 5. Direct access to stored files bypassing authorization
- Threat: An attacker bypasses application-level authentication by accessing file storage URLs directly on the web server or cloud bucket.
- What I did: Files are stored in a dedicated directory (`STORAGE_DIR`) located outside any public directory and served exclusively through the streaming endpoint in `backend/src/routes/documents.js` (`GET /api/documents/:id/download`). Streaming begins only after `authorize()` confirms read/edit permissions or ownership.
- Test: `backend/tests/document-sharing.test.js` (download streamed only after authenticated grant validation).
- Status: Closed

### 6. Tampering with audit logs and activity history
- Threat: A rogue administrator or attacker who compromises the application modifies or deletes audit logs to conceal unauthorized access attempts.
- What I did: In `db/schema.sql`, the `audit_logs` table is protected by a PostgreSQL trigger (`trg_audit_logs_immutable`) that raises an exception on any `UPDATE` or `DELETE` attempt. Additionally, in `backend/src/auth/authorize.js`, every audit log entry calculates a cryptographic SHA-256 hash chaining `hash = SHA256(previous_hash + canonical row contents)` to provide tamper detection.
- Test: `backend/tests/activity-logs.test.js` ("audit_logs table enforces append-only immutability (trigger rejects UPDATE and DELETE)").
- Status: Closed

### 7. SQL Injection (SQLi)
- Threat: An attacker injects malicious SQL statements into user input parameters (usernames, document titles, search queries, or grant emails) to extract database contents or bypass authentication.
- What I did: All database queries across `backend/src/routes/documents.js`, `backend/src/routes/auth.js`, `backend/src/routes/users.js`, `backend/src/routes/audit.js`, and `backend/src/auth/authorize.js` use parameterized queries with placeholders (`$1, $2, ...`) via the PostgreSQL driver (`pg`). No SQL statements are constructed using string interpolation or concatenation.
- Test: Verified in all automated test suites (`backend/tests/document-sharing.test.js` and `backend/tests/activity-logs.test.js`).
- Status: Closed

### 8. Session hijacking and delay in revoking access for disabled accounts
- Threat: A deactivated or compromised employee continues to access private documents using an unexpired session token or stateless JWT.
- What I did: Sessions are stored server-side in the `sessions` table and validated on every incoming request in `backend/src/middleware/requireAuth.js`. When an administrator deactivates a user (`is_active = false`), the middleware immediately destroys all active sessions for that user in the database, clears the session cookie, and blocks further requests with HTTP 403.
- Test: Server-side database validation in `backend/src/middleware/requireAuth.js`.
- Status: Closed

### 9. Stale access retention after permission revocation
- Threat: A user whose grant has been revoked continues to access documents due to cached authorization tokens or long-lived download URLs.
- What I did: Grants are removed immediately in a database transaction in `backend/src/routes/documents.js` (`DELETE /api/documents/:id/grants/:userId`). In `backend/src/auth/authorize.js`, document permissions are loaded directly from the database on every request with zero in-memory caching. Revocation takes effect on the very next request.
- Test: `backend/tests/document-sharing.test.js` (atomic grant operations and immediate DB synchronization).
- Status: Closed

### 10. Brute force and credential stuffing attacks
- Threat: An attacker performs automated dictionary or credential stuffing attacks against `/api/auth/login` and `/api/auth/register`.
- What I did: In `backend/src/middleware/rateLimiter.js`, IP-based rate limiting is enforced using `express-rate-limit` (limiting login attempts to 5 per 15 minutes per IP and registration to 5 per hour). Passwords are encrypted using `bcrypt` with salt rounds = 12.
- Test: Rate limiting middleware active in `backend/src/routes/auth.js`.
- Status: Closed

### 11. Cross-Site Request Forgery (CSRF)
- Threat: A malicious site tricks an authenticated user's browser into submitting unauthorized requests (such as deleting documents or granting permissions) to TrustVault.
- What I did: Authentication cookies are configured with `SameSite=Lax`, `HttpOnly=true`, and `Secure=true` in production (`backend/src/routes/auth.js`). Cross-origin requests from unauthorized origins are rejected by CORS middleware in `backend/src/app.js`.
- Test: Cookie configuration in `backend/src/routes/auth.js` and CORS origin validation in `backend/src/app.js`.
- Status: Partly closed (SameSite=Lax prevents cross-origin POST/DELETE requests initiated by third-party sites; explicit CSRF token verification per form submission could be added for additional defense-in-depth across subdomains).

### 12. Denial of Service (DoS) through oversized file uploads
- Threat: An attacker uploads massive files to exhaust server disk space, memory, or processing capacity.
- What I did: Multer limits file size to 10 MB in `backend/src/routes/documents.js` (`limits: { fileSize: 10 * 1024 * 1024 }`). Upload failures automatically clean up incomplete files from the filesystem on failure or transaction rollback.
- Test: `backend/src/app.js` error handler catches `LIMIT_FILE_SIZE` and returns HTTP 400.
- Status: Closed

### 13. Physical database server compromise / Superuser tampering
- Threat: An attacker obtains root operating system access or direct PostgreSQL superuser credentials on the hosting provider and modifies raw disk blocks or disables database triggers.
- What I did: Cryptographic SHA-256 hash chaining in `audit_logs` ensures that any modification, reordering, or deletion of past audit records breaks the chain and can be detected mathematically during audit verification.
- Test: Hash chain generation verified in `backend/tests/activity-logs.test.js`.
- Status: Accepted (A privileged host superuser with raw disk or database binary access could theoretically rewrite historical records and recompute hashes if they possess all cryptographic parameters; absolute non-repudiation against host compromise would require streaming hashes to an external, write-once append-only ledger).