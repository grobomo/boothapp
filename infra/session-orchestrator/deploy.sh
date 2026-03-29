#!/usr/bin/env bash
# Deploy session orchestrator as an AWS Lambda function.
#
# Prerequisites:
#   S3_BUCKET        — session storage bucket (from inf-01)
#   LAMBDA_ROLE_ARN  — IAM role ARN (first deploy only)
#
# Optional:
#   LAMBDA_FUNCTION_NAME  (default: boothapp-session-orchestrator)
#   AWS_REGION            (default: us-east-1)
#   AWS_PROFILE           (default: hackathon)
set -euo pipefail

FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-boothapp-session-orchestrator}"
S3_BUCKET="${S3_BUCKET:?S3_BUCKET env var required}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-hackathon}"
RUNTIME="nodejs20.x"
TIMEOUT=30

echo "==> Installing production dependencies"
npm ci --omit=dev

echo "==> Building deployment package"
zip -r function.zip index.js orchestrator.js s3.js tenant-pool.js node_modules/ package.json

echo "==> Checking if Lambda function exists"
if aws lambda get-function \
    --function-name "$FUNCTION_NAME" \
    --region "$AWS_REGION" \
    --profile "$PROFILE" \
    --query 'Configuration.FunctionName' \
    --output text 2>/dev/null; then

  echo "==> Updating function code"
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://function.zip \
    --region "$AWS_REGION" \
    --profile "$PROFILE"

  echo "==> Waiting for update to complete"
  aws lambda wait function-updated \
    --function-name "$FUNCTION_NAME" \
    --region "$AWS_REGION" \
    --profile "$PROFILE"

  echo "==> Updating environment variables"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "Variables={S3_BUCKET=$S3_BUCKET,AWS_REGION=$AWS_REGION}" \
    --region "$AWS_REGION" \
    --profile "$PROFILE"
else
  ROLE_ARN="${LAMBDA_ROLE_ARN:?LAMBDA_ROLE_ARN required for first deploy}"
  echo "==> Creating new Lambda function"
  aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime "$RUNTIME" \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --role "$ROLE_ARN" \
    --timeout "$TIMEOUT" \
    --environment "Variables={S3_BUCKET=$S3_BUCKET,AWS_REGION=$AWS_REGION}" \
    --region "$AWS_REGION" \
    --profile "$PROFILE"

  echo "==> Creating Lambda Function URL (no auth — rely on token in API layer)"
  aws lambda create-function-url-config \
    --function-name "$FUNCTION_NAME" \
    --auth-type NONE \
    --region "$AWS_REGION" \
    --profile "$PROFILE"
fi

echo "==> Cleaning up"
rm -f function.zip

echo ""
echo "Done! Function: $FUNCTION_NAME (region: $AWS_REGION)"
echo "To get the Function URL:"
echo "  aws lambda get-function-url-config --function-name $FUNCTION_NAME --region $AWS_REGION --profile $PROFILE"
