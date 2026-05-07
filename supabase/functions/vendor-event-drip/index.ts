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
const FROM_ADDRESS  = 'Trainer Center HB <noreply@mysendz.com>'
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

// Per-step copy. Each tone escalates as the event approaches.
function copyForStep(stepKey: string, eventTitle: string, dateStr: string, vendorName: string, vendorTimes: string) {
  const eventLine = vendorTimes ? `${eventTitle} · ${dateStr} · ${vendorTimes}` : `${eventTitle} · ${dateStr}`
  const dashboard = `${SITE_URL}/vendors/dashboard`

  // Track A — signup push
  if (stepKey === 'signup.t21') {
    return {
      subject: `Save the date — ${eventTitle} on ${dateStr}`,
      html: `<p>Hi ${vendorName},</p><p>Heads up: <strong>${eventLine}</strong>. You're an approved partner — claim your table whenever you're ready.</p><p>Apply takes about 30 seconds.</p>`,
      text: `Heads up: ${eventLine}. You're an approved partner — claim your table whenever you're ready.\n\nApply: ${dashboard}`,
    }
  }
  if (stepKey === 'signup.t14') {
    return {
      subject: `2 weeks out — claim your spot for ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p><p>${eventLine} is two weeks away and the lineup is starting to fill in. Want a table?</p>`,
      text: `${eventLine} is two weeks away and the lineup is starting to fill in. Want a table?\n\nApply: ${dashboard}`,
    }
  }
  if (stepKey === 'signup.t7') {
    return {
      subject: `One week to apply — ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p><p>${eventLine} is <strong>one week from today</strong>. Spots are limited — apply now if you're in.</p>`,
      text: `${eventLine} is one week from today. Spots are limited — apply now if you're in.\n\nApply: ${dashboard}`,
    }
  }
  if (stepKey === 'signup.t3') {
    return {
      subject: `3 days left — ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p><p><strong>${eventLine}</strong> is in 3 days. Spots fill up fast in the final week.</p><p>Want in?</p>`,
      text: `${eventLine} is in 3 days. Spots fill up fast in the final week. Want in?\n\nApply: ${dashboard}`,
    }
  }
  if (stepKey === 'signup.t2') {
    return {
      subject: `2 days — last 48 hours to get on the list`,
      html: `<p>Hi ${vendorName},</p><p>${eventLine} is in 2 days. After tomorrow it's going to be hard to slot you in.</p>`,
      text: `${eventLine} is in 2 days. After tomorrow it's going to be hard to slot you in.\n\nApply: ${dashboard}`,
    }
  }
  if (stepKey === 'signup.t1') {
    return {
      subject: `Tomorrow — last chance for ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p><p>${eventLine} is <strong>tomorrow</strong>. This is the final window to get on the lineup.</p><p>One tap and you're in.</p>`,
      text: `${eventLine} is tomorrow. This is the final window to get on the lineup. One tap and you're in.\n\nApply: ${dashboard}`,
    }
  }

  // Track B — lineup hype + logistics
  if (stepKey === 'lineup.t21') {
    return {
      subject: `You're in — ${eventTitle} on ${dateStr}`,
      html: `<p>Hi ${vendorName},</p><p>You're approved for <strong>${eventLine}</strong>. Three weeks out — let's make it big.</p>`,
      text: `You're approved for ${eventLine}. Three weeks out — let's make it big.\n\nDashboard: ${dashboard}`,
    }
  }
  if (stepKey === 'lineup.t14') {
    return {
      subject: `2 weeks out — start telling your community`,
      html: `<p>Hi ${vendorName},</p><p>${eventLine} is two weeks out. Now's a good time to start telling your community you'll be there.</p>`,
      text: `${eventLine} is two weeks out. Now's a good time to start telling your community you'll be there.\n\nDashboard: ${dashboard}`,
    }
  }
  if (stepKey === 'lineup.t7') {
    return {
      subject: `One week — post on IG and tag @trainercenter.pokemon`,
      html: `<p>Hi ${vendorName},</p><p>${eventLine} is one week from today.</p><p>Big ask: <strong>post about it on IG and tag <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a></strong>. We'll repost the best ones.</p>`,
      text: `${eventLine} is one week from today.\n\nBig ask: post about it on IG and tag @trainercenter.pokemon. We'll repost the best ones.\n\nDashboard: ${dashboard}`,
    }
  }
  if (stepKey === 'lineup.t3') {
    return {
      subject: `3 days out — big push, post + tag us`,
      html: `<p>Hi ${vendorName},</p><p><strong>${eventLine}</strong> is in 3 days. This is the push window.</p><ul><li>Post on your IG today</li><li>Tag <a href="https://instagram.com/trainercenter.pokemon">@trainercenter.pokemon</a></li><li>Story it. Reels are best.</li></ul><p>You bring traffic, we bring traffic, everyone wins.</p>`,
      text: `${eventLine} is in 3 days. This is the push window.\n\n- Post on your IG today\n- Tag @trainercenter.pokemon\n- Story it. Reels are best.\n\nYou bring traffic, we bring traffic, everyone wins.\n\nDashboard: ${dashboard}`,
    }
  }
  if (stepKey === 'lineup.t2') {
    return {
      subject: `2 days out — quick logistics for ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p><p>${eventLine} is in 2 days. Confirmed time slot${vendorTimes ? `: <strong>${vendorTimes}</strong>` : ''}.</p><p>Bring your singles, slabs, sealed product — whatever you specialize in. Tables and chairs provided.</p>`,
      text: `${eventLine} is in 2 days. Confirmed time slot${vendorTimes ? `: ${vendorTimes}` : ''}.\n\nBring your singles, slabs, sealed product — whatever you specialize in. Tables and chairs provided.\n\nDashboard: ${dashboard}`,
    }
  }
  if (stepKey === 'lineup.t1') {
    return {
      subject: `Tomorrow! ${eventTitle}`,
      html: `<p>Hi ${vendorName},</p><p><strong>${eventLine}</strong> is tomorrow.</p><p>Final reminders:</p><ul><li>Arrive ~30 min early to set up</li><li>4911 Warner Ave #210, Huntington Beach</li><li>Park anywhere in the lot</li></ul><p>If you haven't posted on IG yet, today's the day. Tag us.</p>`,
      text: `${eventLine} is tomorrow.\n\nFinal reminders:\n- Arrive ~30 min early to set up\n- 4911 Warner Ave #210, Huntington Beach\n- Park anywhere in the lot\n\nIf you haven't posted on IG yet, today's the day. Tag us.\n\nDashboard: ${dashboard}`,
    }
  }
  if (stepKey === 'lineup.t0') {
    return {
      subject: `See you there! ${eventTitle} today`,
      html: `<p>Hi ${vendorName},</p><p><strong>Today's the day.</strong> ${eventLine}.</p><p>See you at the shop. Drive safe, bring water.</p>`,
      text: `Today's the day. ${eventLine}.\n\nSee you at the shop. Drive safe, bring water.\n\nDashboard: ${dashboard}`,
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
    const eventTitle = ev.title || 'Vendor Day'
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
        .from('vendors').select('id, name, email, user_id').eq('status', 'approved')
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
        const c = copyForStep(signupStep.key, eventTitle, dateStr, v.name, vendorTimes)
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
        .from('vendors').select('id, name, email, user_id').in('id', ids)
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
        const c = copyForStep(lineupStep.key, eventTitle, dateStr, v.name, vendorTimes)
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
