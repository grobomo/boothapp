# Plan: Comprehensive Architecture Document

## Goal
Create docs/ARCHITECTURE.md with a detailed architecture document suitable for hackathon judges.

## Success Criteria
1. System overview with ASCII art showing all components and data flow
2. Component descriptions (Chrome extension, audio recorder, transcriber, session orchestrator Lambda, analysis pipeline with Claude/Bedrock, watcher, presenter dashboard)
3. S3 data contract (sessions/<id>/ folder structure)
4. AWS infrastructure (S3, Lambda, Bedrock, EC2 fleet)
5. CCC fleet architecture (dispatcher, 85 workers, golden image, ECR)
6. Security model
7. Detailed enough for hackathon judges to understand the full system
