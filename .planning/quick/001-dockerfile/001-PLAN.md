# 001 - Dockerfile and docker-compose.yml

## Goal
Create containerized deployment for boothapp with Dockerfile and docker-compose.yml at repo root.

## Success Criteria
1. Dockerfile uses node:20-slim base image
2. Copies package.json files and runs npm install for both root and presenter
3. Installs python3, pip, boto3, anthropic for analysis engine
4. Exposes ports 3000 (presenter) and 3001 (websocket)
5. CMD starts both presenter server and watcher
6. docker-compose.yml sets env vars (S3_BUCKET, AWS_REGION, USE_BEDROCK, ANALYSIS_MODEL)
7. docker-compose.yml mounts AWS credentials
8. Health check on /api/health (need to add health endpoint to presenter)
9. docker build succeeds without errors
