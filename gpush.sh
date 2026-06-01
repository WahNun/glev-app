#!/bin/bash
git pull --rebase origin main
git rebase --skip 2>/dev/null
true
git push origin main
