# TrainerCenter

## ACTIVE TICKET — Staff Event Manager (new vendor dashboard)

Rebuild of the staff-side vendor screen as a **parallel** surface so the old one
stays live for side-by-side comparison. Nothing on the existing `/staff/vendors`
page is touched. **No backend work** — every field below already exists.

New route: `/staff/events` (list) -> `/staff/events/:eventId/manage` (roster)

### Flow
1. Staff menu gets an **Events** button
2. `/staff/events` — list of Vendor Day events, each with at-a-glance counts
3. Click an event — vendors grouped: **Approved**, **Applied**, **Never applied**
   (plus a collapsed Declined/Cancelled group so nothing is lost)
4. Filters across all groups: paid / unpaid, favorite / not a fit, name search
5. Click a vendor — detail panel with the full picture + buttons into the
   existing modals (full profile, notes, fit status, survey results, collect fee)

### Steps
- [x] Recon: confirm every field exists, no migration needed
- [x] Write ticket
- [x] Step 1 — `/staff/events` event list screen
- [x] Step 2 — `/staff/events/:eventId/manage` grouped roster + filters
- [x] Step 3 — vendor detail panel + wire up existing modals
- [x] Step 4 — add Events to both staff nav surfaces (tile grid + dropdown)
- [x] Step 5 — build verified; warning set identical to before the change
- [ ] **WAITING ON CHASE** — not committed or pushed. Review side by side,
      then decide whether this replaces `/staff/vendors` or stays parallel

### Data already in place (no migration)
- `vendor_applications`: status, applied_at, decided_at/by, decision_note,
  vendor_note, requested_table_size, fee_cents, payment_status
  (none / card_pending / card_saved / charged / waived / refunded / failed),
  charged_amount_cents, receipt_url, confirmation_call_at, confirmed_at
- `vendors`: name, first/last, email, phone, ig/tiktok/fb, specialty, bio,
  tagline, avatar_url, status, staff_fit_status (favorite / not_a_fit),
  staff_fit_reason, staff_experience_rating, heard_from, referred_by_*
- `events`: title, event_date, has_vendors, table_fee_cents, vendor_start/end_time
- `vendor_attendance` (check-ins), `vendor_email_log`, `vendor_notes`,
  `vendor_event_surveys`

### Reused components
`VendorDetailModal`, `VendorNotesModal`, `FitStatusModal`,
`VendorSurveyResultsModal`, `TableFeeChargeModal`, `VendorAvatar`,
`VendorStatusBadge`, `PageWrapper`, `SectionHeader`

---

## Background (original build — complete)

Rebuilt the Squarespace site as a React web app. Live on Netlify.

### Logo Assets
- `logo.png` - Full logo
- `logo-square.png` - Square version
- `logo-transparent.png` - Transparent background
- `logo-circle.webp` - Circle pokeball-style "C" logo (red/black)
