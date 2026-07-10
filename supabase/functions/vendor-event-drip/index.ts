// vendor-event-drip
// Runs daily via pg_cron. For every upcoming Vendor Day event, fires the
// "active step" of two parallel drip tracks:
//
//   Track A — signup push (audience: approved vendors NOT yet applied)
//     T-21, T-14, T-7, T-3, T-2, T-1
//
//   Track B — lineup hype + logistics (audience: approved FOR this event)
//     T-21, T-14, T-7, T-3, T-2, T-1, T-0 morning
//
// Dedup: each (vendor_id, event_id, step_key) fires once. Insert into
// vendor_email_log first; if the unique constraint catches it, skip the send.
//
// Late events: a step is "active" only when days_until is inside its window
// (e.g., T-7 fires when days_until is 4..7). An event created with 5 days to
// go gets T-7 on its first cron tick, then T-3 / T-2 / T-1 on schedule. No
// pile-up of historical steps. No duplicates.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
// Display name is intentionally quoted (RFC 5322 quoted-string form). Zoho
// strips unquoted display names with spaces; Gmail/Outlook accept either.
const FROM_ADDRESS  = '"Trainer Center HB" <noreply@mysendz.com>'
const SITE_URL      = 'https://pokemontrainercenter.com'
const CHEF_BCC      = 'chef@trainercenter.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

// Step windows: a step fires when days_until falls inside this inclusive range.
// The range stops just before the next step's start so we never double-fire.
type Step = { key: string; from: number; to: number; track: 'signup' | 'lineup' }
const SIGNUP_STEPS: Step[] = [
  { key: 'signup.t21', from: 15, to: 21, track: 'signup' },
  { key: 'signup.t14', from: 8,  to: 14, track: 'signup' },
  { key: 'signup.t7',  from: 4,  to: 7,  track: 'signup' },
  { key: 'signup.t3',  from: 3,  to: 3,  track: 'signup' },
  { key: 'signup.t2',  from: 2,  to: 2,  track: 'signup' },
  { key: 'signup.t1',  from: 1,  to: 1,  track: 'signup' },
]
const LINEUP_STEPS: Step[] = [
  { key: 'lineup.t21', from: 15, to: 21, track: 'lineup' },
  { key: 'lineup.t14', from: 8,  to: 14, track: 'lineup' },
  { key: 'lineup.t7',  from: 4,  to: 7,  track: 'lineup' },
  { key: 'lineup.t3',  from: 3,  to: 3,  track: 'lineup' },
  { key: 'lineup.t2',  from: 2,  to: 2,  track: 'lineup' },
  { key: 'lineup.t1',  from: 1,  to: 1,  track: 'lineup' },
  { key: 'lineup.t0',  from: 0,  to: 0,  track: 'lineup' },
]

function activeStep(steps: Step[], daysUntil: number) {
  return steps.find(s => daysUntil >= s.from && daysUntil <= s.to) || null
}

// Build the per-vendor-per-event tokenized URLs that go in drip emails.
// - apply: signup CTA (logged-in flow, no token needed; same dashboard route)
// - notInterested: one-click opt-out (vendor-event-respond?action=not_interested)
// - cancel: one-click cancel-after-approval page (vendor-event-respond?action=cancel)
//   Cancel page asks for a reason before submitting.
function buildLinks(responseToken: string, eventId: string) {
  const base = `${SITE_URL}/vendors/respond?token=${responseToken}&event=${eventId}`
  return {
    apply: `${SITE_URL}/vendors/events`,
    notInterested: `${base}&action=not_interested`,
    cancel: `${base}&action=cancel`,
  }
}

// Per-step copy. Voice is Trainer Center HB (not "Chef"). Events default to
// "TC's Beach City Trade Night" when an admin hasn't set a custom title.
// Signup track: announcement → final-week → last-chance escalation.
// Lineup track: congrats + logistics at T-21, IG promotion mandate at T-14,
// pre-event checklist at T-3, day-of warmth at T-0.
function copyForStep(stepKey: string, eventTitle: string, dateStr: string, vendorName: string, vendorTimes: string, links: { apply: string; notInterested: string; cancel: string }) {
  const eventLine = vendorTimes ? `${eventTitle} · ${dateStr} · ${vendorTimes}` : `${eventTitle} · ${dateStr}`
  const events    = links.apply
  const optOut    = links.notInterested
  const cancel    = links.cancel

  // ─── Track A — signup push (approved partners NOT yet applied) ─────
  if (stepKey === 'signup.t21') {
    return {
      subject: `Did you hear? ${eventTitle} on ${dateStr}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>Big announcement:</strong> we have an upcoming <strong>${eventLine}</strong>.</p>` +
        `<p>If you'd like to vend, click below to apply. Two clicks and you're on the list for review.</p>` +
        `<p style="margin:24px 0;text-align:center"><a href="${events}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700">Apply for this date</a></p>` +
        `<p style="margin-top:24px;font-size:13px;color:#666">Not interested in this date? <a href="${optOut}" style="color:#666">Mark not interested in one click</a> and we'll stop reminding you.</p>`,
      text: `Did you hear? We have an upcoming ${eventLine}.\n\nIf you'd like to vend, apply here: ${events}\n\nNot interested in this date? One-click opt-out: ${optOut}`,
    }
  }
  if (stepKey === 'signup.t14') {
    return {
      subject: `Final reviews this week and next — ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p>Heads up: Trainer Center HB is doing <strong>final reviews this week and next</strong> for <strong>${eventLine}</strong>.</p>` +
        `<p>If you're interested in vending, don't forget to apply.</p>` +
        `<p style="margin:24px 0;text-align:center"><a href="${events}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700">Apply for this date</a></p>` +
        `<p style="margin-top:24px;font-size:13px;color:#666">Not interested in this date? <a href="${optOut}" style="color:#666">Let us know in one click</a> and we'll stop reminding you.</p>`,
      text: `Trainer Center HB is doing final reviews this week and next for ${eventLine}.\n\nIf you're interested in vending, don't forget to apply: ${events}\n\nNot interested in this date? One-click opt-out: ${optOut}`,
    }
  }
  if (stepKey === 'signup.t7') {
    return {
      subject: `Final week — ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p>We're in the <strong>final week</strong> before <strong>${eventLine}</strong>.</p>` +
        `<p>We've always appreciated you and would love to have you at this one. If you're in, apply now.</p>` +
        `<p style="margin:24px 0;text-align:center"><a href="${events}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700">Apply for this date</a></p>` +
        `<p style="margin-top:24px;font-size:13px;color:#666">Not interested in this date? <a href="${optOut}" style="color:#666">Let us know in one click</a> and we'll stop reminding you.</p>`,
      text: `We're in the final week before ${eventLine}.\n\nWe've always appreciated you and would love to have you at this one. If you're in, apply now: ${events}\n\nNot interested in this date? One-click opt-out: ${optOut}`,
    }
  }
  if (stepKey === 'signup.t3') {
    return {
      subject: `Last chance — ${eventTitle} in 3 days`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>Last chance.</strong> There's still room available for <strong>${eventLine}</strong>.</p>` +
        `<p>If you want a table, today's the day to claim it.</p>` +
        `<p style="margin:24px 0;text-align:center"><a href="${events}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700">Apply now</a></p>` +
        `<p style="margin-top:24px;font-size:13px;color:#666">Not interested in this date? <a href="${optOut}" style="color:#666">Let us know in one click</a> and we'll stop reminding you.</p>`,
      text: `Last chance. There's still room available for ${eventLine}.\n\nIf you want a table, today's the day to claim it: ${events}\n\nNot interested in this date? One-click opt-out: ${optOut}`,
    }
  }
  if (stepKey === 'signup.t2') {
    return {
      subject: `Only 48 hours left — ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p>Only <strong>48 hours left</strong> to get on the list for <strong>${eventLine}</strong>.</p>` +
        `<p>After tomorrow, it's going to be hard to slot you in.</p>` +
        `<p style="margin:24px 0;text-align:center"><a href="${events}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700">Get on the list</a></p>` +
        `<p style="margin-top:24px;font-size:13px;color:#666">Not interested in this date? <a href="${optOut}" style="color:#666">Let us know in one click</a> and we'll stop reminding you.</p>`,
      text: `Only 48 hours left to get on the list for ${eventLine}.\n\nAfter tomorrow, it's going to be hard to slot you in: ${events}\n\nNot interested in this date? One-click opt-out: ${optOut}`,
    }
  }
  if (stepKey === 'signup.t1') {
    return {
      subject: `Last chance to send in your application — ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>${eventLine}</strong> is <strong>tomorrow</strong>. This is your last chance to send in your application.</p>` +
        `<p>One tap and you're in.</p>` +
        `<p style="margin:24px 0;text-align:center"><a href="${events}" style="display:inline-block;background:#C8102E;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700">Apply now</a></p>` +
        `<p style="margin-top:24px;font-size:13px;color:#666">Not interested in this date? <a href="${optOut}" style="color:#666">Let us know in one click</a> and we'll stop reminding you.</p>`,
      text: `${eventLine} is tomorrow. Last chance to send in your application: ${events}\n\nNot interested in this date? One-click opt-out: ${optOut}`,
    }
  }

  // ─── Track B — lineup hype + logistics (approved FOR this event) ───
  const cantMakeIt = `<p style="margin-top:24px;font-size:13px;color:#666">Plans changed? <a href="${cancel}" style="color:#666">Let us know in one click</a> so we can plan ahead.</p>`
  const cantMakeItText = `\n\nPlans changed? One-click cancel here: ${cancel}`

  if (stepKey === 'lineup.t21') {
    return {
      subject: `Congratulations — you're approved for ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>Congratulations.</strong> Trainer Center HB has approved you for <strong>${eventLine}</strong>. We appreciate the partnership and look forward to vending with you.</p>` +
        `<p style="margin:18px 0 8px;font-weight:700">Logistics:</p>` +
        `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li>We provide a <strong>6-foot table</strong></li><li>We provide a <strong>black table cloth</strong> (free)</li><li>Just bring the product you want to sell</li><li>Have cash on hand for exchanges</li></ul>` +
        `<p>Next week we'll post for the event officially and kick off the 2-week promotion sprint.</p>` +
        cantMakeIt,
      text: `Congratulations. Trainer Center HB has approved you for ${eventLine}. We appreciate the partnership and look forward to vending with you.\n\nLogistics:\n- We provide a 6-foot table\n- We provide a black table cloth (free)\n- Just bring the product you want to sell\n- Have cash on hand for exchanges\n\nNext week we'll post for the event officially and kick off the 2-week promotion sprint.` + cantMakeItText,
    }
  }
  if (stepKey === 'lineup.t14') {
    return {
      subject: `Critical — promote ${eventTitle} on Instagram`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p>Two weeks out from <strong>${eventLine}</strong>. Trainer Center HB has posted on Instagram. Now we need you.</p>` +
        `<p><strong>This is part of the arrangement for your table.</strong> Find our pinned post on <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a> and:</p>` +
        `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Send it as a DM</strong> to 5–10 people who'd be interested</li><li><strong>Repost it</strong> to your own IG (story or grid)</li><li><strong>Like, comment, and save</strong> the post on our page</li><li>Tap the <strong>reminder bell</strong> on the post so IG pushes it to you and your audience</li></ul>` +
        `<p>Why this matters for <em>you</em>: less engagement on our post means fewer customers walking in your direction. <strong>Fewer customers means less money for you.</strong></p>` +
        `<p>This is your day. Your sales. Your relationships. We're giving you the table — help us pack the room.</p>` +
        cantMakeIt,
      text: `Two weeks out from ${eventLine}. Trainer Center HB has posted on Instagram. Now we need you.\n\nThis is part of the arrangement for your table. Find our pinned post on @trainercenter.pokemon and:\n- Send it as a DM to 5–10 people\n- Repost it to your own IG\n- Like, comment, and save the post\n- Tap the reminder bell\n\nWhy this matters for YOU: less engagement on our post means fewer customers walking in your direction. Fewer customers means less money for you.\n\nThis is your day. Your sales. Your relationships.` + cantMakeItText,
    }
  }
  if (stepKey === 'lineup.t7') {
    return {
      subject: `One week to ${eventTitle} — have you promoted yet?`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>${eventLine}</strong> is one week from today.</p>` +
        `<p>If you haven't yet engaged with our pinned post on <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a>, today's the day. Repost, DM 5–10 people, like, comment, save.</p>` +
        `<p>If you already did — bonus push: do it again. The closer we get, the more traction matters.</p>` +
        cantMakeIt,
      text: `${eventLine} is one week from today.\n\nIf you haven't yet engaged with our pinned post on @trainercenter.pokemon, today's the day. Repost, DM 5–10 people, like, comment, save.\n\nIf you already did — bonus push: do it again.` + cantMakeItText,
    }
  }
  if (stepKey === 'lineup.t3') {
    return {
      subject: `3 days out — your ${eventTitle} checklist`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>${eventLine}</strong> is in 3 days. Here's your prep checklist.</p>` +
        `<p style="margin:18px 0 8px;font-weight:700">Before event day:</p>` +
        `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Make your own IG QR code</strong> so customers can follow you on the spot</li><li>One last Instagram push — repost, DM, comment on our pinned post</li><li>Have <strong>cash on hand</strong> for exchanges</li><li>Pack the product you want to sell + your QR sign</li></ul>` +
        `<p style="margin:18px 0 8px;font-weight:700">During the event:</p>` +
        `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Take photos and videos</strong> we can post on the Trainer Center HB website — tag you and your business</li><li><strong>Keep cash out of frame</strong> in those photos — focus on the products, the relationships, the families and youth having fun</li><li>Your own personal content can include whatever you want, this is just for the public-facing recap on our site</li></ul>` +
        `<p>This is the push window. Let's pack the room.</p>` +
        cantMakeIt,
      text: `${eventLine} is in 3 days. Here's your prep checklist.\n\nBefore event day:\n- Make your own IG QR code so customers can follow you on the spot\n- One last Instagram push — repost, DM, comment on our pinned post\n- Have cash on hand for exchanges\n- Pack the product you want to sell + your QR sign\n\nDuring the event:\n- Take photos and videos we can post on the Trainer Center HB website — tag you and your business\n- Keep cash out of frame in those photos — focus on the products, the relationships, the families and youth having fun\n- Your own personal content can include whatever you want; this is just for the public-facing recap on our site\n\nThis is the push window.` + cantMakeItText,
    }
  }
  if (stepKey === 'lineup.t2') {
    return {
      subject: `2 days out — logistics for ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>${eventLine}</strong> is in 2 days.</p>` +
        `<p>${vendorTimes ? `Your confirmed time slot: <strong>${vendorTimes}</strong>.` : 'Confirmed for the event.'} 6-foot table and black cloth provided. Just bring your product, your QR code, and cash for exchanges.</p>` +
        `<p>Address: 4911 Warner Ave #210, Huntington Beach, CA 92649.</p>` +
        cantMakeIt,
      text: `${eventLine} is in 2 days.\n\n${vendorTimes ? `Your confirmed time slot: ${vendorTimes}. ` : ''}6-foot table and black cloth provided. Just bring your product, your QR code, and cash for exchanges.\n\nAddress: 4911 Warner Ave #210, Huntington Beach, CA 92649.` + cantMakeItText,
    }
  }
  if (stepKey === 'lineup.t1') {
    return {
      subject: `Tomorrow! ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>${eventLine}</strong> is tomorrow.</p>` +
        `<p>Final reminders:</p>` +
        `<ul style="margin:0 0 18px;padding-left:20px;color:#444;line-height:1.7"><li><strong>Arrive 30 minutes early</strong> to set up</li><li>4911 Warner Ave #210, Huntington Beach, CA 92649</li><li>Park anywhere in the lot</li><li>One last IG push — repost or story our pinned post if you haven't yet</li><li>Don't forget your IG QR code and cash for exchanges</li></ul>` +
        cantMakeIt,
      text: `${eventLine} is tomorrow.\n\nFinal reminders:\n- Arrive 30 minutes early to set up\n- 4911 Warner Ave #210, Huntington Beach, CA 92649\n- Park anywhere in the lot\n- One last IG push — repost or story our pinned post if you haven't yet\n- Don't forget your IG QR code and cash for exchanges` + cantMakeItText,
    }
  }
  if (stepKey === 'lineup.t0') {
    return {
      subject: `Today's the day — ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p>` +
        `<p><strong>Today's the day.</strong> ${eventLine}.</p>` +
        `<p>See you at the shop. Drive safe, bring water, take photos for the recap.</p>`,
      text: `Today's the day. ${eventLine}.\n\nSee you at the shop. Drive safe, bring water, take photos for the recap.`,
    }
  }
  return null
}

function wrapHtml(inner: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
      <tr><td style="background:#C8102E;padding:24px 32px;text-align:center">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.01em">Trainer Center HB</h1>
        <p style="margin:4px 0 0;color:#fbb;font-size:12px">California's Pokemon-only shop</p>
      </td></tr>
      <tr><td style="padding:32px">${inner}<p style="margin:24px 0 0;text-align:center"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a></p></td></tr>
      <tr><td style="background:#f5f5f5;padding:16px 32px;text-align:center">
        <p style="font-size:11px;color:#888;margin:0">4911 Warner Ave #210 · Huntington Beach, CA 92649 · (714) 951-9100</p>
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`
}

async function sendResendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) {
    console.log('[vendor-event-drip] RESEND_API_KEY not set; skipping')
    return { skipped: true }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], bcc: [CHEF_BCC], subject, html, text }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`resend: ${err}`)
  }
  return await res.json()
}

function formatEventDate(eventDate: string) {
  const d = new Date(eventDate + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime12h(t: string | null | undefined) {
  if (!t) return ''
  const [h, m] = t.slice(0, 5).split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return m === '00' ? `${h12} ${ampm}` : `${h12}:${m} ${ampm}`
}

function vendorTimeLine(ev: any) {
  const s = ev.vendor_start_time || ev.start_time
  const e = ev.vendor_end_time || ev.end_time
  if (!s && !e) return ''
  return `${formatTime12h(s)} - ${formatTime12h(e)}`
}

function todayUTC() {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!SERVICE_ROLE) return json({ error: 'service role missing' }, 500)
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  const today = todayUTC()
  const todayISO = today.toISOString().slice(0, 10)
  const horizon = new Date(today); horizon.setUTCDate(horizon.getUTCDate() + 21)
  const horizonISO = horizon.toISOString().slice(0, 10)

  // Pull every uncancelled vendor-day event in the next 21 days
  const { data: events, error: evErr } = await supabase
    .from('events')
    .select('*, vendor_applications(vendor_id, status)')
    .eq('has_vendors', true)
    .eq('cancelled', false)
    .gte('event_date', todayISO)
    .lte('event_date', horizonISO)
  if (evErr) return json({ error: evErr.message }, 500)

  const sentSummary: Record<string, number> = {}
  const sentDetails: { vendor_id: string; event_id: string; step_key: string; email: string }[] = []
  const failed: { vendor_id: string; event_id: string; step_key: string; reason: string }[] = []

  for (const ev of (events || [])) {
    const evDate = new Date(ev.event_date + 'T00:00:00Z')
    const daysUntil = Math.round((evDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const dateStr = formatEventDate(ev.event_date)
    const vendorTimes = vendorTimeLine(ev)
    const eventTitle = ev.title || "TC's Beach City Trade Night"
    const apps = ev.vendor_applications || []
    const appliedSet = new Set(apps.map((a: any) => a.vendor_id))
    const approvedForEventSet = new Set(apps.filter((a: any) => a.status === 'approved').map((a: any) => a.vendor_id))

    // Track A: signup push (approved partners NOT yet applied to this event).
    // Exclude staff: vendors whose user_id maps to a profile with is_admin=true
    // are people like Chef and Seth who also happen to be vendors. They don't
    // need the drip — they ARE the people sending it.
    const signupStep = activeStep(SIGNUP_STEPS, daysUntil)
    if (signupStep) {
      const { data: approvedVendors } = await supabase
        .from('vendors').select('id, name, email, user_id, response_token').eq('status', 'approved')
      const { data: adminProfiles } = await supabase
        .from('profiles').select('id').eq('is_admin', true)
      const adminIds = new Set((adminProfiles || []).map(p => p.id))
      const targets = (approvedVendors || []).filter(v =>
        !appliedSet.has(v.id) &&
        v.email &&
        !adminIds.has(v.user_id)
      )
      for (const v of targets) {
        // Pre-insert log row → unique constraint dedups
        const { error: logErr } = await supabase
          .from('vendor_email_log')
          .insert({ vendor_id: v.id, event_id: ev.id, step_key: signupStep.key })
        if (logErr) continue // already sent
        const links = buildLinks(v.response_token, ev.id)
        const c = copyForStep(signupStep.key, eventTitle, dateStr, v.name, vendorTimes, links)
        if (!c) continue
        try {
          await new Promise(r => setTimeout(r, 550)) // ~2/sec rate limit
          await sendResendEmail(v.email, c.subject, wrapHtml(c.html), c.text)
          sentSummary[signupStep.key] = (sentSummary[signupStep.key] || 0) + 1
          sentDetails.push({ vendor_id: v.id, event_id: ev.id, step_key: signupStep.key, email: v.email })
        } catch (err) {
          failed.push({ vendor_id: v.id, event_id: ev.id, step_key: signupStep.key, reason: (err as Error).message })
          // Roll back the log row so a future cron tick can retry
          await supabase.from('vendor_email_log')
            .delete()
            .eq('vendor_id', v.id)
            .eq('event_id', ev.id)
            .eq('step_key', signupStep.key)
        }
      }
    }

    // Track B: lineup hype + logistics (approved FOR this event).
    // Same staff exclusion — Chef/Seth showing up for vendor day doesn't mean
    // they need the "see you there" autoreply.
    const lineupStep = activeStep(LINEUP_STEPS, daysUntil)
    if (lineupStep && approvedForEventSet.size > 0) {
      const ids = [...approvedForEventSet]
      const { data: approvedForEvent } = await supabase
        .from('vendors').select('id, name, email, user_id, response_token').in('id', ids)
      const { data: adminProfilesB } = await supabase
        .from('profiles').select('id').eq('is_admin', true)
      const adminIdsB = new Set((adminProfilesB || []).map(p => p.id))
      for (const v of (approvedForEvent || [])) {
        if (!v.email) continue
        if (adminIdsB.has(v.user_id)) continue
        const { error: logErr } = await supabase
          .from('vendor_email_log')
          .insert({ vendor_id: v.id, event_id: ev.id, step_key: lineupStep.key })
        if (logErr) continue
        const links = buildLinks(v.response_token, ev.id)
        const c = copyForStep(lineupStep.key, eventTitle, dateStr, v.name, vendorTimes, links)
        if (!c) continue
        try {
          await new Promise(r => setTimeout(r, 550))
          await sendResendEmail(v.email, c.subject, wrapHtml(c.html), c.text)
          sentSummary[lineupStep.key] = (sentSummary[lineupStep.key] || 0) + 1
          sentDetails.push({ vendor_id: v.id, event_id: ev.id, step_key: lineupStep.key, email: v.email })
        } catch (err) {
          failed.push({ vendor_id: v.id, event_id: ev.id, step_key: lineupStep.key, reason: (err as Error).message })
          await supabase.from('vendor_email_log')
            .delete()
            .eq('vendor_id', v.id)
            .eq('event_id', ev.id)
            .eq('step_key', lineupStep.key)
        }
      }
    }
  }

  return json({ ok: true, summary: sentSummary, details: sentDetails, failed, today: todayISO })
})
