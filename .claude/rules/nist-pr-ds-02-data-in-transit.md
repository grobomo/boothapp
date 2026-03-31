# PR.DS-02 -- Data-in-Transit Protection

HTTP URLs blocked in commands and code files (HTTPS required).
Exception: localhost/127.0.0.1/[::1] for local development.
API endpoint configs in `.js`, `.ts`, `.py`, `.json`, `.yaml` must use HTTPS.

Enforced by: `nist-encryption-gate.js`, `test-nist-compliance.sh`
