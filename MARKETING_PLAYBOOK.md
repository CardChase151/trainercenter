# Marketing Playbook

Living doc capturing the Trainer Center HB marketing system as of 2026-04-30: who's on the contact list, what's running automatically right now, and the planned rollout of category-based email automation. Update as decisions get made.

---

## 1. Snapshot — Contacts

Single source: `public.marketing_contacts` (Supabase project `tfneuzbhiqsdvnhhdfsw`).

### Counts (as of 2026-04-30)

| Metric | Count |
|---|---|
| Total contacts | **3,171** |
| With email + currently subscribed | **250** |
| Square only | 3,148 |
| Site signups only | 22 |
| In both lists | 1 |
| Vendors (linked) | 21 |
| Members / guests (linked) | 4 |
| Admins (with auto-vendor row) | 3 |

### What each contact carries

| Field | What it means |
|---|---|
| `email`, `phone`, `first_name`, `last_name` | Identity (email is unique when set; phone-only and contact-less rows allowed for SMS-later) |
| `source` | Audit-only primary origin: `square` / `app_member` / `app_vendor` / `manual` |
| `from_square` | True if this contact is in the Square customer list (now or any past sync) |
| `from_site` | True if this contact signed up on the React site (vendor or guest) |
| `square_customer_id` | Links to the Square API row when applicable |
| `member_id` / `vendor_id` | FK links if they're also in the app role tables |
| `is_subscribed` | Master kill switch. False = unsubscribed from everything. |
| `subscriptions` | jsonb per-category state: `{vendor_day, store_news, events, blog}` |
| `unsubscribe_token` | Unique uuid that goes in every marketing email's unsubscribe link |
| `tags` | Open-ended `text[]` for future segmentation |

### Role visibility

`public.marketing_contacts_with_roles` view exposes `is_vendor`, `is_member`, `is_admin`, `has_email`, `has_phone` derived from joins back to `members`, `vendors`, and `profiles`. Use this view for any "send to admins+vendors only" type query.

### How contacts flow in

1. **Daily Square sync** (3am PT cron) — every customer that's added/updated in Square comes in with `from_square = true`. Existing rows have their flag preserved. Phone-only and contact-less customers are stored with `email IS NULL`.
2. **Site signup hook** — when someone completes vendor or guest onboarding, the `upsert_marketing_contact_from_app` RPC fires fire-and-forget. Sets `from_site = true`. Email match links the FK back to the existing row if Square already had them (`from_square` AND `from_site` both true after).
3. **Manual entry** — possible by admin via SQL; sets `source = 'manual'`. Not exposed in UI yet.

---

## 2. Snapshot — Automations currently running

### A. Square customer sync (daily)

- **Trigger**: `pg_cron` job `square-customer-sync-daily` at `0 10 * * *` (10:00 UTC = 3am PT)
- **Calls**: edge function `square-customer-sync`
- **Auth model**: cron passes the public anon JWT in the `Authorization` header. The edge function (verify_jwt=true) accepts it, then internally uses `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) for privileged DB ops. The Square access token lives in **Supabase Vault** (encrypted at rest); the function reads it via the SECURITY DEFINER RPC `get_square_access_token` (granted only to `service_role`).
- **What it does**: pulls Square customers updated since last sync watermark in `sync_state`, upserts via `bulk_upsert_square_customers` RPC, advances watermark on success only.
- **What it does NOT do**: never sends an email. Pure data ETL.

### B. Transactional emails (`send-vendor-email` edge function)

Always sent. Not subject to subscription preferences. Resend-backed. From address is **`Trainer Center HB <noreply@mysendz.com>`** (display name shows in mobile push notifications). No reply-to set — replies go nowhere on purpose, until Chef has bandwidth.

| Type | Fires when |
|---|---|
| `vendor_welcome` | Vendor finishes onboarding form |
| `vendor_profile_approved` | Chef approves vendor profile in admin |
| `member_welcome` / `guest_welcome` | Guest finishes onboarding form |
| `application_received` | Vendor applies for a Vendor Day (also notifies staff) |
| `application_decided` | Staff approves or declines a per-event application |
| `event_cancelled` | Staff cancels a Vendor Day; emails every applicant |

### C. Token-based unsubscribe page

- Route: `/unsubscribe?token=<uuid>`
- Backed by SECURITY DEFINER RPCs `lookup_marketing_contact_by_token`, `update_marketing_subscriptions`, `unsubscribe_marketing_contact`.
- Recipient sees per-category checkboxes. They can flip individual ones (vendor_day, events, store_news, blog) or click "Unsubscribe from everything".
- No login required — the token IS the credential.

### D. What is NOT automated yet

- **No marketing emails have ever been sent.** The list is fully cold.
- **No `send-marketing-email` function exists.**
- **No campaign cron.**
- **No event-creation triggered emails** (events can be created on the calendar but they don't notify anyone yet beyond `event_cancelled`).

---

## 3. The rollout plan

### The big idea

Don't blast 250 cold contacts with sales-y promo. Do a **single welcome email** that doubles as a consent moment — let people opt out (or fine-tune what they get) BEFORE any campaign starts. Then start sending category-based campaigns at a calm cadence.

### Order of operations

1. **Welcome email** — gentle, branded, explains what's coming and gives a one-click way to manage preferences. Sent once, in a staggered rollout (small batches across a couple days so we look like a real shop, not a spam blast). After this, the list is consent-cleansed.
2. **Vendor Day announcements** — first real campaign. Lower risk because the audience is pre-sold (people who shopped here, presumably some interest in cards/Pokemon).
3. **Other event categories** layered in — tournaments, trade nights, store news, new blog posts. One subject at a time, so we see what people open and what they unsubscribe from.
4. **Possibly switch to date-based** — instead of "vendor day announcement", a single "this week at Trainer Center HB" digest.

---

## 4. The welcome email concept

This is the most important send. Design notes:

### Tone

- Friendly, brief, personal. Reads like a note from the shop, not a marketing email.
- Acknowledges they shopped here at some point or signed up on the site.
- Sets expectations clearly: "starting next week, here's what you'll hear from us — all on by default, but you pick".

### Body (rough draft, not final)

```
Subject: A quick hello from Trainer Center HB — pick what you want to hear about

Hi [first_name],

Thanks for being part of the Trainer Center HB community over in Huntington
Beach. We just rebuilt the website (pokemontrainercenter.com) and we're
about to start sending the occasional update — Vendor Day reminders,
tournaments, store news, the kind of stuff you'd want to know if you stop
by the shop.

Starting next week, you'll start getting emails about:
  - Vendor Days (last Friday of every month)
  - Other events — tournaments, trade nights, set releases
  - Store news — hours, new arrivals, restocks
  - New blog posts and guides

We default everyone to ON for all four. Want only some of them, or none?
Pick what you want and we'll only send those:

  [ Manage your preferences ]   ← button → /unsubscribe?token=<uuid>

If you do nothing, we'll send all four (no more than ~once a week total).
You can change your mind any time via the link at the bottom of every email.

See you at the shop,
— Chef and the Trainer Center HB team

[Footer with shop address, unsubscribe link]
```

### What "Manage your preferences" should land on

Same `/unsubscribe?token=...` page that already exists. The page already does:
- Shows their email
- Four checkboxes (vendor_day, events, store_news, blog), all on by default
- "Save preferences" button → updates `subscriptions` jsonb
- "Unsubscribe from everything" button → flips `is_subscribed = false`

So no new UI work for the welcome email's CTA — the unsubscribe page IS the preferences page.

### Subject line candidates (decide before sending)

- "A quick hello from Trainer Center HB — pick what you want to hear about"
- "Trainer Center HB is back online — quick favor"
- "We're about to send some emails — pick which ones"

### Staggering

- 250 emails over 2-3 days, batched, business-hours only (PT)
- pg_cron fires the edge function in 50-email chunks every N hours
- Order randomized so it doesn't look alphabetical

### CAN-SPAM compliance check (worth verifying before send)

- ✅ Physical address in footer (4911 Warner Ave #210, Huntington Beach, CA 92649) — already in the wrapHtml template
- ✅ Clear sender ID — "Trainer Center HB" front and center
- ✅ Working unsubscribe link
- ✅ No deceptive subject line
- ✅ Sent from `noreply@mysendz.com` which IS a real domain on Resend (deliverable, just not a reply path)

---

## 5. Campaign ideas (post-welcome)

### By subject (current schema model)

The `subscriptions` jsonb on each contact has four keys, all on by default:

| Category | Frequency | Audience filter | Example sends |
|---|---|---|---|
| `vendor_day` | Monthly | Subscribed AND has email | "Vendor Day this Friday — here's the lineup" |
| `events` | As they come up (1-3/month?) | Subscribed AND has email | "Tournament next Saturday", "New set release party" |
| `store_news` | 1-2x/month | Subscribed AND has email | "We're closed Thanksgiving Day", "New inventory: vintage Japanese" |
| `blog` | As posts publish (~weekly?) | Subscribed AND has email | "New guide: how grading works" |

### By date (alternative or complement)

Maybe a single "This week at Trainer Center HB" digest replaces the four categories. One email per week that bundles whatever's relevant. Less noise, harder to segment.

Or hybrid: weekly digest by default, plus a reserved "Vendor Day" track that always fires whether or not someone's on the digest.

### Combination ideas worth thinking about

- **VIP vs casual**: Add a tag like `vip` to contacts who shopped recently or attended multiple Vendor Days. Send them earlier or richer emails.
- **Vendor-only stream**: vendors get a "your spot for this Friday" email separate from the public Vendor Day announcement. Already implicitly handled by transactional `application_decided` but could be richer.
- **Re-engagement**: contacts who haven't opened in 6+ months get one "still around?" email, then get auto-set to `is_subscribed = false` if they don't engage. Keeps the list clean.

---

## 6. Decisions still pending

Lock these before building campaign automation:

1. **Marketing audience for the welcome email**:
   - Everyone in `marketing_contacts` with email + subscribed (~250)
   - vs. only vendors + staff (~21)
   - vs. only Square contacts that have shopped recently (would need a "last seen" filter, no data for that yet)
2. **From address branding**:
   - Stay on `noreply@mysendz.com`?
   - Or set up `pokemontrainercenter.com` in Resend with SPF/DKIM/DMARC and send from `news@pokemontrainercenter.com`? (Bigger lift but lets the email visibly come from the shop's own domain.)
3. **Reply-to**:
   - Currently nothing — replies go nowhere.
   - When Chef is ready, add `Trainercenter.pokemon@gmail.com` as the reply-to.
4. **Subject + welcome copy** — pick the actual wording before sending.
5. **Staggering cadence** — 50/day for 5 days? 100/morning for 3 mornings? Pick one.
6. **Categories vs. weekly digest** — current schema supports four categories; we can simplify to a single digest later if it's noisy.

---

## 7. Safe-to-do now vs. needs setup

### Safe to do whenever

- Send any number of transactional emails (already wired)
- Add new transactional types to the existing `send-vendor-email` function (e.g., `event_created` notifying approved vendors)
- Add new categories to `subscriptions` jsonb — just append to the default
- Build the `send-marketing-email` edge function and the campaign cron — no DNS work needed; can keep using `noreply@mysendz.com`

### Needs setup before doing

- **Custom sending domain on `pokemontrainercenter.com`** — DNS records on the domain registrar (probably GoDaddy), Resend domain verification. Estimated 30-60 min once DNS access is available.
- **Reply-to inbox routing** — confirm someone is checking whatever address replies route to.
- **List warming for cold sends** — if we ever switch from `mysendz.com` to a fresh domain, send small batches to engaged users first to build reputation before blasting 250 cold.

### Future / nice-to-have

- "We recognize you from the shop" welcome touch when a Square customer signs up on the site
- Magic-link claim for Square customers to convert into auth.users without re-signup
- Resend webhook → log opens/clicks back into `email_log.meta`
- Admin UI at `/admin/contacts` to view, search, segment, export, blast

---

## 8. Open files that matter

Reference points if a future session needs to find things fast:

- `supabase/functions/send-vendor-email/index.ts` — transactional sender. Add new send types here.
- `supabase/functions/square-customer-sync/index.ts` — daily Square ETL.
- `supabase/migrations/20260430240000_marketing_contacts.sql` — base table + unsubscribe RPCs.
- `supabase/migrations/20260430250000_marketing_contacts_categories.sql` — per-category subscription state.
- `supabase/migrations/20260430260000_square_sync_state_and_cron.sql` — pg_cron schedule + sync_state table.
- `supabase/migrations/20260430270000_marketing_contacts_source_flags_and_roles.sql` — `from_square` / `from_site` booleans + `marketing_contacts_with_roles` view.
- `supabase/migrations/20260430280000_admin_as_vendor.sql` — admin auto-vendor backfill + trigger.
- `src/App.js` — `UnsubscribePage` component (token-based per-category preferences) + signup hooks that fire `upsert_marketing_contact_from_app`.
