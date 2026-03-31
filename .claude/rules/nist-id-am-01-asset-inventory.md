# ID.AM-01 -- Asset Inventory

CloudFormation templates serve as infrastructure-as-code inventory.
S3 buckets, KMS keys, IAM roles defined declaratively in `cloudformation/`.
`test-nist-compliance.sh` verifies CloudFormation templates include encryption config.
All resources tagged and tracked through IaC.

Enforced by: `test-nist-compliance.sh` (CloudFormation validation)
