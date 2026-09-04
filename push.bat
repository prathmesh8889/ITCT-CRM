@echo off
REM ============================================================
REM  ITCT-CRM — push to https://github.com/prathmesh8889/ITCT-CRM.git
REM  Run from the project root (double-click works too).
REM  Windows may open a browser to sign in to GitHub — that's normal.
REM ============================================================
cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  git init
  git branch -M main
)

git remote get-url origin >nul 2>&1
if errorlevel 1 git remote add origin https://github.com/prathmesh8889/ITCT-CRM.git

git add -A
git commit -m "ITCT-CRM: React CRM + Node.js/Express/PostgreSQL backend (JWT, RBAC, automation, AI)" >nul 2>&1

git push -u origin main
if errorlevel 1 (
  echo.
  echo ---------------------------------------------------------------
  echo Push was rejected. If GitHub already has different history:
  echo   1) Merge it first:
  echo      git pull origin main --rebase --allow-unrelated-histories
  echo      git push -u origin main
  echo   2) OR replace the remote history (destroys old remote commits):
  echo      git push -u origin main --force-with-lease
  echo ---------------------------------------------------------------
)
echo.
echo Done. Repository: https://github.com/prathmesh8889/ITCT-CRM
pause
