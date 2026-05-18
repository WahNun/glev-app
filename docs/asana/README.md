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
