# NIST CSF 2.0 Compliance Enforcement

## Goal
Add PreToolUse hooks and a compliance scan script to enforce NIST CSF 2.0 controls across the CCC fleet.

## Success Criteria
- [ ] Encryption gate blocks unencrypted S3 ops, HTTP URLs, plaintext secrets
- [ ] Access gate blocks hardcoded AWS creds (AKIA), root usage, enforces IAM roles
- [ ] Rule file documents all six NIST CSF 2.0 controls
- [ ] Test script scans codebase and exits 0 if clean
