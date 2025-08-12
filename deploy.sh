#!/usr/bin/env bash
set -euo pipefail

GITHUB_REPO_DEFAULT="shekhug25/altaris-pro"
BRANCH_DEFAULT="main"

read -r -p "GitHub repo (owner/name) [${GITHUB_REPO_DEFAULT}]: " GITHUB_REPO
GITHUB_REPO="${GITHUB_REPO:-$GITHUB_REPO_DEFAULT}"

read -r -p "Git branch to push [${BRANCH_DEFAULT}]: " BRANCH
BRANCH="${BRANCH:-$BRANCH_DEFAULT}"

if [[ -z "${ALTARIS_PROJECT_REF:-}" ]]; then
  read -r -p "Supabase Project Ref (Settings → General): " ALTARIS_PROJECT_REF
fi

if [[ -z "${ALTARIS_SECRET:-}" ]]; then
  ALTARIS_SECRET=$(head -c 16 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  echo "Generated ALTARIS_SECRET: $ALTARIS_SECRET"
fi

if [[ -z "${ALTARIS_SLACK_WEBHOOK_URL:-}" ]]; then
  read -r -p "Slack webhook URL (optional): " ALTARIS_SLACK_WEBHOOK_URL || true
fi
if [[ -z "${ALTARIS_RESEND_API_KEY:-}" ]]; then
  read -r -p "Resend API key (optional): " ALTARIS_RESEND_API_KEY || true
fi

echo "=== Git push ==="
git add -A
if ! git diff --cached --quiet; then
  git commit -m "Deploy: v5.4 full app + notifications/CI"
else
  echo "No staged changes."
fi
git branch -M "$BRANCH" >/dev/null 2>&1 || true
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/${GITHUB_REPO}.git"
else
  git remote add origin "https://github.com/${GITHUB_REPO}.git"
fi
git push -u origin "$BRANCH"

echo "Actions: https://github.com/${GITHUB_REPO}/actions"

echo "=== Supabase function deploy ==="
if ! command -v supabase >/dev/null 2>&1; then
  echo "Installing Supabase CLI..."
  curl -fsSL https://cli.supabase.com/install/linux | sh
  export PATH="$HOME/.supabase/bin:$PATH"
fi

supabase --version || true
if ! supabase projects list >/dev/null 2>&1; then
  supabase login
fi

supabase link --project-ref "$ALTARIS_PROJECT_REF"

supabase functions secrets set ALTARIS_WEBHOOK_SECRET="$ALTARIS_SECRET"
[[ -n "${ALTARIS_SLACK_WEBHOOK_URL:-}" ]] && supabase functions secrets set SLACK_WEBHOOK_URL="$ALTARIS_SLACK_WEBHOOK_URL"
[[ -n "${ALTARIS_RESEND_API_KEY:-}" ]] && supabase functions secrets set RESEND_API_KEY="$ALTARIS_RESEND_API_KEY"

supabase functions deploy deal-stage-notify

FUNC_URL="https://${ALTARIS_PROJECT_REF}.functions.supabase.co/deal-stage-notify"

cat <<EOF

Create a Database Webhook in Supabase:

- Source: Table public.deals
- Events: UPDATE (filter: stage)
- URL: $FUNC_URL
- Header: x-altaris-secret: $ALTARIS_SECRET

EOF

read -r -p "Simulate webhook now (Active→Closing)? [y/N]: " RUN_TEST
if [[ "${RUN_TEST,,}" == "y" ]]; then
  curl -sS -X POST "$FUNC_URL"     -H "Content-Type: application/json"     -H "x-altaris-secret: $ALTARIS_SECRET"     --data '{"type":"UPDATE","table":"deals","schema":"public","record":{"id":1,"name":"Project Alpha","stage":"closing"},"old_record":{"id":1,"name":"Project Alpha","stage":"active"}}'
  echo
fi

echo "Done."
