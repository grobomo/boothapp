# DE.CM-01 -- Continuous Monitoring

`test-nist-compliance.sh` provides on-demand codebase scanning.
Scans for plaintext secrets, unencrypted S3 ops, HTTP URLs, hardcoded credentials.
Run in CI/CD pipelines for continuous enforcement.
Exit code 0 = compliant, non-zero = violations with detail report.

Enforced by: `test-nist-compliance.sh` (CI integration)
