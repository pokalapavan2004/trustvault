## Entry 1 — 24 October 2026

**Prompt Given to AI:**
I have been assigned a hackathon project called TrustVault — Secure Document Sharing with a Real Audit Trail. The application must support authentication, document uploads, per-document read/edit permissions, access revocation, audit logging, document search, upload validation, an administrative activity view, and automated security tests.
I am planning to use the following technology stack:
- Backend: Node.js + Express
- Database: PostgreSQL
- Frontend: React + Vite
- Testing: Jest + Supertest against a real test PostgreSQL database
- Deployment: Render
Suggest the website structure, features, and user roles required for this application.

**AI Response:**
The AI suggested using the proposed technology stack and recommended three roles:
1. **Admin:** Manages users and monitors document activity.
2. **Owner:** Uploads documents, manages their documents, and grants or revokes permissions.
3. **Viewer:** Accesses documents shared with them according to their permissions.
The AI also suggested organizing the website into authentication pages, a document dashboard, document management, permission management, an audit log, and an administrative dashboard.

**What Was Wrong:**
The proposed three-role model did not match my intended permission design. I did not want separate `Owner` and `Viewer` roles because ownership should be determined for each document, rather than assigned as a separate global user role. Having a dedicated owner role could unnecessarily complicate the authorization model.

**What I Changed:**
I changed the design to use only two global roles:
1. **Admin:** Has administrative capabilities, such as managing users and viewing audit activity. Administrative privileges do not automatically grant access to confidential document contents.
2. **User:** Can upload documents, manage documents they own, and access documents shared with them according to their granted permissions.
The user who uploads a document automatically becomes its owner. Ownership is stored against the individual document, while read/edit permissions are granted to named users through a separate document-permissions model.
This separates global roles from document-level authorization and allows a regular user to own one document while viewing another user's document when explicitly authorized.

## Entry 2 — Document Permissions
**Prompt Given to AI:**
How can I allow users to share documents with specific people and revoke their access whenever needed?
**AI Response:**
The AI suggested storing document permissions in the database and checking them before allowing users to access a document.
**What Was Wrong:**
A basic permission check may not cover every route, such as downloads, edits, and deletions.
**What I Changed:**
I decided to check permissions on the backend for every document operation, not just when displaying the document page.

## Entry 3 — Secure Document Downloads
**Prompt Given to AI:**
How can I stop users from downloading documents that do not belong to them?
**AI Response:**
The AI suggested checking the logged-in user's permissions before sending the file.
**What Was Wrong:**
Checking permissions only on the document page would leave the download endpoint unprotected.
**What I Changed:**
I decided to verify the user's current permission inside the download endpoint before sending any file.

## Entry 4 — Audit Trail
**Prompt Given to AI:**
How should I record who uploaded, downloaded, edited, or deleted a document in TrustVault?
**AI Response:**
The AI suggested creating an audit table containing the user, action, document, and timestamp.
**What Was Wrong:**
Simply creating an audit table does not stop someone with database access from changing or deleting its records.
**What I Changed:**
I decided to restrict audit-log modification through the application and investigate hash chaining to help detect changes to existing records.


## Entry 5 — Search and Filtering
**Prompt Given to AI:**
How can I add document search by name, owner, category, and date using PostgreSQL?
**AI Response:**
The AI suggested using database queries to filter documents based on the selected search options.
**What Was Wrong:**
Search results could expose documents if the query did not consider the logged-in user's permissions.
**What I Changed:**
I decided to apply the user's access restrictions before returning search results.

## Entry 6 — File Upload Validation
**Prompt Given to AI:**
How can I validate uploaded files and prevent users from uploading dangerous files?
**AI Response:**
The AI suggested checking file extensions and setting a maximum upload size.
**What Was Wrong:**
A file extension alone cannot prove that the uploaded file is safe or matches its claimed type.
**What I Changed:**
I decided to add file-size limits, allow only supported file types, verify file content where practical, and store uploads privately.

## Entry 7 — Automated Security Tests
**Prompt Given to AI:**
Help me write Jest and Supertest cases to check whether one user can access another user's documents without permission.
**AI Response:**
The AI suggested testing document access using different user accounts and document IDs.
**What Was Wrong:**
Testing only successful requests would not prove that unauthorized access is blocked.
**What I Changed:**
I decided to test denied downloads, edits, deletions, and permission changes using a separate test PostgreSQL database.


## Entry 8 — Immediate Permission Revocation
**Prompt Given to AI:**
If an owner revokes document access, how can I make sure the user cannot access it again using an old link?
**AI Response:**
The AI suggested removing the user's permission from the database.
**What Was Wrong:**
Removing a permission would not immediately invalidate a previously issued public or long-lived download URL.
**What I Changed:**
I decided to keep file storage private and check the current permission on every download request instead of relying on previously issued links.



## Entry 9 — Admin Access
**Prompt Given to AI:**
Should the TrustVault admin be able to read every user's private document? How should admin permissions work?
**AI Response:**
The AI suggested allowing admins to manage users and view document activity.
**What Was Wrong:**
Administrative access could become a way to bypass document-level permissions if every admin action automatically allowed reading files.
**What I Changed:**
I decided to separate user management and audit viewing from document-content access. Admins should not automatically be able to read every document.



## Entry 10 — Deployment Security
**Prompt Given to AI:**
What should I check before deploying TrustVault to Render so that private documents and user accounts remain secure?
**AI Response:**
The AI suggested configuring environment variables, database connections, and production settings.
**What Was Wrong:**
Deployment configuration alone would not protect documents if storage URLs were public or authorization checks were missing.
**What I Changed:**
I decided to verify private file storage, environment-variable handling, authentication, authorization, and security tests against the deployed application.