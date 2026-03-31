# Encryption Infrastructure

## Goal
Add KMS CMK and S3 bucket encryption enforcement for hackathon26, with a test script to verify.

## Success Criteria
1. CloudFormation template creates KMS CMK with alias `hackathon26-cmk`, auto-rotation enabled
2. Key policy grants root account and `hackathon26-instance-role` access (Decrypt, GenerateDataKey)
3. S3 bucket policies on `boothapp-sessions-752266476357` and `hackathon26-state-752266476357` enforce SSE-KMS
4. KMS key ARN exported as `hackathon26-kms-key-arn`
5. All resources tagged `Project=hackathon26`, `NIST-Control=PR.DS-10`
6. Test script verifies: KMS key exists, S3 rejects unencrypted PUTs, encrypted PUT succeeds
