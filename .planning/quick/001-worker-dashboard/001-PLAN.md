# Worker Dashboard

## Goal
Add a "Workers" section to the presenter dashboard showing active CCC workers and their current PR assignments, sourced from `.claude-tasks/*.json` task files in S3.

## Success Criteria
1. Dashboard page displays a list of all workers (from task files)
2. Each worker entry shows: task ID, task title, status, assigned worker ID, current substep, and active PR link
3. Auto-refreshes on an interval (consistent with existing dashboard pattern)
4. Matches existing dark theme styling
5. Accessible from the main presenter dashboard navigation
