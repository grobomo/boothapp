# NIST CSF 2.0 Compliance

## WHY

BoothApp handles visitor PII. These hooks enforce encryption and access controls.

## Controls

| Control | Enforced By |
|---------|-------------|
| PR.DS-01 KMS at rest | nist-encryption-gate.js |
| PR.DS-02 TLS in transit | nist-encryption-gate.js |
| PR.AC-01 IAM least privilege | nist-access-gate.js |
| PR.DS-10 No plaintext secrets | nist-encryption-gate.js |
| DE.CM-01 CloudTrail+VPC logs | Advisory (infra review) |
| ID.AM-01 CF-managed tagged assets | Advisory (AWS Config) |
