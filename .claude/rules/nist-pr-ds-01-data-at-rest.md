# PR.DS-01 -- Data-at-Rest Protection

S3 uploads (`aws s3 cp/mv/sync`) require `--sse aws:kms`.
S3 API calls (`s3api put-object`) require `--server-side-encryption aws:kms`.
Customer data files must reference encryption when written.
CloudFormation templates require `BucketEncryption` with `aws:kms`.

Enforced by: `nist-encryption-gate.js`, `test-nist-compliance.sh`
