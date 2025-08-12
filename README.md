[![CI](https://github.com/shekhug25/altaris-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/shekhug25/altaris-pro/actions/workflows/ci.yml)

# Altaris — v5.4 (Full App + Notifications + CI)

- Dark UI pipeline for deals (Preliminary → Active → Approval → Closing → Asset Mgmt, with Rejected)
- Funds participation per deal
- Charts (Stage bar, Type doughnut)
- CSV Import/Export
- Supabase Edge Function for notifications (Active → Closing)
- GitHub Actions CI + PR checklist
- Optional Demo Mode (no DB)

## Setup
1) Edit `config.js` with your Supabase Project URL + anon key.  
2) Open `index.html` locally or deploy to Netlify (publish dir `/`).

## Notifications
See `supabase/functions/deal-stage-notify/` and set secrets via Supabase CLI. Create a Database Webhook to POST to the function.

## Demo Mode
Set `window.DEMO_MODE=true` in `config.js` to try the UI without Supabase.

## Deploy helper
Run `./deploy.sh` to:
- push to GitHub
- deploy Edge Function
- print Webhook URL + header
- (optional) simulate a test POST
