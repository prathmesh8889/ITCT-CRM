#!/usr/bin/env bash
# ============================================================
#  ITCT-CRM — push to https://github.com/prathmesh8889/ITCT-CRM.git
#  Run from the project root:  bash push.sh
# ============================================================
set -e
cd "$(dirname "$0")"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { git init; git branch -M main; }

git remote get-url origin >/dev/null 2>&1 || git remote add origin https://github.com/prathmesh8889/ITCT-CRM.git

git add -A
git commit -m "ITCT-CRM: React CRM + Node.js/Express/PostgreSQL backend (JWT, RBAC, automation, AI)" || true

if ! git push -u origin main; then
  echo ""
  echo "Push was rejected. If GitHub already has different history:"
  echo "  1) git pull origin main --rebase --allow-unrelated-histories && git push -u origin main"
  echo "  2) OR replace the remote history: git push -u origin main --force-with-lease"
  exit 1
fi

echo ""
echo "Done. Repository: https://github.com/prathmesh8889/ITCT-CRM"
