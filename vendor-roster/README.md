# Vendor roster artifact

The live roster Chase watches: **https://claude.ai/artifact/8xAhTcSmoeRmqzQLJ4UhXX**

Trigger: **"refresh the roster"** (or "where are we at on vendors").

Refreshing is three steps and nothing else. Same URL every time, so the link he
has bookmarked keeps working.

## 1. Pull

Run `roster.sql` against the Trainer Center project `tfneuzbhiqsdvnhhdfsw`,
with the event id set at the top. The anon key cannot read these tables, so this
goes through the Supabase MCP, not a local script.

## 2. Rewrite the data file

The page reads `roster-data.json` beside it. Only that file changes; the HTML
stays put. Shape:

```json
{
  "event": "Pokemon Event", "tagline": "Halloween",
  "date": "Sunday, October 25, 2026", "hours": "3:00 to 8:30 PM",
  "loadIn": "2:00 PM", "venue": "Venue to be announced",
  "fee": 100, "feeReturning": 75,
  "target": 30, "targetLabel": "card vendor tables",
  "pulled": "09.26.2026",
  "vendors": [
    { "name": "", "ig": "", "email": "", "phone": "", "kind": "Mixed",
      "state": "in", "paid": 75, "table": true, "note": "" }
  ]
}
```

- `state` is **in** (charged, confirmed), **comped** (no fee owed), or
  **nocard** (applied with a fee and never saved a card).
- `table` is true only for card vendors. **The 30 target counts card vendor
  tables only** — a character act or a drinks stand is on the floor but is not
  one of the thirty. Chase corrected this on 09.26.2026.
- `paid` is dollars actually charged, not the quoted fee.

## 3. Republish

Publish `vendor-roster.html` with `roster-data.json` alongside it, to the same
URL. Then tell him the numbers in a line or two: confirmed, collected, and how
far off the target.

## Next event

Change the header fields and the event id in the query. Nothing in the page is
specific to October.
