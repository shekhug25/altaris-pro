# Altaris — Pro v5.3.1 (Supabase + Funds + Charts) — CSV Import/Export + Templates

This version clarifies **name-to-ID matching** for imports and includes sample CSVs.

## Import formats

### deals.csv (minimum headers)
- `name` (required)
- `deal_type` (DirectLending | Secondary | CoInvest | RealEstate)
- `stage` (preliminary | active | approval | closing | asset_management | rejected) — defaults to preliminary
- Optional: `source`, `currency`, `size_m`, `sector`

### deal_funds.csv (one of)
- `deal_id` **or** `deal_name`
- `fund_id` **or** `fund_name`
- Optional: `role` (Lead/Co-Lead/Participant), `status` (Proposed/SoftCircled/Committed/Closed), `commitment_m`, `notes`

**Matching rules (v5.3.1):**
- If `deal_name` is provided, we find its `id` (case-insensitive). Same for `fund_name`.
- You may leave `deal_id` and `fund_id` blank when using names.
- If a name isn’t found, the row is **skipped** (we do **not** create new deals/funds). A success count is shown after import.

Find examples in:
- `sample-deals.csv`
- `sample-deal_funds.csv`

## Export
Use **Export CSVs** to download:
- `deals-<timestamp>.csv`
- `deal_funds-<timestamp>.csv`

## Setup
1) In `config.js`, paste your Supabase **Project URL** and **Anon Key** (client-side public key).
2) Open `index.html` via a tiny local server (e.g., `python3 -m http.server 8000`) or deploy to Netlify.

## Push to GitHub (new repo)
```bash
# from this folder
git init
git branch -M main
git add .
git commit -m "Altaris Pro v5.3.1 — Import/Export + templates + docs"
git remote add origin https://github.com/<your-username>/altaris-pro.git
git push -u origin main
```

## Update an existing repo
```bash
git pull --rebase origin main   # get latest
git add .
git commit -m "Update to v5.3.1: clearer import docs + templates"
git push
```

## Netlify (auto-deploy from GitHub)
1. Go to app.netlify.com → **Add new site** → **Import from Git**.
2. Pick your GitHub repo.
3. Build command: *(leave empty)*; Publish directory: `/`.
4. Deploy.

> **Security note:** Keep only the **anon** key in `config.js`. Never put your Supabase **service role** key in the frontend or repo.
