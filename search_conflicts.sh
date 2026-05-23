grep -r "<<<<<<<" . --include="*.md" > conflicts.txt
grep -r "<<<<<<<" .local/.commit_message >> conflicts.txt