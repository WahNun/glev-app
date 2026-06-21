# Pre-Commit Policy

## TypeScript Check

Every commit triggers `pnpm tsc --noEmit` via a Husky pre-commit hook.

If the check fails: **fix the type errors** — do not bypass with `git commit --no-verify`.

`--no-verify` bypass is reserved for genuine emergencies (e.g. hotfix on outage). In all other cases TypeScript errors must be resolved before committing.

## GitHub Action Backup

`.github/workflows/typescript-check.yml` runs the same check on every push and PR targeting `main`. This catches any commits that slipped through with `--no-verify`.

To enforce this as a required status check: **GitHub → Repo Settings → Branches → main → Branch protection rules → Require status checks → add `typecheck`**.

## Background

Two consecutive Vercel build failures (PR #64 + follow-up hotfix) exposed that `--admin` bypass merges were letting TypeScript errors reach `main` undetected, keeping production on an old build for days.
