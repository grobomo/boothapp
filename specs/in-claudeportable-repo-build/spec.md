All three spec-kit artifacts are written:

```
specs/dispatcher-brain/
  spec.md    # 594 lines -- problem, solution, key decisions, 10 success criteria
  plan.md    # 8-step implementation plan with dependency order + risk matrix
  tasks.md   # 11 tasks across 5 phases, each with PR title + checkpoint
```

The spec replaces three cold `claude -p` subprocess calls with a single persistent Anthropic API conversation that learns from every task outcome. Key components: `brain/conversation.py` (persistent session), `brain/fleet.py` (weighted worker scoring), `brain/blockers.py` (escalation search), `brain/context.py` (system prompt builder), `brain/storage.py` (JSONL/JSON persistence). Integration into `git-dispatch.py` keeps `spec-generate.sh` as fallback if the brain fails.
