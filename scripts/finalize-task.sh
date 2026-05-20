#!/bin/bash
# Usage: bash scripts/finalize-task.sh TASK_GID
#
# Commits the fix report, marks Asana task as done, posts report as comment.
# The report file must already exist at logs/replit/$(date +%Y%m%d)_${TASK_GID}.md

TASK_GID=$1
DATE=$(date +%Y%m%d)
REPORT_FILE="logs/replit/${DATE}_${TASK_GID}.md"

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
