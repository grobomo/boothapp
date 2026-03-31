# Workstream A: Chrome Extension (V1-Helper)

## Owner Pool
CCC workers assigned to `extension/` only touch files in this directory.

## What This Does
Chrome extension that runs on the demo PC browser during booth demos.
Captures every click + silent screenshots. Uploads to S3 when session ends.

## Base
Forked from Blueprint Extra MCP extension + V1EGO click tracking.
Rebranded as "V1-Helper" with TrendAI logo.

## Outputs (to S3 session folder)
- `clicks/clicks.json` — see DATA-CONTRACT.md for schema
- `screenshots/*.jpg` — JPEG quality 60, on-click + periodic

## Inputs (from S3 session folder)
- `metadata.json` — reads session_id, started_at to know when to start/stop

## Tasks
See `.claude-tasks/` for task files prefixed with `ext-`

## Key Decisions
- Blueprint MCP relay must keep working (all 30 tools)
- Silent screenshots — no flash, no delay, no UI artifacts
- Batch upload on session end, not per-click
- Must work on V1 console (iframes!) and any other web product
