# PR.DS-10 -- Key Management

Private key material (`-----BEGIN PRIVATE KEY-----`) blocked in code.
Required: store keys in AWS KMS, Secrets Manager, or HashiCorp Vault.
S3 encryption should use CMK (`--sse-kms-key-id`) over default AWS-managed key.

Enforced by: `nist-access-control-gate.js`, `nist-encryption-gate.js`
