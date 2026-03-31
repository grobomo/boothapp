# Dashboard Authentication System

## Goal
Add login/auth to the presenter dashboard with default admin/admin credentials, forced password change on first login, and admin user management.

## Success Criteria
1. All dashboard pages require login before showing content
2. Default admin/admin credentials work on first use
3. First login forces password change before proceeding
4. Admin can add new users from an admin panel
5. Admin can force password resets for other users
6. Passwords are hashed (SHA-256 with salt) — never stored in plaintext
7. Sessions persist in localStorage so users don't re-login every page load

## Approach
- Store users in S3 bucket (`auth/users.json`) so auth is shared across devices
- Use Web Crypto API (SHA-256 + random salt) for password hashing
- Shared `auth.js` module loaded by all pages
- `login.html` — login + forced password change flow
- `admin.html` — user management (add users, force resets)
- Existing pages (index.html, sessions.html, timeline.html) get auth gate

## Files
- NEW: `presenter/auth.js` — shared auth logic (hash, verify, S3 user CRUD, session check)
- NEW: `presenter/login.html` — login page with password change flow
- NEW: `presenter/admin.html` — user management panel
- EDIT: `presenter/index.html` — add auth gate
- EDIT: `presenter/sessions.html` — add auth gate
- EDIT: `presenter/timeline.html` — add auth gate
