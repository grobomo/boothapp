# NIST CSF 2.0 Enforcement Hook System

## Goal
Create a NIST CSF 2.0 enforcement hook system for the hierarchical CCC fleet that prevents non-compliant operations at the PreToolUse level.

## Success Criteria
1. `nist-encryption-gate.js` blocks S3 PUTs without `--sse aws:kms`, HTTP URLs (non-TLS), and unencrypted secrets
2. `nist-access-control-gate.js` blocks hardcoded credentials, enforces IAM role usage, blocks plaintext secrets
3. `nist-csf-2.md` documents all 6 NIST CSF 2.0 controls: PR.DS-01, PR.DS-02, PR.AC-01, PR.DS-10, DE.CM-01, ID.AM-01
4. `test-nist-compliance.sh` scans codebase and exits 0 if compliant, non-zero with violations list
5. All tests pass when run against the codebase

## Deliverables
- `.claude/hooks/run-modules/PreToolUse/nist-encryption-gate.js`
- `.claude/hooks/run-modules/PreToolUse/nist-access-control-gate.js`
- `.claude/rules/nist-csf-2.md`
- `scripts/test/test-nist-compliance.sh`
