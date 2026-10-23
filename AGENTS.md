# TrustVault: project rules
Project: secure document sharing with a real audit trail.
Hackathon deadline: Sunday 25 Oct 2026, 6 PM.
The owner of this repo must be able to explain every line, so keep things
simple and readable.

## Stack
- Backend: Node.js + Express, PostgreSQL (pg driver, raw SQL, no heavy ORM)
- Frontend: React + Vite
- Tests: Jest + Supertest against a real test Postgres database
- Deploy: Render (web service + Postgres)

## Role Model
- `users.role` is strictly 'admin' or 'user'. There is no 'owner' or 'viewer' role on the account.
- "Owner" refers to the user who uploaded a document (`documents.owner_id`).
- "Viewer" or "editor" refers to a user holding a grant (`read` or `edit`) on a document.
- Any active 'user' can upload documents and view documents shared with them.
- 'admin' can manage users (disable and enable) and see document metadata, audit trail, and activity logs. Admin can never download or read file contents.

## Security invariants (never break these)
1. The server decides every access. There is ONE function,
   authorize(user, documentId, action), in src/auth/authorize.js.
   Every route that touches a document (metadata, download, preview,
   edit, delete, share, versions) must call it. No route does its own check.
2. Return 404 (not 403) for documents the user cannot access, so existence
   is not leaked.
3. List and search queries filter by grants IN SQL. Never fetch everything
   and filter in JavaScript.
4. Permissions are read from the database on every request. No caching.
   Sessions are server-side and invalidated when a user is disabled.
5. Files are stored outside any public directory under a random key, never
   the original filename, and are only streamed after authorize() passes.
   Downloads send: Content-Disposition: attachment,
   X-Content-Type-Options: nosniff, Cache-Control: no-store.
6. The audit log is append-only: the app DB user has INSERT and SELECT only,
   a trigger rejects UPDATE and DELETE, and each row stores
   hash = SHA256(previous_hash + canonical row contents).
   Denied attempts are logged too. The audit row is written in the same
   transaction as the action.
7. Never trust client input for role, owner_id, or user_id. Take them from
   the session.
8. Parameterised SQL only. No string-built queries.

## Code style
- Readable, well-spaced code. Never compress or minify. One idea per
  function, clear names, short comments explaining WHY.
- Handle errors explicitly. No stack traces in responses.

## Workflow
- Work in small tasks. After each task, stop and list the files changed and
  what to review. Do not continue to the next stage on your own.
- Keep explanations short. Do not repeat code back to me.
- Do not add features I did not ask for.
- If you are unsure about a security decision, say so instead of guessing.
- Do not write secrets into the repo. Use environment variables and .env.example.