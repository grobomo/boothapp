# Contact CSV Import & AI Matching — Summary

## What Was Built

Feature 9 from Casey's Feature Document: full contact CSV import pipeline with AI matching.

### Components
1. **`presenter/lib/contacts-db.js`** — SQLite module (better-sqlite3) with two tables:
   - `contacts`: id, event_id, name, email, company, title, phone, address, lead_score, notes, raw_row
   - `contact_matches`: session_id, event_id, contact_id (FK), confidence (0-100), reasoning, matched_by (ai/manual)

2. **`presenter/lib/contacts.js`** — Express router with 8 endpoints:
   - CSV parsing with proper quoted-field handling
   - Auto-detect column mapping via regex patterns (handles Full Name, Email Address, First Name + Last Name, etc.)
   - AI matching: iterates unmatched sessions, sends visitor name+company to Claude Haiku with contacts batched in groups of 50
   - Manual override support

3. **`presenter/contacts.html`** — Dark-themed UI matching existing pages:
   - Tabbed: Upload / Contacts / AI Matching
   - Drag-and-drop CSV upload with column mapping preview
   - Confidence bars (green >80, yellow >50, red <50) with reasoning text
   - Override button per match

4. **`presenter/components/nav.js`** — Added Contacts link to global nav

### Dependencies Added
- `better-sqlite3` — SQLite driver
- `multer` — Multipart file upload

## Verified
- Server starts cleanly
- CSV auto-mapping works (tested: Full Name, Email Address, Company, Job Title, Phone Number)
- SQLite CRUD operations pass (insert, read, count, deduplicate, delete)
- Quoted CSV fields parsed correctly
- PR #372 created

## Design Decisions
- Used Claude Haiku (claude-haiku-4-5-20251001) for matching — fast and cheap for this task
- SQLite over S3 for contacts — relational queries, joins for match display, no S3 latency per lookup
- Batch size 50 per Claude call — balances context window usage vs API calls
- UNIQUE(event_id, email) prevents duplicate imports on re-upload
