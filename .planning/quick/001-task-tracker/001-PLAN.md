# Feature Task Tracker

## Goal
Add a feature task tracker page to the boothapp presenter that shows the development status of Casey's feature document tasks being worked on by the CCC worker fleet. This closes the loop on GitHub issue #34 (task submission failure) by giving the team visibility into submitted tasks.

## Success Criteria
1. New `feature-tasks.html` page in presenter/ shows 5 submitted features with status
2. Page auto-refreshes every 30s to show latest PR/development status
3. Tasks page accessible from nav and directly at /feature-tasks.html
4. API endpoint `/api/feature-tasks` returns task list with status derived from GitHub PRs
5. Existing tests pass, new endpoint has a test
