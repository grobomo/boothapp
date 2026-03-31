# 001-PLAN: Makefile for BoothApp

## Goal
Create a Makefile at boothapp repo root with common commands for install, start/stop services, test, demo, analyze, clean, docker, and deploy.

## Success Criteria
1. `make help` lists all targets with descriptions
2. `make install` runs npm install in root and presenter/
3. `make start` starts watcher and presenter as background processes
4. `make stop` kills running watcher and presenter processes
5. `make test` runs all test suites from root package.json
6. `make test-e2e` runs scripts/test/test-demo-pipeline.sh
7. `make demo` generates and uploads a sample session
8. `make analyze SESSION=<id>` triggers analysis for a session
9. `make clean` removes node_modules, output artifacts, logs
10. `make docker-build` builds Docker image
11. `make docker-run` runs Docker container
12. `make deploy` deploys to production (SAM/CloudFormation)
13. All targets use .PHONY
