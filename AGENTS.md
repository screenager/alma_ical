# Alma 1 iCal Feed (Thursdays)

This project builds and hosts a static iCal feed containing the Alma 1 restaurant menu for **Thursdays only**.

## What it does
- Scrapes the Alma 1 menu page for specific dates:
  - `https://www.alma.be/nl/restaurants/alma-1?date=YYYY-MM-DD`
- Extracts each menu card (`div.menucard`) and joins them into the event description.
- Generates a calendar with one **all‑day event** per Thursday.
- Writes output to `public/alma.ics`, which is deployed to GitHub Pages.

## Where the logic lives
- Scraper + iCal builder: `scripts/build-ical.js`
- Generated outputs: `public/alma.ics`, `public/meta.json`
- GitHub Pages workflow: `.github/workflows/pages.yml`

## Local run
```
node scripts/build-ical.js
```

## Configuration
Environment variables supported by `scripts/build-ical.js`:
- `WEEKS_AHEAD` (default `12`)
- `TIMEZONE` (default `Europe/Brussels`)
- `WEEKDAY` (default `4` for Thursday)
- `START_DATE` (optional `YYYY-MM-DD`)
- `CALENDAR_NAME` (default `Alma 1 Menu (Thursdays)`)

## Deployment
GitHub Actions builds and deploys to Pages:
- Scheduled: every Thursday at 06:00 UTC
- Manual trigger: `workflow_dispatch`

Feed URL after deployment:
```
https://<your-username>.github.io/<repo-name>/alma.ics
```

## Notes for agents
- Keep the feed Thursday‑only.
- Preserve `div.menucard` as the primary selector; fallback parsing exists for resilience.
- Avoid heavy dependencies; the script is plain Node.js (Node 20 on CI).
