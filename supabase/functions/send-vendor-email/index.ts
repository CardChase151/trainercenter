// Edge Function: send-vendor-email
// Resend-backed transactional emails for the vendor + member system.
//
// Types:
//   - vendor_welcome              (vendor finishes onboarding)
//   - vendor_profile_approved     (Chef approves the vendor profile; "you're approved, now pick your dates")
//   - vendor_event_invite_urgent  (admin blast: invite all approved vendors who haven't applied for a specific event)
//   - vendor_event_day_reminder   (admin blast: morning-of "tonight's the night" reminder to approved lineup)
//   - customer_appreciation       (admin blast: marketing email to a single marketing_contacts row)
//   - member_welcome              (member finishes onboarding)
//   - application_received        (vendor applies for an event)
//   - application_decided         (staff approves/declines an event application)
//   - event_cancelled             (staff cancels a Vendor Day; emails every applicant)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

// RESEND_API_KEY — stored as a Supabase secret on this project (tfneuzbhiqsdvnhhdfsw).
// Mirror locations (keep in sync when rotating):
//   - Supabase secret: supabase secrets set RESEND_API_KEY=... --project-ref tfneuzbhiqsdvnhhdfsw
//   - Netlify env:     cd ~/Apps/trainercenter && netlify env:set RESEND_API_KEY ...
//   - Local dev:       ~/Apps/trainercenter/.env (gitignored)
// See ~/Apps/trainercenter/vendor-emails/README.md for the full workflow.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
// Display name is intentionally quoted (RFC 5322 quoted-string form). Zoho
// strips unquoted display names with spaces; Gmail/Outlook accept either.
const FROM_ADDRESS = '"Trainer Center HB" <noreply@mysendz.com>'
// Staff notification recipients. Curated list only — do NOT replace this
// with a profiles.is_admin lookup. Seth is intentionally excluded; he
// doesn't want these on his inbox.
const STAFF_EMAILS = ['Trainercenter.pokemon@gmail.com', 'chase@cardchase.org']
const SITE_URL = 'https://pokemontrainercenter.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

type Payload = {
  type: 'vendor_welcome' | 'vendor_profile_approved' | 'vendor_event_invite_urgent' | 'vendor_event_day_reminder' | 'customer_appreciation' | 'member_welcome' | 'application_received' | 'application_decided' | 'event_cancelled' | 'vendor_broadcast' | 'marketing_contacts_broadcast' | 'vendor_optout_notify' | 'express_link_reminder'
  apology?: boolean
  vendor_id?: string
  vendor_ids?: string[]
  member_id?: string
  contact_id?: string
  application_id?: string
  event_id?: string
  reason?: string
  is_first_time?: boolean
  // 'vendor_optout_notify': flag separates pre-application opt-out from
  // post-approval cancellation so the staff email reads at the right
  // urgency. 'reason' carries the vendor's note (required for cancel,
  // optional for opt-out).
  optout_kind?: 'not_interested' | 'vendor_cancelled'
  // Fields used by 'vendor_broadcast': flexible Chef-composed comms blast
  audience?: 'all' | 'approved_all' | 'pending_all' | 'approved_not_applied' | 'applied_any' | 'approved_for_event' | 'pending_for_event'
  subject?: string
  body_html?: string
  body_text?: string
  attach_event?: boolean
  // 'marketing_contacts_broadcast' uses the staff_audience_emails RPC to
  // resolve recipients server-side. The frontend builds this jsonb from the
  // /staff/comms picker (population, sub filters, role gates).
  audience_spec?: Record<string, unknown>
}

async function sendResendEmail(to: string[], subject: string, html: string, text: string, bcc?: string[]) {
  if (!RESEND_API_KEY) {
    console.log('[send-vendor-email] RESEND_API_KEY not set; skipping send')
    return { skipped: true }
  }
  const body: Record<string, unknown> = { from: FROM_ADDRESS, to, subject, html, text }
  if (bcc && bcc.length > 0) body.bcc = bcc
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('[send-vendor-email] resend error', err)
    throw new Error(`resend: ${err}`)
  }
  return await res.json()
}

function formatEventDate(eventDate: string) {
  const d = new Date(eventDate + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// "18:00:00" → "6 PM", "18:30:00" → "6:30 PM". Used in vendor-facing emails so
// vendors see the vendor window (events.vendor_start_time / vendor_end_time),
// which can differ from the public event window.
function formatTime12h(t: string | null | undefined) {
  if (!t) return ''
  const [h, m] = t.slice(0, 5).split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return m === '00' ? `${h12} ${ampm}` : `${h12}:${m} ${ampm}`
}

// Build a vendor-facing time line for an event: prefers vendor_start_time/
// vendor_end_time, falls back to start_time/end_time. Returns "" if neither
// pair is present.
function vendorTimeLine(ev: { start_time?: string|null; end_time?: string|null; vendor_start_time?: string|null; vendor_end_time?: string|null }) {
  const s = ev.vendor_start_time || ev.start_time
  const e = ev.vendor_end_time || ev.end_time
  if (!s && !e) return ''
  return `${formatTime12h(s)} - ${formatTime12h(e)}`
}

function wrapHtml(inner: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
      <tr><td style="background:#C8102E;padding:24px 32px;text-align:center">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.01em">Trainer Center HB</h1>
        <p style="margin:4px 0 0;color:#fbb;font-size:12px">California's Pokemon-only shop</p>
      </td></tr>
      <tr><td style="padding:32px">${inner}</td></tr>
      <tr><td style="background:#f5f5f5;padding:16px 32px;text-align:center">
        <p style="font-size:11px;color:#888;margin:0">4911 Warner Ave #210 · Huntington Beach, CA 92649 · (714) 951-9100</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )

  let payload: Payload
  try {
    payload = await req.json() as Payload
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  const { type } = payload
  if (!type) return json({ error: 'type required' }, 400)

  try {
    if (type === 'vendor_welcome') {
      if (!payload.vendor_id) return json({ error: 'vendor_id required' }, 400)
      const { data: v, error: vErr } = await supabase.from('vendors').select('*').eq('id', payload.vendor_id).single()
      if (vErr || !v) return json({ error: vErr?.message || 'vendor not found' }, 404)
      const subject = 'Welcome to Trainer Center HB vendors'
      const body = `<p>Hi ${v.name},</p>` +
        `<p>Your vendor profile is in. The Trainer Center HB team will personally review it before approving you. Once approved, you can apply for any upcoming TC's Beach City Trade Night in two clicks from your dashboard.</p>` +
        `<p><strong>Cadence:</strong> last Friday of every month at the shop.</p>` +
        `<p>While you wait, drop by Trainer Center HB or follow <a href="https://instagram.com/trainercenter.pokemon" style="color:#C8102E">@trainercenter.pokemon</a> on Instagram.</p>` +
        `<p style="margin-top:24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a></p>`
      await sendResendEmail([v.email], subject, wrapHtml(body), `Welcome to Trainer Center HB vendors, ${v.name}!\n\nDashboard: ${SITE_URL}/vendors/dashboard`)

      // Staff notification: new partner application landed. Previously this
      // flow only emailed the vendor, leaving Chef + Chase blind to new
      // signups until they noticed the row in /staff/vendors. Now every
      // partner application pings the whole staff list.
      const staffSubject = `New partner application: ${v.name}`
      const staffBody =
        `<p><strong>${v.name}</strong> just applied to become a Trainer Center HB vendor partner.</p>` +
        `<p style="font-size:13px;color:#444">${v.email}${v.phone ? ' · ' + v.phone : ''}<br/>` +
        `${v.specialty ? 'Specialty: ' + v.specialty + '<br/>' : ''}` +
        `${v.ig_handle ? 'IG: @' + v.ig_handle + '<br/>' : ''}` +
        `${v.tiktok_handle ? 'TikTok: @' + v.tiktok_handle + '<br/>' : ''}` +
        `${v.fb_handle ? 'FB: ' + v.fb_handle + '<br/>' : ''}` +
        `${v.experience_level ? 'Experience: ' + String(v.experience_level).replace(/_/g, ' ') + '<br/>' : ''}` +
        `${v.heard_from ? 'Heard from: ' + String(v.heard_from).replace(/_/g, ' ') + '<br/>' : ''}` +
        `${v.referred_by_name ? 'Referred by: <strong>' + v.referred_by_name + '</strong>' + (v.referred_by_handle ? ' (@' + v.referred_by_handle + ')' : '') + (v.referred_by_contact ? ' · ' + v.referred_by_contact : '') + '<br/>' : ''}` +
        `</p>` +
        (v.bio ? `<p>${v.bio}</p>` : '') +
        (v.applicant_questions ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:6px"><p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#92400e;letter-spacing:0.06em">QUESTIONS FOR CHEF</p><p style="margin:0;font-size:14px;color:#1f2937;line-height:1.5;white-space:pre-wrap">${v.applicant_questions}</p></td></tr></table>` : '') +
        `<p style="margin-top:24px"><a href="${SITE_URL}/staff/vendors" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Review in admin</a></p>`
      const staffText = `${staffSubject}\n\nName: ${v.name}\nEmail: ${v.email}\n${v.phone ? `Phone: ${v.phone}\n` : ''}${v.ig_handle ? `IG: @${v.ig_handle}\n` : ''}${v.specialty ? `Specialty: ${v.specialty}\n` : ''}${v.experience_level ? `Experience: ${String(v.experience_level).replace(/_/g, ' ')}\n` : ''}${v.referred_by_name ? `Referred by: ${v.referred_by_name}\n` : ''}\nReview: ${SITE_URL}/staff/vendors`
      await sendResendEmail(STAFF_EMAILS, staffSubject, wrapHtml(staffBody), staffText)

      return json({ ok: true, sent: ['vendor', 'staff'] })
    }

    if (type === 'vendor_profile_approved') {
      if (!payload.vendor_id) return json({ error: 'vendor_id required' }, 400)
      const { data: v, error: vErr } = await supabase.from('vendors').select('*').eq('id', payload.vendor_id).single()
      if (vErr || !v) return json({ error: vErr?.message || 'vendor not found' }, 404)
      const subject = "Action required: You're a Trainer Center HB vendor — pick your dates"
      const body =
        `<p style="font-size:15px;color:#16a34a;font-weight:700;margin:0 0 4px">✓ Approved as a vendor partner</p>` +
        `<p style="margin:0 0 20px">Hi ${v.name},</p>` +
        `<p style="margin:0 0 24px">You're now a recognized Trainer Center HB vendor partner. Welcome.</p>` +
        `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px"><tr><td style="background:#fef3c7;border-left:4px solid #f59e0b;padding:18px 22px;border-radius:6px">` +
        `  <p style="margin:0 0 8px;font-size:13px;font-weight:800;color:#92400e;letter-spacing:0.04em">⚠  YOU'RE NOT DONE YET</p>` +
        `  <p style="margin:0;color:#1f2937;font-size:14px;line-height:1.5">Being approved as a partner does <strong>not</strong> put you on a TC's Beach City Trade Night automatically. You still need to pick which dates you want to be at.</p>` +
        `</td></tr></table>` +
        `<p style="margin:0 0 12px;font-weight:700">Each TC's Beach City Trade Night requires a quick per-event sign-up:</p>` +
        `<ol style="margin:0 0 24px;padding-left:20px;color:#444;font-size:14px;line-height:1.7">` +
        `  <li>Open your dashboard</li>` +
        `  <li>Pick the dates you want</li>` +
        `  <li>Trainer Center HB confirms each one within a day or two</li>` +
        `</ol>` +
        `<p style="margin:24px 0;text-align:center"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Pick your dates  →</a></p>` +
        `<p style="margin:28px 0 0;font-size:13px;color:#666;border-top:1px solid #eee;padding-top:16px">TC's Beach City Trade Night happens the last Friday of every month at the shop. Custom dates show up on the dashboard too.</p>`
      const text = `Action required: You're a Trainer Center HB vendor — pick your dates\n\n` +
        `Hi ${v.name},\n\n` +
        `You're now a recognized Trainer Center HB vendor partner. Welcome.\n\n` +
        `YOU'RE NOT DONE YET — being approved as a partner does NOT put you on a TC's Beach City Trade Night automatically. You still need to pick which dates you want to be at.\n\n` +
        `Each event requires a quick per-event sign-up:\n` +
        `  1. Open your dashboard\n` +
        `  2. Pick the dates you want\n` +
        `  3. Trainer Center HB confirms each one within a day or two\n\n` +
        `Pick your dates: ${SITE_URL}/vendors/dashboard\n\n` +
        `TC's Beach City Trade Night happens the last Friday of every month at the shop.`
      await sendResendEmail([v.email], subject, wrapHtml(body), text)
      return json({ ok: true, sent: ['vendor'] })
    }

    if (type === 'vendor_event_invite_urgent') {
      // Admin-triggered: invite all approved vendors who haven't applied for the
      // given event yet. Used for the May 1 backfill (vendors approved before
      // the partnership-approved email existed) and reusable for any future
      // Vendor Day where the lineup is light.
      if (!payload.event_id) return json({ error: 'event_id required' }, 400)
      const { data: ev, error: eErr } = await supabase.from('events').select('*').eq('id', payload.event_id).single()
      if (eErr || !ev) return json({ error: eErr?.message || 'event not found' }, 404)

      // Approved vendors with no application row for this event
      let vendorQuery = supabase
        .from('vendors')
        .select('id, name, email, ig_handle')
        .eq('status', 'approved')
      // Optional retry-targeting: limit to specific vendor_ids
      if (payload.vendor_ids && payload.vendor_ids.length > 0) {
        vendorQuery = vendorQuery.in('id', payload.vendor_ids)
      }
      const { data: approvedVendors, error: vErr } = await vendorQuery
      if (vErr) return json({ error: vErr.message }, 500)
      const { data: existingApps } = await supabase
        .from('vendor_applications')
        .select('vendor_id')
        .eq('event_id', payload.event_id)
      const appliedSet = new Set((existingApps || []).map(a => a.vendor_id))
      const targets = (approvedVendors || []).filter(v => !appliedSet.has(v.id))

      const dateStr = ev.event_date ? formatEventDate(ev.event_date) : "the next TC's Beach City Trade Night"
      const eventTitle = ev.title || "TC's Beach City Trade Night"
      const vendorTimes = vendorTimeLine(ev)
      // Detect "tomorrow" for urgency framing in subject
      const today = new Date(); today.setHours(0,0,0,0)
      const evDate = new Date((ev.event_date || '') + 'T12:00:00')
      const dayDiff = Math.round((evDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      const isTomorrow = dayDiff === 1
      const isSoon = dayDiff >= 0 && dayDiff <= 7
      const urgencyLabel = isTomorrow ? 'TOMORROW' : (isSoon ? 'THIS WEEK' : 'COMING UP')

      const subject = isTomorrow
        ? `Action required: Apply for tomorrow — ${eventTitle}`
        : `Action required: Apply for ${dateStr} — ${eventTitle}`

      const sentTo: string[] = []
      const failed: string[] = []
      // Resend rate limit is ~2 req/sec on standard plans, throttle to be safe
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
      let firstSend = true
      for (const v of targets) {
        if (!v.email) continue
        if (!firstSend) await sleep(600)
        firstSend = false
        const body =
          `<p style="margin:0 0 20px">Hi ${v.name},</p>` +
          `<p style="margin:0 0 24px">You're approved as a Trainer Center HB vendor partner — but we don't have you on this event yet.</p>` +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px"><tr><td style="background:#fef3c7;border-left:4px solid #f59e0b;padding:20px 22px;border-radius:6px">` +
          `  <p style="margin:0 0 8px;font-size:12px;font-weight:800;color:#92400e;letter-spacing:0.06em">⏰ ${urgencyLabel}: ${dateStr.toUpperCase()}</p>` +
          `  <p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#1f2937">${eventTitle}</p>` +
          (vendorTimes ? `  <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#166534">Vendor window: ${vendorTimes}</p>` : '') +
          `  <p style="margin:0;color:#1f2937;font-size:14px;line-height:1.5">If you want a spot, you need to apply from your dashboard. Two clicks.</p>` +
          `</td></tr></table>` +
          `<p style="margin:24px 0;text-align:center"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Apply for ${dateStr}  →</a></p>` +
          `<p style="margin:28px 0 0;font-size:13px;color:#666;border-top:1px solid #eee;padding-top:16px">Can't make ${isTomorrow ? 'tomorrow' : 'this date'}? Your dashboard also has every future TC's Beach City Trade Night — pick any one. They happen the last Friday of every month at the shop.</p>`
        const text = `Action required: Apply for ${dateStr} — ${eventTitle}\n\n` +
          `Hi ${v.name},\n\n` +
          `You're approved as a Trainer Center HB vendor partner — but we don't have you on this event yet.\n\n` +
          `${urgencyLabel}: ${dateStr} — ${eventTitle}\n\n` +
          `If you want a spot, you need to apply from your dashboard:\n${SITE_URL}/vendors/dashboard\n\n` +
          `Can't make this date? The dashboard also lists every future TC's Beach City Trade Night. They happen the last Friday of every month at the shop.`
        try {
          await sendResendEmail([v.email], subject, wrapHtml(body), text)
          sentTo.push(v.email)
        } catch (err) {
          console.error('[vendor_event_invite_urgent] failed for', v.email, err)
          failed.push(v.email)
        }
      }
      return json({ ok: true, sent: sentTo, count: sentTo.length, failed, target_count: targets.length })
    }

    if (type === 'vendor_event_day_reminder') {
      // Morning-of "tonight's the night" reminder. Goes to every vendor with
      // an APPROVED application for the event. Pulls event title, window,
      // chef note + each vendor's requested time slot live.
      if (!payload.event_id) return json({ error: 'event_id required' }, 400)
      const { data: ev, error: eErr } = await supabase.from('events').select('*').eq('id', payload.event_id).single()
      if (eErr || !ev) return json({ error: eErr?.message || 'event not found' }, 404)

      const { data: apps, error: aErr } = await supabase
        .from('vendor_applications')
        .select('id, requested_start_time, requested_end_time, vendor:vendors(id, name, email)')
        .eq('event_id', payload.event_id)
        .eq('status', 'approved')
      if (aErr) return json({ error: aErr.message }, 500)

      const eventTitle = ev.title || "TC's Beach City Trade Night"
      const eventDateStr = ev.event_date ? formatEventDate(ev.event_date) : 'today'
      const window = vendorTimeLine(ev) || ''
      const chefNote = (ev.vendor_note || '').trim()
      const lineupUrl = `${SITE_URL}/vendor-day?event=${ev.id}`
      const subject = `Tonight: ${eventTitle}`

      const sentTo: string[] = []
      const failed: string[] = []
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
      let firstSend = true
      for (const app of (apps || [])) {
        const v = (app as any).vendor
        if (!v?.email) continue
        if (!firstSend) await sleep(600)
        firstSend = false

        // Per-vendor time slot if they specified one when applying.
        const myStart = formatTime12h((app as any).requested_start_time)
        const myEnd = formatTime12h((app as any).requested_end_time)
        const personalWindow = (myStart && myEnd) ? `${myStart} - ${myEnd}` : ''

        const body =
          `<p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#C8102E;letter-spacing:0.06em;text-transform:uppercase">Tonight</p>` +
          `<h2 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#1a1a1a;line-height:1.2">${eventTitle}</h2>` +
          `<p style="margin:0 0 24px">Hi ${v.name},</p>` +
          `<p style="margin:0 0 20px">Tonight is the night. Here are the details so you walk in ready.</p>` +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #eee;border-radius:10px;border-collapse:separate;overflow:hidden">` +
          `  <tr><td style="padding:14px 18px;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;font-weight:700;color:#666;letter-spacing:0.04em;text-transform:uppercase">Date</span><br/><span style="font-size:15px;color:#1a1a1a;font-weight:600">${eventDateStr}</span></td></tr>` +
          (window ? `  <tr><td style="padding:14px 18px;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;font-weight:700;color:#666;letter-spacing:0.04em;text-transform:uppercase">Event window</span><br/><span style="font-size:15px;color:#1a1a1a;font-weight:600">${window}</span></td></tr>` : '') +
          (personalWindow ? `  <tr><td style="padding:14px 18px;border-bottom:1px solid #f3f4f6;background:#f0fdf4"><span style="font-size:12px;font-weight:700;color:#15803d;letter-spacing:0.04em;text-transform:uppercase">Your slot</span><br/><span style="font-size:15px;color:#15803d;font-weight:700">${personalWindow}</span></td></tr>` : '') +
          `  <tr><td style="padding:14px 18px"><span style="font-size:12px;font-weight:700;color:#666;letter-spacing:0.04em;text-transform:uppercase">Address</span><br/><span style="font-size:15px;color:#1a1a1a;font-weight:600">4911 Warner Ave #210<br/>Huntington Beach, CA 92649</span></td></tr>` +
          `</table>` +
          (chefNote ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="background:#fff7ed;border-left:4px solid #c2410c;padding:14px 18px;border-radius:6px"><p style="margin:0 0 4px;font-size:12px;font-weight:800;color:#9a3412;letter-spacing:0.04em;text-transform:uppercase">Note from Trainer Center HB</p><p style="margin:0;color:#1f2937;font-size:14px;line-height:1.5;white-space:pre-wrap">${chefNote.replace(/</g,'&lt;')}</p></td></tr></table>` : '') +
          `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#444">When you arrive, log in and tap <strong>Check in</strong> on your dashboard. After the event you can come back and upload photos and a clip from your table. Those go on our public Vendors page.</p>` +
          `<p style="margin:24px 0 8px;text-align:center"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#16a34a;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Open dashboard</a></p>` +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0"><tr><td style="background:#fff0f0;border-left:4px solid #C8102E;padding:14px 18px;border-radius:6px">` +
          `  <p style="margin:0 0 6px;font-size:12px;font-weight:800;color:#C8102E;letter-spacing:0.04em;text-transform:uppercase">Promote your table</p>` +
          `  <p style="margin:0 0 8px;color:#1f2937;font-size:14px;line-height:1.5">Your logo and socials are live on the public lineup page. Share with your community before doors open.</p>` +
          `  <p style="margin:0;font-size:13px"><a href="${lineupUrl}" style="color:#C8102E;font-weight:700;text-decoration:underline">${lineupUrl.replace('https://','')}</a></p>` +
          `</td></tr></table>`

        const text = `Tonight: ${eventTitle}\n\n` +
          `Hi ${v.name},\n\n` +
          `Tonight is the night.\n\n` +
          `Date: ${eventDateStr}\n` +
          (window ? `Event window: ${window}\n` : '') +
          (personalWindow ? `Your slot: ${personalWindow}\n` : '') +
          `Address: 4911 Warner Ave #210, Huntington Beach, CA 92649\n\n` +
          (chefNote ? `Note from Trainer Center HB: ${chefNote}\n\n` : '') +
          `When you arrive, log in and tap Check in on your dashboard.\n\n` +
          `Dashboard: ${SITE_URL}/vendors/dashboard\n` +
          `Promote your table — share the public lineup with your community: ${lineupUrl}\n`

        try {
          await sendResendEmail([v.email], subject, wrapHtml(body), text)
          sentTo.push(v.email)
        } catch (err) {
          console.error('[vendor_event_day_reminder] failed for', v.email, err)
          failed.push(v.email)
        }
      }
      return json({ ok: true, sent: sentTo, count: sentTo.length, failed, target_count: (apps || []).length })
    }

    if (type === 'customer_appreciation') {
      // Single-recipient marketing blast to a marketing_contacts row.
      // Caller is responsible for throttling (the script loops with delay).
      if (!payload.contact_id) return json({ error: 'contact_id required' }, 400)
      const { data: c, error: cErr } = await supabase
        .from('marketing_contacts')
        .select('id, email, first_name, unsubscribe_token, unsubscribed_at')
        .eq('id', payload.contact_id)
        .single()
      if (cErr || !c) return json({ error: cErr?.message || 'contact not found' }, 404)
      if (!c.email) return json({ error: 'contact has no email' }, 400)
      if (c.unsubscribed_at) return json({ ok: true, skipped: 'already unsubscribed' })

      const greeting = (c.first_name && c.first_name.trim())
        ? `Hi ${c.first_name.trim()},`
        : 'Hi there,'
      const unsubUrl = c.unsubscribe_token
        ? `${SITE_URL}/unsubscribe?token=${c.unsubscribe_token}`
        : null
      const lineupUrl = `${SITE_URL}/vendor-day`
      const applyUrl = `${SITE_URL}/vendors/apply`
      const subject = 'Card Show Today in HB'

      const body =
        `<p style="margin:0 0 16px">${greeting}</p>` +
        // Lead headline — plain bold black text, no box, no red. Reads as
        // timely info rather than ad copy and doesn't fight Gmail's promo
        // classifier with stacked color blocks.
        `<p style="margin:0 0 4px;font-size:20px;font-weight:900;color:#1a1a1a;letter-spacing:0.02em">CARD SHOW TODAY</p>` +
        `<p style="margin:0 0 24px;font-size:14px;font-weight:700;color:#1a1a1a;letter-spacing:0.04em;text-transform:uppercase">12 PM – 8 PM · Huntington Beach</p>` +
        `<p style="margin:0 0 16px;line-height:1.6">We appreciate you. Whether you have stopped by once or you are a regular, we are glad you are part of the community.</p>` +
        `<p style="margin:0 0 16px;line-height:1.6">Tonight is our monthly Beach City Trade Night — vendors set up across the shop from <strong>12 PM to 8 PM</strong>. Cards, sealed product, slabs. Come hang out.</p>` +
        `<p style="margin:0 0 24px;line-height:1.6">See the full lineup on our website <a href="${lineupUrl}" style="color:#C8102E;font-weight:700">Trainer Center HB</a>.</p>` +

        // Vendor callout — bordered box with red CTA button
        `<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:2px solid #1a1a1a;border-radius:10px"><tr><td style="padding:20px 22px">` +
        `  <p style="margin:0 0 8px;font-size:12px;font-weight:800;color:#C8102E;letter-spacing:0.06em;text-transform:uppercase">Vendors — A Few Last-Minute Spots</p>` +
        `  <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#1a1a1a">The lineup is full, but we have a few open tables for tonight's show. Vendor table, prime time, packed room. If you have inventory and want to get in front of our community, apply now — Trainer Center HB will review and approve before doors open.</p>` +
        `  <p style="margin:0;text-align:center"><a href="${applyUrl}" style="display:inline-block;background:#C8102E;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Apply to vend at tonight's show  →</a></p>` +
        `</td></tr></table>` +

        `<p style="margin:24px 0 8px;line-height:1.6">4911 Warner Ave #210<br/>Huntington Beach, CA 92649</p>` +
        `<p style="margin:0 0 24px;line-height:1.6">Follow us <a href="https://instagram.com/trainercenter.pokemon" style="color:#C8102E;font-weight:700">@trainercenter.pokemon</a> for what's next.</p>` +
        `<p style="margin:0;font-weight:700">— TC HB</p>` +
        (unsubUrl ? `<p style="margin:24px 0 0;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:14px">Don't want emails like this? <a href="${unsubUrl}" style="color:#888">Unsubscribe</a>.</p>` : '')

      const text = `${greeting}\n\n` +
        `CARD SHOW TODAY — 12 PM to 8 PM, Huntington Beach.\n\n` +
        `We appreciate you. Whether you have stopped by once or you are a regular, we are glad you are part of the community.\n\n` +
        `Tonight is our monthly Beach City Trade Night — vendors set up across the shop from 12 PM to 8 PM. Cards, sealed product, slabs. Come hang out.\n\n` +
        `See the full lineup on our website: ${lineupUrl}\n\n` +
        `VENDORS — A FEW LAST-MINUTE SPOTS\n` +
        `The lineup is full, but we have a few open tables for tonight's show. Vendor table, prime time, packed room. If you have inventory and want to get in front of our community, apply now — Trainer Center HB will review and approve before doors open.\n` +
        `Apply: ${applyUrl}\n\n` +
        `4911 Warner Ave #210, Huntington Beach, CA 92649\n` +
        `Follow us @trainercenter.pokemon for what's next.\n\n` +
        `— TC HB\n` +
        (unsubUrl ? `\nUnsubscribe: ${unsubUrl}\n` : '')

      try {
        await sendResendEmail([c.email], subject, wrapHtml(body), text)
        // Stamp the contact so a re-run of the blast script skips this row.
        // Best-effort: a stamping failure doesn't undo the email that just sent.
        await supabase.from('marketing_contacts')
          .update({ appreciation_blast_2026_05_01_sent_at: new Date().toISOString() })
          .eq('id', c.id)
        return json({ ok: true, sent: [c.email] })
      } catch (err) {
        return json({ error: (err as Error).message }, 500)
      }
    }

    if (type === 'member_welcome') {
      if (!payload.member_id) return json({ error: 'member_id required' }, 400)
      const { data: m, error: mErr } = await supabase.from('members').select('*').eq('id', payload.member_id).single()
      if (mErr || !m) return json({ error: mErr?.message || 'member not found' }, 404)
      const subject = 'Welcome to the Trainer Center HB community'
      const body = `<p>Hi ${m.first_name || 'there'},</p>` +
        `<p>You're in! You can vote for your favorite vendors at any future TC's Beach City Trade Night. Voting opens at the shop on event day — just tap <strong>Review Vendors</strong> on the Vendors page when you're here.</p>` +
        `<p><strong>Cadence:</strong> last Friday of every month.</p>` +
        `<p>We'll send you a reminder a few days before the next one. No spam, no list-selling — just shop news.</p>` +
        `<p style="margin-top:24px"><a href="${SITE_URL}/vendors" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">See Vendors page</a></p>`
      await sendResendEmail([m.email], subject, wrapHtml(body), `Welcome to Trainer Center HB, ${m.first_name || ''}!\n\nTC's Beach City Trade Night = last Friday of every month. Vote at the shop on event day.\n\n${SITE_URL}/vendors`)
      return json({ ok: true, sent: ['member'] })
    }

    if (type === 'application_received' || type === 'application_decided') {
      if (!payload.application_id) return json({ error: 'application_id required' }, 400)
      const { data: app, error: aErr } = await supabase.from('vendor_applications').select('*, vendor:vendors(*), event:events(*)').eq('id', payload.application_id).single()
      if (aErr || !app) return json({ error: aErr?.message || 'application not found' }, 404)
      const v = app.vendor
      const e = app.event
      const dateStr = e?.event_date ? formatEventDate(e.event_date) : "an upcoming TC's Beach City Trade Night"
      const eventTitle = e?.title || "TC's Beach City Trade Night"

      if (type === 'application_received') {
        const vendorSubject = `Got your application for ${dateStr}`
        // Paid event: restate the fee terms so the vendor has the
        // authorization in writing. Nothing is charged until approval.
        const feeCents = app.fee_cents || 0
        const feeUsd = `$${(feeCents / 100).toFixed(feeCents % 100 === 0 ? 0 : 2)}`
        const feeLine = feeCents > 0
          ? `<p style="font-size:14px;background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px">This event has a <strong>${feeUsd} table fee</strong>. Nothing has been charged — your saved card is only charged if Trainer Center HB approves your application.</p>`
          : ''
        const feeText = feeCents > 0
          ? `\n\nThis event has a ${feeUsd} table fee. Nothing has been charged — your saved card is only charged if you're approved.`
          : ''
        const vendorBody = `<p>Hi ${v.name},</p><p>We got your interest in vending on <strong>${dateStr}</strong> for <strong>${eventTitle}</strong>. Trainer Center HB will confirm your spot soon.</p>${feeLine}`
        await sendResendEmail([v.email], vendorSubject,
          wrapHtml(vendorBody + `<p style="margin-top:24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a></p>`),
          `${vendorSubject}${feeText}\n\nDashboard: ${SITE_URL}/vendors/dashboard`)
        const isFirst = !!payload.is_first_time
        const staffSubject = isFirst ? `New vendor: ${v.name}` : `${v.name} wants to vend on ${dateStr}`
        const staffBody = `<p><strong>${v.name}</strong> ${isFirst ? 'just applied as a new vendor' : `applied for ${eventTitle} on ${dateStr}`}.</p>` +
          `<p style="font-size:13px;color:#444">${v.email}${v.phone ? ' · ' + v.phone : ''}<br/>` +
          `${v.specialty ? 'Specialty: ' + v.specialty + '<br/>' : ''}` +
          `${v.ig_handle ? 'IG: @' + v.ig_handle + '<br/>' : ''}` +
          `${v.heard_from ? 'Heard from: ' + v.heard_from.replace(/_/g, ' ') + '<br/>' : ''}` +
          `${v.referred_by_name ? 'Referred by: ' + v.referred_by_name + (v.referred_by_handle ? ' (@' + v.referred_by_handle + ')' : '') : ''}</p>` +
          `<p>${v.bio ? `"${v.bio}"` : ''}</p>` +
          `<p style="margin-top:24px"><a href="${SITE_URL}/staff/vendors" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Review in admin</a></p>`
        await sendResendEmail(STAFF_EMAILS, staffSubject, wrapHtml(staffBody),
          `${staffSubject}\n\nName: ${v.name}\nEmail: ${v.email}\nReview: ${SITE_URL}/staff/vendors`)
        return json({ ok: true, sent: ['vendor', 'staff'] })
      }

      const status = app.status
      if (status === 'approved') {
        const subject = `CONGRATS ${v.name}, you're approved for ${dateStr}!`
        const lineupUrl = `${SITE_URL}/vendor-day?event=${app.event_id}`
        const vendorTimes = vendorTimeLine(e || {})
        const whenLine = `${dateStr}${vendorTimes ? ` &nbsp;&middot;&nbsp; ${vendorTimes}` : ''}`
        // Table-fee receipt line. State of the application at approval time:
        // charged (possibly discounted), waived, or failed (pay link coming).
        const feeCents = app.fee_cents || 0
        const usd = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`
        let feeBlock = ''
        let feeTextLine = ''
        if (feeCents > 0) {
          if (app.payment_status === 'charged') {
            const charged = app.charged_amount_cents ?? feeCents
            const discounted = charged < feeCents ? ` (discounted from ${usd(feeCents)})` : ''
            feeBlock = `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:#f0fdf4;border-left:4px solid #16a34a;padding:14px 20px;border-radius:6px">` +
              `<p style="margin:0;font-size:14px;color:#166534"><strong>Table fee collected:</strong> ${usd(charged)}${discounted} was charged to your card on file. You're all set.</p></td></tr></table>`
            feeTextLine = `\nTable fee collected: ${usd(charged)}${discounted} was charged to your card on file.\n`
          } else if (app.payment_status === 'waived') {
            feeBlock = `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:#f0fdf4;border-left:4px solid #16a34a;padding:14px 20px;border-radius:6px">` +
              `<p style="margin:0;font-size:14px;color:#166534"><strong>Table fee waived:</strong> your ${usd(feeCents)} fee is on the house this time.</p></td></tr></table>`
            feeTextLine = `\nTable fee waived: your ${usd(feeCents)} fee is on the house this time.\n`
          } else if (app.payment_status === 'failed') {
            feeBlock = `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:#fffbeb;border-left:4px solid #f59e0b;padding:14px 20px;border-radius:6px">` +
              `<p style="margin:0;font-size:14px;color:#92400e"><strong>Table fee:</strong> we couldn't charge your card. Watch your inbox for a secure payment link to lock in your table.</p></td></tr></table>`
            feeTextLine = `\nTable fee: we couldn't charge your card. Watch for a payment link email to lock in your table.\n`
          }
        }
        const body =
          `<p style="font-size:24px;font-weight:800;color:#1a1a1a;margin:0 0 6px">CONGRATS, ${v.name}!</p>` +
          `<p style="margin:0 0 16px;font-size:16px;color:#1f2937">You've been <strong>approved</strong> for the next Trainer Center event!</p>` +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px">` +
          `  <p style="margin:0 0 4px;font-size:12px;font-weight:800;color:#64748b;letter-spacing:0.08em">WHEN</p>` +
          `  <p style="margin:0;font-size:18px;font-weight:800;color:#1a1a1a">${whenLine}</p>` +
          `  <p style="margin:6px 0 0;font-size:13px;color:#475569;line-height:1.5">This is an <strong>all-day</strong> event. There's no partial or shift option, so plan to be set up for the full window.</p>` +
          `</td></tr></table>` +
          feeBlock +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:#fff0f0;border-left:4px solid #C8102E;padding:16px 20px;border-radius:6px">` +
          `  <p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#C8102E;letter-spacing:0.04em">YOU MADE THE CUT</p>` +
          `  <p style="margin:0;color:#1f2937;font-size:14px;line-height:1.55">We're capping this event at <strong>30-35 vendors ONLY</strong>. We want you to know, you're a <strong>great fit and great quality</strong>. We don't just want anyone. <strong>Congrats on getting in!</strong></p>` +
          `</td></tr></table>` +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 20px;border-radius:6px">` +
          `  <p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#166534;letter-spacing:0.04em">THIS EVENT IS TAKING OVER</p>` +
          `  <p style="margin:0;color:#166534;font-size:14px;line-height:1.55">Everyone is talking about it, and that's thanks to people like <strong>YOU</strong>. We've got big plans and big excitement, and your table is a huge part of what makes it special.</p>` +
          `</td></tr></table>` +
          `<p style="margin:0 0 10px;font-size:15px;font-weight:800;color:#1a1a1a">A couple of keys to get you ready:</p>` +
          `<ul style="margin:0 0 20px;padding-left:20px;color:#1f2937;font-size:14px;line-height:1.7">` +
          `  <li><strong>Pok&eacute;mon only.</strong> No other TCG. We're California's Pok&eacute;mon-only shop and we keep it pure.</li>` +
          `  <li><strong>We've got your setup covered.</strong> Tables, chairs, tablecloths, canopies, and area lighting. Just show up.</li>` +
          `  <li><strong>Want it comfier?</strong> Bring your own chair or a custom setup, totally welcome.</li>` +
          `  <li><strong>Last event was PACKED OUT.</strong> If you can bring an extra of anything to support a fellow vendor, that goes a long way. We're a community.</li>` +
          `</ul>` +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="background:#eff6ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:6px">` +
          `  <p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#1d4ed8;letter-spacing:0.04em">PICK YOUR SPOT</p>` +
          `  <p style="margin:0;color:#1e3a5f;font-size:14px;line-height:1.55">Seating is <strong>first come, first serve</strong>, but please grab a <strong>different spot than last time</strong>. Also be ready to have a newer vendor placed <strong>between you and a veteran</strong>. We're sprinkling new folks around so everyone gets great neighbors and fresh foot traffic.</p>` +
          `</td></tr></table>` +
          `<p style="margin:0 0 16px;font-size:14px;color:#1f2937;line-height:1.6">When you arrive, log in and tap <strong>Check in</strong> on your dashboard so we know you've landed. After the event, hop back on and <strong>upload photos and a short clip</strong> from your table. Those go straight onto our public Vendors page and put your brand in front of everyone who visits.</p>` +
          `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="background:#fff0f0;border-left:4px solid #C8102E;padding:18px 22px;border-radius:6px">` +
          `  <p style="margin:0 0 6px;font-size:13px;font-weight:800;color:#C8102E;letter-spacing:0.04em">PROMOTE YOUR TABLE</p>` +
          `  <p style="margin:0 0 10px;color:#1f2937;font-size:14px;line-height:1.5">Your logo and socials are already live on the public lineup page. Drop the link to your community and bring your people. More eyes on the event means more traffic to your table.</p>` +
          `  <p style="margin:0;font-size:13px"><a href="${lineupUrl}" style="color:#C8102E;font-weight:700;text-decoration:underline">${lineupUrl.replace('https://', '')}</a></p>` +
          `</td></tr></table>` +
          `<p style="margin:0 0 24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open dashboard</a></p>` +
          `<p style="margin:0;font-size:15px;color:#1a1a1a;font-weight:700">Let's make this the best one yet. See you ${dateStr}!</p>`
        const text = `CONGRATS ${v.name}! You're approved for ${eventTitle} on ${dateStr}${vendorTimes ? ` (${vendorTimes})` : ''}.\n\n` +
          `This is an all-day event. There's no partial or shift option, so plan to be set up for the full window.\n` +
          feeTextLine + `\n` +
          `You made the cut: we're capping this at 30-35 vendors only. You're a great fit and great quality. Congrats on getting in!\n\n` +
          `Keys: Pokemon only (no other TCG). We provide tables, chairs, tablecloths, canopies, and area lighting. Bring your own chair or setup if you want it comfier. Last event was packed out, so if you can bring an extra of anything to support fellow vendors, that is appreciated.\n\n` +
          `Pick your spot: first come, first serve, but please grab a different spot than last time, and be ready to have a newer vendor placed between you and a veteran.\n\n` +
          `When you arrive, tap Check in on your dashboard. After the event, upload photos and a clip for the public Vendors page.\n\n` +
          `Promote your table: ${lineupUrl}\n\nDashboard: ${SITE_URL}/vendors/dashboard`
        await sendResendEmail([v.email], subject, wrapHtml(body), text)
      } else if (status === 'declined') {
        const subject = `About your TC's Beach City Trade Night application`
        const body = `<p>Hi ${v.name},</p><p>Thanks for applying for <strong>${eventTitle}</strong> on <strong>${dateStr}</strong>. We aren't able to accommodate you this time.</p>${app.decision_note ? `<p style="font-size:14px;background:#f9fafb;border-left:3px solid #999;padding:10px 14px">${app.decision_note}</p>` : ''}<p>You're welcome to apply for future dates. We appreciate your interest in Trainer Center HB.</p>`
        await sendResendEmail([v.email], subject, wrapHtml(body), `About your TC's Beach City Trade Night application: not approved this time.`)
      } else {
        return json({ ok: true, skipped: 'not a notify-worthy status' })
      }
      return json({ ok: true, sent: ['vendor'] })
    }

    // One-off express-link reminder to a single applicant who hasn't put a
    // card down yet. Payload: application_id, apology (bool) — apology=true
    // sends a short correction note first (used once, 2026-07, after a
    // broadcast went out with a stale event link).
    if (type === 'express_link_reminder') {
      if (!payload.application_id) return json({ error: 'application_id required' }, 400)
      // Service-role read: the caller here is a one-off staff-triggered
      // send, not the applying vendor's own session, so the public
      // approved-only RLS policy on vendor_applications would hide pending
      // rows. Safe to bypass — the only output is an email to v.email,
      // which comes from the row itself, not from caller input.
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') || '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      )
      const { data: app, error: aErr } = await supabaseAdmin.from('vendor_applications').select('*, vendor:vendors(*), event:events(*)').eq('id', payload.application_id).single()
      if (aErr || !app) return json({ error: aErr?.message || 'application not found' }, 404)
      const v = app.vendor
      const e = app.event
      const dateStr = e?.event_date ? formatEventDate(e.event_date) : 'the upcoming event'
      const eventTitle = e?.title || "TC's Beach City Trade Night"
      const cents = app.fee_cents || 0
      const usd = `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
      const expressUrl = `${SITE_URL}/vendors/express?event=${e.id}`
      const apologyLine = payload.apology
        ? `<p>Quick correction — the reservation link in our last email was wrong. It pointed at an old event instead of ${dateStr}. Sorry about that.</p>`
        : ''
      const apologyText = payload.apology
        ? `Quick correction: the reservation link in our last email was wrong. It pointed at an old event instead of ${dateStr}. Sorry about that.\n\n`
        : ''
      const subject = payload.apology ? `Correction: your ${eventTitle} link` : `Reserve your spot for ${dateStr}`
      const body = `<p>Hi ${v.name},</p>` + apologyLine +
        `<p>You started an application for <strong>${eventTitle}</strong> on <strong>${dateStr}</strong>, but haven't reserved your table yet.</p>` +
        `<p>Spots are filling up. Reserve yours now and you're locked in instantly, no waiting on review.</p>` +
        `<p style="margin:24px 0"><a href="${expressUrl}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Reserve My Spot — ${usd}</a></p>` +
        `<p style="font-size:14px;color:#666">Questions? Reply to this email or DM us on Instagram <a href="https://www.instagram.com/trainercenter.pokemon/" style="color:#666">@trainercenter.pokemon</a>.</p>`
      await sendResendEmail([v.email], subject, wrapHtml(body),
        `Hi ${v.name},\n\n${apologyText}You started an application for ${eventTitle} on ${dateStr}, but haven't reserved your table yet.\n\nReserve My Spot (${usd}): ${expressUrl}`)
      return json({ ok: true, sent: ['vendor'] })
    }

    // Express fast-pass: vendor paid up front through the express link and
    // is auto-approved. Notifies STAFF (the vendor gets Stripe's receipt
    // email plus the approval email, fired separately by the client).
    if (type === 'vendor_express_joined') {
      if (!payload.application_id) return json({ error: 'application_id required' }, 400)
      const { data: app, error: aErr } = await supabase.from('vendor_applications').select('*, vendor:vendors(*), event:events(*)').eq('id', payload.application_id).single()
      if (aErr || !app) return json({ error: aErr?.message || 'application not found' }, 404)
      const v = app.vendor
      const e = app.event
      const dateStr = e?.event_date ? formatEventDate(e.event_date) : 'an upcoming event'
      const cents = app.charged_amount_cents || 0
      const usd = `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
      const subject = `EXPRESS: ${v.name} paid ${usd} — on the lineup for ${dateStr}`
      const body = `<p><strong>${v.name}</strong> used the express link, paid <strong>${usd}</strong>, and is auto-approved for <strong>${e?.title || 'Vendor Day'}</strong> on <strong>${dateStr}</strong>.</p>` +
        `<p style="font-size:13px;color:#444">${v.email}${v.phone ? ' · ' + v.phone : ''}${v.ig_handle ? ' · IG: @' + v.ig_handle : ''}</p>` +
        `<p style="margin-top:24px"><a href="${SITE_URL}/staff/vendors" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open the roster</a></p>`
      await sendResendEmail(STAFF_EMAILS, subject, wrapHtml(body),
        `${v.name} used the express link, paid ${usd}, and is auto-approved for ${e?.title || 'Vendor Day'} on ${dateStr}.\n${v.email}\nRoster: ${SITE_URL}/staff/vendors`)
      return json({ ok: true, sent: ['staff'] })
    }

    // Table-fee pay link: the saved card declined (or was never saved), so
    // staff generated a hosted Stripe Checkout link and approved anyway.
    // Payload: application_id, pay_url, amount_cents.
    if (type === 'table_fee_pay_link') {
      if (!payload.application_id) return json({ error: 'application_id required' }, 400)
      if (!payload.pay_url) return json({ error: 'pay_url required' }, 400)
      const { data: app, error: aErr } = await supabase.from('vendor_applications').select('*, vendor:vendors(*), event:events(*)').eq('id', payload.application_id).single()
      if (aErr || !app) return json({ error: aErr?.message || 'application not found' }, 404)
      const v = app.vendor
      const e = app.event
      const dateStr = e?.event_date ? formatEventDate(e.event_date) : 'the upcoming event'
      const eventTitle = e?.title || "TC's Beach City Trade Night"
      const cents = payload.amount_cents || app.fee_cents || 0
      const usd = `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
      const subject = `Action needed: ${usd} table fee for ${dateStr}`
      const body = `<p>Hi ${v.name},</p>` +
        `<p>You're approved for <strong>${eventTitle}</strong> on <strong>${dateStr}</strong> — congrats! One last step: your <strong>${usd} table fee</strong> couldn't be charged to the card on file, so here's a secure payment link instead.</p>` +
        `<p style="margin:24px 0"><a href="${payload.pay_url}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Pay ${usd} table fee</a></p>` +
        `<p style="font-size:14px;color:#666">Paying locks in your table. If anything looks off, just reply to this email.</p>`
      await sendResendEmail([v.email], subject, wrapHtml(body),
        `Hi ${v.name},\n\nYou're approved for ${eventTitle} on ${dateStr}. One last step: your ${usd} table fee couldn't be charged to the card on file.\n\nPay here to lock in your table: ${payload.pay_url}`)
      return json({ ok: true, sent: ['vendor'] })
    }

    if (type === 'vendor_optout_notify') {
      // Vendor self-service opt-out or cancellation. Notifies STAFF only
      // (Chef + Chase) so they see the lineup change without the vendor
      // having to write a separate email.
      if (!payload.vendor_id) return json({ error: 'vendor_id required' }, 400)
      if (!payload.event_id) return json({ error: 'event_id required' }, 400)
      if (!payload.optout_kind) return json({ error: 'optout_kind required' }, 400)
      const { data: v, error: vErr } = await supabase.from('vendors').select('id, name, email').eq('id', payload.vendor_id).single()
      if (vErr || !v) return json({ error: vErr?.message || 'vendor not found' }, 404)
      const { data: ev, error: eErr } = await supabase.from('events').select('id, title, event_date').eq('id', payload.event_id).single()
      if (eErr || !ev) return json({ error: eErr?.message || 'event not found' }, 404)

      const dateStr = ev.event_date ? formatEventDate(ev.event_date) : "an upcoming TC's Beach City Trade Night"
      const eventTitle = ev.title || "TC's Beach City Trade Night"
      const reason = (payload.reason || '').trim()
      const isCancel = payload.optout_kind === 'vendor_cancelled'

      const subject = isCancel
        ? `Vendor cancelled: ${v.name} pulled out of ${dateStr}`
        : `Not interested: ${v.name} won't vend ${dateStr}`
      const lead = isCancel
        ? `<p style="margin:0 0 16px"><strong>${v.name}</strong> was <strong>approved</strong> for <strong>${eventTitle}</strong> on <strong>${dateStr}</strong> and just <strong>cancelled</strong>. The lineup is one vendor shorter.</p>`
        : `<p style="margin:0 0 16px"><strong>${v.name}</strong> marked themselves <strong>not interested</strong> in <strong>${eventTitle}</strong> on <strong>${dateStr}</strong>. They won't get any more drip emails about this date.</p>`
      const body = lead +
        (reason
          ? `<div style="background:#f9fafb;border-left:4px solid #6b7280;padding:14px 18px;border-radius:6px;margin:0 0 16px"><p style="margin:0 0 4px;font-size:12px;font-weight:800;color:#374151;letter-spacing:0.04em;text-transform:uppercase">Reason</p><p style="margin:0;font-size:14px;color:#1f2937;line-height:1.5;white-space:pre-wrap">${reason.replace(/</g, '&lt;')}</p></div>`
          : '') +
        `<p style="margin:16px 0 0;font-size:13px;color:#666">${v.email}</p>` +
        `<p style="margin:24px 0 0"><a href="${SITE_URL}/staff/vendors" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open admin</a></p>`
      const text = `${subject}\n\n` +
        (isCancel
          ? `${v.name} was approved for ${eventTitle} on ${dateStr} and just cancelled.\n\n`
          : `${v.name} marked themselves not interested in ${eventTitle} on ${dateStr}.\n\n`) +
        (reason ? `Reason: ${reason}\n\n` : '') +
        `${v.email}\n\nAdmin: ${SITE_URL}/staff/vendors`
      await sendResendEmail(STAFF_EMAILS, subject, wrapHtml(body), text)
      return json({ ok: true, sent: ['staff'] })
    }

    if (type === 'event_cancelled') {
      if (!payload.event_id) return json({ error: 'event_id required' }, 400)
      const { data: ev, error: eErr } = await supabase.from('events').select('*').eq('id', payload.event_id).single()
      if (eErr || !ev) return json({ error: eErr?.message || 'event not found' }, 404)
      const { data: apps, error: aErr } = await supabase.from('vendor_applications').select('*, vendor:vendors(*)').eq('event_id', payload.event_id).in('status', ['approved', 'pending'])
      if (aErr) return json({ error: aErr.message }, 500)

      const dateStr = ev.event_date ? formatEventDate(ev.event_date) : "a TC's Beach City Trade Night"
      const eventTitle = ev.title || "TC's Beach City Trade Night"
      const reason = payload.reason || ev.cancellation_reason || ''

      const sentTo: string[] = []
      for (const a of (apps || [])) {
        const v = a.vendor
        if (!v?.email) continue
        const subject = `Cancelled: ${eventTitle} on ${dateStr}`
        const body = `<p>Hi ${v.name},</p>` +
          `<p>We had to cancel <strong>${eventTitle}</strong> on <strong>${dateStr}</strong>. ${a.status === 'approved' ? 'You had been approved as a vendor for this date — apologies for the change.' : 'Your application is no longer needed for this date.'}</p>` +
          (reason ? `<p style="font-size:14px;background:#fef2f2;border-left:3px solid #dc2626;padding:10px 14px">${reason}</p>` : '') +
          `<p>The next TC's Beach City Trade Night is on the calendar. We'll see you there.</p>` +
          `<p style="margin-top:24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">See upcoming dates</a></p>`
        await sendResendEmail([v.email], subject, wrapHtml(body), `${subject}\n\nDashboard: ${SITE_URL}/vendors/dashboard`)
        sentTo.push(v.email)
      }
      return json({ ok: true, sent: sentTo, count: sentTo.length })
    }

    if (type === 'vendor_broadcast') {
      // Chef-composed comms blast. Audience is resolved server-side from the
      // filter spec — never trust a client-supplied email list. No BCC copies
      // (Chase's call 2026-07-10: never BCC Chef on blasts).
      const audience = payload.audience
      const subject = (payload.subject || '').trim()
      const bodyHtml = (payload.body_html || '').trim()
      const bodyText = (payload.body_text || '').trim()
      if (!audience) return json({ error: 'audience required' }, 400)
      if (!subject) return json({ error: 'subject required' }, 400)
      if (!bodyHtml && !bodyText) return json({ error: 'body required' }, 400)

      // Resolve audience → list of vendor rows
      let targets: { id: string; name: string; email: string; user_id?: string }[] = []
      const eventScoped = ['approved_not_applied', 'applied_any', 'approved_for_event', 'pending_for_event', 'unpaid_for_event']
      if (eventScoped.includes(audience) && !payload.event_id) {
        return json({ error: 'event_id required for this audience' }, 400)
      }

      if (audience === 'all') {
        const { data, error } = await supabase.from('vendors').select('id, name, email, user_id')
        if (error) return json({ error: error.message }, 500)
        targets = data || []
      } else if (audience === 'approved_all') {
        const { data, error } = await supabase.from('vendors').select('id, name, email, user_id').eq('status', 'approved')
        if (error) return json({ error: error.message }, 500)
        targets = data || []
      } else if (audience === 'pending_all') {
        const { data, error } = await supabase.from('vendors').select('id, name, email, user_id').eq('status', 'pending')
        if (error) return json({ error: error.message }, 500)
        targets = data || []
      } else if (audience === 'approved_not_applied') {
        const { data: approved, error: vErr } = await supabase.from('vendors').select('id, name, email, user_id').eq('status', 'approved')
        if (vErr) return json({ error: vErr.message }, 500)
        const { data: apps } = await supabase.from('vendor_applications').select('vendor_id').eq('event_id', payload.event_id)
        const applied = new Set((apps || []).map(a => a.vendor_id))
        targets = (approved || []).filter(v => !applied.has(v.id))
      } else if (audience === 'applied_any') {
        const { data: apps, error: aErr } = await supabase
          .from('vendor_applications')
          .select('vendor_id, vendor:vendors(id, name, email, user_id)')
          .eq('event_id', payload.event_id)
        if (aErr) return json({ error: aErr.message }, 500)
        targets = (apps || [])
          .map((a: any) => a.vendor)
          .filter((v: any) => v && v.email)
      } else if (audience === 'approved_for_event') {
        const { data: apps, error: aErr } = await supabase
          .from('vendor_applications')
          .select('vendor_id, vendor:vendors(id, name, email, user_id)')
          .eq('event_id', payload.event_id)
          .eq('status', 'approved')
        if (aErr) return json({ error: aErr.message }, 500)
        targets = (apps || [])
          .map((a: any) => a.vendor)
          .filter((v: any) => v && v.email)
      } else if (audience === 'pending_for_event') {
        const { data: apps, error: aErr } = await supabase
          .from('vendor_applications')
          .select('vendor_id, vendor:vendors(id, name, email, user_id)')
          .eq('event_id', payload.event_id)
          .eq('status', 'pending')
        if (aErr) return json({ error: aErr.message }, 500)
        targets = (apps || [])
          .map((a: any) => a.vendor)
          .filter((v: any) => v && v.email)
      } else if (audience === 'unpaid_for_event') {
        // Applied to this event but never even got as far as saving a card
        // (payment_status card_pending or none). Deliberately excludes
        // card_saved — those vendors have a card on file already and staff
        // charge them directly; emailing them a reservation link risks a
        // double charge. Works for both approved and still-pending applications.
        const { data: apps, error: aErr } = await supabase
          .from('vendor_applications')
          .select('vendor_id, payment_status, vendor:vendors(id, name, email, user_id)')
          .eq('event_id', payload.event_id)
          .in('payment_status', ['card_pending', 'none'])
        if (aErr) return json({ error: aErr.message }, 500)
        targets = (apps || [])
          .map((a: any) => a.vendor)
          .filter((v: any) => v && v.email)
      }

      // Exclude staff: vendors whose user_id maps to a profile with is_admin=true
      // are people like Chef and Seth who happen to also have vendor rows. They
      // shouldn't get marketing/comms blasts intended for outside vendors.
      const { data: adminProfiles } = await supabase.from('profiles').select('id').eq('is_admin', true)
      const adminIds = new Set((adminProfiles || []).map(p => p.id))
      targets = targets.filter(v => !v.user_id || !adminIds.has(v.user_id))

      // Optional: append a small event banner if attach_event is set
      let eventBanner = ''
      let eventTextBanner = ''
      if (payload.attach_event && payload.event_id) {
        const { data: ev } = await supabase.from('events').select('*').eq('id', payload.event_id).single()
        if (ev) {
          const dateStr = ev.event_date ? formatEventDate(ev.event_date) : ''
          const timeLine = vendorTimeLine(ev)
          eventBanner = `<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr><td style="background:#fff7ed;border-left:4px solid #ea580c;padding:14px 18px;border-radius:6px"><p style="margin:0;font-size:13px;font-weight:700;color:#9a3412">${ev.title || "TC's Beach City Trade Night"}</p><p style="margin:4px 0 0;font-size:13px;color:#9a3412">${dateStr}${timeLine ? ` · ${timeLine}` : ''}</p></td></tr></table>`
          eventTextBanner = `\n\n${ev.title || "TC's Beach City Trade Night"} · ${dateStr}${timeLine ? ` · ${timeLine}` : ''}\n`
        }
      }

      const html = wrapHtml(`${bodyHtml || `<p>${bodyText.replace(/\n/g, '</p><p>')}</p>`}${eventBanner}<p style="margin-top:24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a></p>`)
      const text = (bodyText || bodyHtml.replace(/<[^>]+>/g, '')) + eventTextBanner + `\n\nDashboard: ${SITE_URL}/vendors/dashboard`

      const sentTo: string[] = []
      const failed: string[] = []
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
      let firstSend = true
      for (const v of targets) {
        if (!v.email) continue
        if (!firstSend) await sleep(550) // ~2/sec to respect Resend rate limit
        firstSend = false
        try {
          await sendResendEmail([v.email], subject, html, text)
          sentTo.push(v.email)
        } catch (err) {
          console.error('[vendor_broadcast] failed for', v.email, err)
          failed.push(v.email)
        }
      }
      return json({ ok: true, sent: sentTo, count: sentTo.length, failed, audience })
    }

    if (type === 'marketing_contacts_broadcast') {
      // Audience resolution lives in the staff_audience_emails RPC so it
      // matches the count preview the page just showed the admin. We never
      // trust client-supplied recipient lists.
      const subject = (payload.subject || '').trim()
      const bodyHtml = (payload.body_html || '').trim()
      const bodyText = (payload.body_text || '').trim()
      const audienceSpec = payload.audience_spec
      if (!audienceSpec) return json({ error: 'audience_spec required' }, 400)
      if (!subject) return json({ error: 'subject required' }, 400)
      if (!bodyHtml && !bodyText) return json({ error: 'body required' }, 400)

      const { data: rows, error: rpcErr } = await supabase
        .rpc('staff_audience_emails', { p_audience: audienceSpec, p_limit: 1000 })
      if (rpcErr) return json({ error: rpcErr.message }, 500)
      const targets = ((rows || []) as { email: string; first_name: string | null; last_name: string | null }[])
        .filter(r => r.email)

      // Wrap once; each recipient gets the same body. The HTML preserves
      // line breaks from a plain-text composition by promoting blank lines
      // to paragraphs.
      const html = wrapHtml(
        bodyHtml || `<p>${bodyText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`
      )
      const text = bodyText || bodyHtml.replace(/<[^>]+>/g, '')

      const sentTo: string[] = []
      const failed: string[] = []
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
      let firstSend = true
      for (const r of targets) {
        if (!firstSend) await sleep(550) // ~2/sec to respect Resend rate limit
        firstSend = false
        try {
          await sendResendEmail([r.email], subject, html, text)
          sentTo.push(r.email)
        } catch (err) {
          console.error('[marketing_contacts_broadcast] failed for', r.email, err)
          failed.push(r.email)
        }
      }
      return json({ ok: true, sent: sentTo, count: sentTo.length, failed })
    }

    return json({ error: `unknown type: ${type}` }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
