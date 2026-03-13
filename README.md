# Alma 1 iCal (Thursdays)

This repository builds a static iCal feed for the Alma 1 restaurant menu on Thursdays.

## How it works
- A GitHub Actions workflow runs `scripts/build-ical.js`.
- The script fetches the Alma 1 menu page for upcoming Thursdays and extracts menu cards.
- The result is written to `public/alma.ics` and deployed to GitHub Pages.

## GitHub Pages setup
1. Push this repository to GitHub.
2. In GitHub: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Run the workflow once (Actions → Build and Deploy iCal → Run workflow).

The feed will be available at:
```
https://<your-username>.github.io/<repo-name>/alma.ics
```

## Configuration
You can override defaults in the workflow or locally with environment variables:
- `WEEKS_AHEAD` (default `12`)
- `TIMEZONE` (default `Europe/Brussels`)
- `WEEKDAY` (default `4` for Thursday)
- `START_DATE` (optional `YYYY-MM-DD`)

## Local run
```
node scripts/build-ical.js
```
