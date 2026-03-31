# Contact CSV Import & AI Matching

## Goal
Implement Feature 9 from Casey's Feature Document: CSV contact import with auto-detect column mapping, SQLite storage linked to events, and AI matching of session visitors to contacts using Claude with batched processing (50 per batch), confidence scores, and reasoning display.

## Success Criteria
1. CSV upload endpoint accepts file, auto-detects column mapping by header names
2. Contacts stored in SQLite database linked to event
3. AI matching: for each unmatched session, sends visitor name+company to Claude with batched contacts (50 per batch)
4. Returns best match with confidence score 0-100 and reasoning
5. Results displayed with confidence bars and reasoning text
6. Admin can manually override any match

## Implementation
- `presenter/lib/contacts-db.js` — SQLite database module (better-sqlite3)
- `presenter/lib/contacts.js` — Express router: CSV upload, contact CRUD, AI matching
- `presenter/contacts.html` — UI page with upload, contact list, matching results
- Wire into `presenter/server.js`
