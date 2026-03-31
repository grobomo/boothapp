# PR.AC-01 -- Access Control

AWS Access Key IDs (AKIA*/ASIA*) blocked in code and commands.
Hardcoded passwords and API tokens blocked in source files.
CLI `--aws-access-key-id` / `--aws-secret-access-key` flags blocked.
Required: IAM roles, instance profiles, Secrets Manager, or SSM Parameter Store.

Enforced by: `nist-access-control-gate.js`, `test-nist-compliance.sh`
