#!/bin/bash
# Usage: bash scripts/complete-asana-task.sh TASK_GID
# Marks an Asana task as completed. Requires ASANA_PAT in environment.

TASK_GID=$1

if [ -z "$TASK_GID" ]; then
  echo "Error: no task GID provided. Usage: bash scripts/complete-asana-task.sh TASK_GID"
  exit 1
fi

RESULT=$(curl -s -X PUT "https://app.asana.com/api/1.0/tasks/$TASK_GID" \
  -H "Authorization: Bearer $ASANA_PAT" \
  -H "Content-Type: application/json" \
  -d '{"data": {"completed": true}}')

if echo "$RESULT" | grep -q '"completed":true'; then
  echo "✅ Asana task $TASK_GID marked as completed."
else
  echo "❌ Failed to complete task. Response: $RESULT"
  exit 1
fi
