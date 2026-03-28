# BoothApp — AI-Powered Demo Capture & Follow-Up

## What This Is
System that captures everything during a trade show booth demo (Black Hat, Reinvent) and generates personalized AI follow-up for each visitor.

## Demo Deadline
**Wednesday, April 1, 2026**

## User Flow
1. Visitor walks up to booth. SE takes photo of their badge (Android app)
2. Badge photo -> OCR -> extract name -> create session ID
3. Session starts on demo PC: audio recording + Chrome extension (click tracking + screenshots)
4. SE gives demo in Vision One browser (or any web product)
5. SE tells visitor: "This session is tracked and we'll send you a summary"
6. Demo ends -> SE taps "End Session" on phone app
7. All session data uploads to AWS S3
8. Claude analyzes: audio transcript + screenshots + click data
9. AI generates personalized summary: what they saw, what interested them, recommended follow-up
10. SDR team gets alert -> reviews -> sends to visitor
11. Visitor gets emailed a link to their exact V1 tenant (preserved 30 days)

## Architecture

```
Android App          AWS S3/EC2           Demo PC
(badge photo)  --->  (session store)  <-- (audio + chrome ext + screenshots)
                          |
                     Claude Analysis
                          |
                     Output Package
                     (summary + screenshots + recommendations)
                          |
                     SDR Review -> Email to Visitor
                          |
                     V1 Tenant Link (preserved 30 days)
```

### Communication Flow
- App creates session -> writes to S3 (session ID + badge photo + name)
- Demo PC polls S3 every 1s for new session -> starts recording
- During session: PC polls every 5s for end-session command
- On end: PC uploads audio + click data + screenshots to S3
- Claude analysis triggers when all files arrive

## V1 Tenant Pool
Each visitor gets their own V1 tenant to keep exploring after the demo.

- 6 active (one per demo PC)
- 6 warming up (provisioning in background)
- 3 buffer (burst capacity)
- 15 total in pool at any time
- Tenant preserved 30 days after demo
- Auto-replenish: new tenant starts provisioning the moment one is claimed
- Must be battle-tested with load simulation before any conference

## Team — "Smells Like Machine Learning"
All members are equal collaborators.

| Name | Focus |
|------|-------|
| Casey Mondoux (MKT-NA) | Android app, web interface, presentation |
| Joel Ginsberg (TS-NA) | Chrome extension, audio capture, AWS infra, AI analysis |
| Tom Gamull (SE-NA) | App development (unavailable this week — wedding) |
| Kush Mangat (SE-NA) | Presentation, demo |
| Chris LaFleur (BD-NA) | V1 tenant provisioning, presentation |

## AWS
- **Profile:** `hackathon` (credentials in OS credential store, never in code)
- **Region:** us-east-1
- Never commit credentials to this repo

---

## Code Standards

### Modular, Reusable, Unix Philosophy
- Each component does ONE thing well
- Small files, clear interfaces, composable
- If a function is longer than 50 lines, split it
- If a module has more than one responsibility, split it
- Prefer stdin/stdout piping where possible
- Configuration via environment variables, not hardcoded values

### Branching & PRs
- **NEVER commit directly to main**
- Every change happens on a feature branch
- PRs are small and focused: one sub-step per PR (not the whole task)
- Good PR scope: "move button 5px left", "remove duplicate code", "add dark mode toggle"
- Bad PR scope: "build entire Chrome extension", "implement all audio features"
- Branch naming: `feature/<task-slug>/<substep-slug>`
- Auto-merge enabled

---

## Task System

**Dispatcher** (Teams poller) creates task files when someone @mentions Claude.
**Workers** (CCC pods) pick up tasks, plan sub-steps, and work through them.

Task files live in `.claude-tasks/` directory.

### Task File Format (created by dispatcher)
```json
{
  "id": "chrome-ext",
  "title": "Chrome Extension for Click Tracking",
  "description": "Build a Chrome extension that intercepts user clicks...",
  "requested_by": "Joel Ginsberg",
  "created_at": "2026-03-28T04:00:00Z",
  "branch": "feature/chrome-ext",
  "tag": "[A1]",
  "silent": false,
  "status": "pending",
  "assigned_worker": null,
  "substeps": []
}
```

Sub-steps are created by the WORKER, not the dispatcher.

---

## Worker Rules (CRITICAL)

### You Are Ephemeral
- You may be destroyed at any time. Another worker will replace you.
- **NEVER save notes, TODOs, or context locally.** You will lose it.
- **EVERYTHING goes in the shared repo** — task files, research notes, progress, blockers.
- If you learned something useful, write it to the relevant README or task file BEFORE doing anything else.
- Your successor must be able to pick up exactly where you left off by reading the repo alone.

### You Are Generic
- Workers are NOT specialized by area. Any worker can pick up any task.
- You determine what you need to know by reading the repo (CLAUDE.md, DATA-CONTRACT.md, workstream READMEs, task files).
- Do not assume you have any prior knowledge. Read everything first.

### Document Everything
- Research findings go in the task file `research_notes` field
- Sub-step progress goes in the task file `substeps` array
- Blockers go in the task file with `status: "blocked"` and `notes`
- Design decisions go in the workstream README
- API discoveries, gotchas, workarounds go in the workstream README
- **If it's not in the repo, it doesn't exist.**

## Worker Workflows

### New Task Pickup

1. **Claim** — Update task: `status: "in_progress"`, `assigned_worker: "<id>"`
2. **Research FIRST** — Before writing ANY code:
   - Scan all existing code in the repo
   - Google best practices for what you're building
   - Google existing libraries/tools that solve the problem
   - Google common pitfalls and edge cases
   - Document findings in the task file `research_notes` field
3. **Plan sub-steps** — Break the task into small atomic steps:
   ```json
   "substeps": [
     {"id": "manifest", "title": "Create extension manifest.json", "status": "pending", "pr": null, "notes": ""},
     {"id": "click-listener", "title": "Add click event listener", "status": "pending", "pr": null, "notes": ""}
   ]
   ```
4. **Work** — For each sub-step:
   - Branch: `feature/<task-slug>/<substep-slug>`
   - One focused change per PR
   - Update task file: sub-step `completed`, PR number recorded
5. **Close** — All sub-steps done -> `status: "completed"`

### Picking Up a Failed/Crashed Task

1. Read task file — check which sub-steps are `completed` (merged PRs)
2. Pull main — confirm completed code is actually merged
3. Claim — update `assigned_worker`
4. Find the failure point:
   - Sub-step marked `in_progress` with no PR = where previous worker crashed
   - Open unmerged PR = review it, fix or close and redo
5. Continue from first `pending` sub-step

### Reporting Blockers

1. Update sub-step: `status: "blocked"`, `notes: "description"`
2. Update task: `status: "blocked"`
3. Reply to Teams with blocker description
4. Release task (clear `assigned_worker`)

### Closing a Task

1. Verify ALL sub-steps `completed` and PRs merged
2. Update task: `status: "completed"`, `completed_at: "<timestamp>"`
3. Reply to Teams: "[tag] Merged to main [done]"
4. Clean up feature branches

### Task Statuses
- `pending` — waiting for worker
- `in_progress` — worker actively working
- `blocked` — needs human intervention
- `completed` — all done, all merged
- `failed` — unrecoverable, needs review
- `cancelled` — cancelled by user

---

## MVP Scope (for Wednesday demo)
- Badge photo -> session start (Android app or web form)
- Audio recording on demo PC
- Chrome extension: click tracking + screenshots
- Upload to S3
- Claude analysis -> summary output
- Show the summary

## NOT in MVP
- Video recording
- Dynamics CRM integration
- Automated email sending
- V1 tenant pool (demo with mock)
- Badge data merge with official scanners
