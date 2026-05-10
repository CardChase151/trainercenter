# Vendor Emails — Trainer Center HB

One-off & ad-hoc vendor email blasts. Personalized HTML drafts generated
per vendor based on profile completeness (logo / social), then sent through
Resend using the same account/domain as the rest of the site.

---

## Files

| File | Purpose |
|---|---|
| `generate.py` | Reads the hardcoded vendor list, writes one HTML draft per vendor under `drafts/group-{A,B,C,D}/{name}.html`. Idempotent — safe to re-run. |
| `send.py` | Reads each draft and sends via Resend. Has dry-run, test, and live modes. |
| `drafts/` | Generated HTML drafts (gitignored — regenerate from `generate.py`). |
| `drafts/manifest.md` | Generated table of all recipients, groups, subjects, file paths. |

---

## Vendor groups

| Group | Trigger | Subject |
|---|---|---|
| **A** | No logo + no social | `Action required: add a logo + social to your vendor profile` |
| **B** | Has social, missing logo | `Action required: add a logo to your vendor profile` |
| **C** | Has logo, missing social | `Action required: add a social handle to your vendor profile` |
| **D** | Has both | `Your vendor profile is set — quick note on why we asked` |

---

## RESEND_API_KEY — where it lives

The Resend API key for Trainer Center HB is mirrored across three places.
**Keep these in sync** when rotating.

1. **Supabase secret** in project `tfneuzbhiqsdvnhhdfsw`:
   ```bash
   supabase secrets set RESEND_API_KEY=... --project-ref tfneuzbhiqsdvnhhdfsw
   ```
   Used by Edge Function `send-vendor-email`.

2. **Netlify env var** on the trainercenter site (all contexts):
   ```bash
   cd ~/Apps/trainercenter && netlify env:set RESEND_API_KEY ...
   ```

3. **Local** `~/Apps/trainercenter/.env` (gitignored — dev/scripting only).
   `send.py` auto-reads from this file.

Verified sending domain on this Resend account: **`mysendz.com`**.
From-address pattern: `Trainer Center HB <noreply@mysendz.com>`.
Reply-to: `Trainercenter.pokemon@gmail.com`.

---

## Workflow

### 1. Refresh the vendor list (only when DB changes)

The list is currently hardcoded in `generate.py` to keep this script
standalone. To pull a fresh categorization from the live `vendors` table:

```sql
SELECT
  id, name, first_name, last_name, email, status,
  avatar_url IS NOT NULL AND avatar_url <> '' AS has_logo,
  ((ig_handle IS NOT NULL AND ig_handle <> '') OR
   (tiktok_handle IS NOT NULL AND tiktok_handle <> '') OR
   (fb_handle IS NOT NULL AND fb_handle <> '')) AS has_social
FROM vendors
WHERE status = 'approved'
ORDER BY name;
```

Update the `VENDORS` array at the top of `generate.py` and `send.py`.

**Always exclude staff**: Chef Lee (`mr.chef68@gmail.com`) and Chase's
admin profile (`thek2way17@gmail.com`). Chase's vendor row at
`chase@cardchase.org` IS a real CardChase vendor account and should be
included.

### 2. Generate drafts

```bash
cd ~/Apps/trainercenter/vendor-emails
python3 generate.py
```

Outputs to `drafts/group-{A,B,C,D}/{first}-{last}.html` plus a manifest.

### 3. Eyeball samples

```bash
open drafts/group-A/david-carrillo.html
open drafts/group-B/adria-sanchez.html
open drafts/group-C/caleb-aceves.html
open drafts/group-D/chase-kellis.html
```

### 4. Send

```bash
# Dry-run (no sends, prints recipients)
python3 send.py --dry-run

# Test mode — sends 4 (one per group) to a single inbox
python3 send.py --test thek2way17@gmail.com --no-bcc

# Live blast (asks for typed 'send' confirmation first)
python3 send.py
```

Other flags: `--only-group A`, `--no-bcc`.

The script rate-limits to ~1.8 req/sec (under Resend's 2/sec limit).
On every send it BCCs `chef@trainercenter.com` so Chef has the broadcast
in his own inbox as a record (skip with `--no-bcc`).

---

## Why we ask vendors for logo + social

It shows up on the public Vendor Day lineup pages (e.g.
`https://pokemontrainercenter.com/vendor-day?event=...`). That page is
the discovery surface for collectors who want to follow a vendor between
events. Without a logo + social handle, vendor cards show placeholders
that don't help build any following.

Vendors with both on file get bumped up in approval order for
upcoming events.
