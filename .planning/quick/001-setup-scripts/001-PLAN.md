# Quick-Start Setup Scripts

## Goal
Create idempotent `scripts/setup.sh` and `scripts/start-all.sh` for the boothapp project.

## Success Criteria
1. `setup.sh` checks prerequisites: node, aws cli, chrome
2. `setup.sh` installs npm dependencies for all components with package.json
3. `setup.sh` verifies AWS credentials work (hackathon profile)
4. `setup.sh` tests S3 bucket access
5. `setup.sh` prints summary of component status (installed/missing)
6. `start-all.sh` starts the watcher and background services
7. Both scripts are idempotent and safe to re-run
8. PR created to main branch
