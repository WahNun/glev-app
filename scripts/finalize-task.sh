#!/bin/bash
# Usage: bash scripts/finalize-task.sh TASK_GID [--ask "Question for Lucas?"] [option1] [option2] ...
#
# Commits the fix report, marks Asana task as done, posts report as comment.
# The report file must already exist at logs/replit/$(date +%Y%m%d)_${TASK_GID}.md
#
# Optional --ask flag:
#   Pass --ask "Your question?" to pause and ask Lucas a question via Telegram
#   before the final commit. The script prints the answer and continues.
#   If additional arguments follow the question, they are treated as numbered options.
#
#   Example:
#     bash scripts/finalize-task.sh 435 --ask "Soll ich A oder B wählen?" "Option A" "Option B"
#
#   Requires Replit Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
#                            SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#   If secrets are missing the question is skipped gracefully (SKIPPED is printed).

TASK_GID=$1
shift  # consume TASK_GID so remaining args can be parsed

DATE=$(date +%Y%m%d)
REPORT_FILE="logs/replit/${DATE}_${TASK_GID}.md"

# ─── Parse optional --ask flag ────────────────────────────────────────────────
ASK_QUESTION=""
ASK_OPTIONS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ask)
      shift
      ASK_QUESTION="$1"
      shift
      # Remaining args are numbered options for the question
      while [[ $# -gt 0 ]]; do
        ASK_OPTIONS+=("$1")
        shift
      done
      ;;
    *)
      shift
      ;;
  esac
done

if [ -z "$TASK_GID" ]; then
  echo "Error: TASK_GID required. Usage: bash scripts/finalize-task.sh TASK_GID [--ask \"Question?\"]"
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

# ─── Optional: ask Lucas a question before committing ────────────────────────
if [ -n "$ASK_QUESTION" ]; then
  echo ""
  echo "📨 Asking Lucas via Telegram (task $TASK_GID)…"
  LUCAS_ANSWER=$(node scripts/ask-telegram.mjs "$TASK_GID" "$ASK_QUESTION" "${ASK_OPTIONS[@]}")
  echo "💬 Lucas answered: $LUCAS_ANSWER"
  echo ""
  if [ "$LUCAS_ANSWER" = "TIMEOUT" ]; then
    echo "⚠️  No reply within 10 minutes — proceeding without answer."
  elif [ "$LUCAS_ANSWER" = "SKIPPED" ]; then
    echo "ℹ️  Telegram secrets not configured — question skipped."
  fi
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
