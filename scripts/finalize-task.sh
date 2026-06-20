#!/bin/bash
# Usage: bash scripts/finalize-task.sh TASK_GID
#
# Commits the fix report, marks Asana task as done, posts report as comment.
# The report file must already exist at logs/replit/$(date +%Y%m%d)_${TASK_GID}.md

TASK_GID=$1

if [ -z "$TASK_GID" ]; then
  echo "Error: TASK_GID required. Usage: bash scripts/finalize-task.sh TASK_GID"
  exit 1
fi

if [ ! -f "$REPORT_FILE" ]; then
  echo "Error: Report file not found at $REPORT_FILE — write the report first."
  exit 1
fi

# Check that DECISIONS.md has an entry for this task
if ! grep -q "$TASK_GID" DECISIONS.md 2>/dev/null; then
  echo "Error: No entry for task $TASK_GID found in DECISIONS.md."
  echo "Add a row to the '## Fix Log' table in DECISIONS.md before finalizing."
  exit 1
fi

# ─── Architectural-boundary check ────────────────────────────────────────────
# Collect all files changed since the last commit (staged + unstaged).
CHANGED_FILES=$(
  git diff --name-only HEAD 2>/dev/null
  git diff --name-only --cached 2>/dev/null
)

# Patterns that indicate an architectural decision may have been made.
ARCH_PATTERNS=(
  "^supabase/"
  "capacitor\.config\."
  "(^|/)middleware\.ts$"
  "^lib/emails/"
  "next\.config\."
  "^\.github/workflows/"
  "^pnpm-workspace\.yaml$"
  "^package\.json$"
)

ARCH_HIT=""
for pattern in "${ARCH_PATTERNS[@]}"; do
  if echo "$CHANGED_FILES" | grep -qE "$pattern"; then
    ARCH_HIT="$ARCH_HIT\n  $(echo "$CHANGED_FILES" | grep -E "$pattern" | head -3)"
  fi
done

if [ -n "$ARCH_HIT" ]; then
  echo ""
  echo "⚠️  Architectural-boundary files were modified in this task:"
  echo -e "$ARCH_HIT"
  echo ""
  echo "   → Does this change warrant a new D-XXX entry in DECISIONS.md?"
  echo "     Use the self-assessment checklist in replit.md § 'Agent Workflow Rules'."
  echo "     If yes: add the entry now and re-run finalize-task.sh."
  echo "     If no: this is just a reminder — finalization continues."
  echo ""
fi
# ─────────────────────────────────────────────────────────────────────────────

# Commit and push
git add "$REPORT_FILE" DECISIONS.md
git commit -m "ops: fix report — task $TASK_GID"
git push origin main

# Mark Asana task as done
curl -s -X PUT "https://app.asana.com/api/1.0/tasks/$TASK_GID" \
  -H "Authorization: Bearer $ASANA_PAT" \
  -H "Content-Type: application/json" \
  -d '{"data": {"completed": true}}' > /dev/null

# Post report as Asana comment
REPORT_CONTENT=$(cat "$REPORT_FILE")
ESCAPED=$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' <<< "$REPORT_CONTENT")
curl -s -X POST "https://app.asana.com/api/1.0/tasks/$TASK_GID/stories" \
  -H "Authorization: Bearer $ASANA_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"data\": {\"text\": $ESCAPED}}" > /dev/null

echo "✅ Done. Report committed, Asana task $TASK_GID marked complete."
