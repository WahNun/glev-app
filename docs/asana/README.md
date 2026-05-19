# Asana Sprint Snapshot

This folder holds a snapshot of all "Glev — Sprint X:" projects from Asana so the
agent (and you) can quickly see the current sprint state without writing ad-hoc
API calls.

- `sprints.json` — raw snapshot (one entry per sprint, tasks with `gid`, `name`,
  `due_on`, `completed`, `assignee`, `section`, `notes`).
- `sprints.md` — human-readable Markdown grouped by sprint, with a counter and
  an overdue highlight for any open ticket whose due date is in the past.

## Setup

1. Create a Personal Access Token at https://app.asana.com/0/my-apps.
2. Add it to **Replit Secrets** as `ASANA_PAT`. Vercel/Production does **not**
   need this token — Asana has nothing to do with production.

## Refresh

```bash
pnpm asana:sync                       # only open tickets (default)
pnpm asana:sync -- --include-completed  # include completed tickets too
```

Re-run whenever you want a fresh sprint view (e.g. start of a planning session,
after moving tickets in Asana, or before asking the agent to reason about sprint
state). The script is idempotent — it overwrites both files cleanly.

## Auto-refresh

A GitHub Actions workflow (`.github/workflows/refresh-asana-snapshot.yml`) runs
`pnpm asana:sync` **once per day** (06:17 UTC) and commits any changes to
`docs/asana/sprints.{json,md}` back to `main`. So in normal use the snapshot is
already at most ~24 h old when you start a session — no manual refresh needed.

You can also trigger an on-demand refresh from GitHub → Actions → "Refresh Asana
sprint snapshot" → **Run workflow**.

Requirements:

- Repo secret `ASANA_PAT` (same token shape as the Replit Secret).
- Settings → Actions → General → Workflow permissions set to "Read and write
  permissions" so the job can push the snapshot commit back to `main`.
