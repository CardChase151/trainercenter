// Edge Function: send-vendor-email
// Resend-backed transactional emails for the vendor + member system.
//
// Types:
//   - vendor_welcome        (vendor finishes onboarding)
//   - member_welcome        (member finishes onboarding)
//   - application_received  (vendor applies for an event)
//   - application_decided   (staff approves/declines an application)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const FROM_ADDRESS = 'Trainer Center <noreply@mysendz.com>'
const STAFF_EMAILS = ['chase@appcatalyst.org', 'Trainercenter.pokemon@gmail.com']
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
  type: 'vendor_welcome' | 'member_welcome' | 'application_received' | 'application_decided'
  vendor_id?: string
  member_id?: string
  application_id?: string
  is_first_time?: boolean
}

async function sendResendEmail(to: string[], subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) {
    console.log('[send-vendor-email] RESEND_API_KEY not set; skipping send')
    return { skipped: true }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html, text }),
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

function wrapHtml(inner: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
      <tr><td style="background:#C8102E;padding:24px 32px;text-align:center">
        <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.01em">Trainer Center</h1>
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
      const { data: v, error: vErr } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', payload.vendor_id)
        .single()
      if (vErr || !v) return json({ error: vErr?.message || 'vendor not found' }, 404)

      const subject = 'Welcome to Trainer Center vendors'
      const body = `<p>Hi ${v.name},</p>` +
        `<p>Your vendor profile is in. Chef will personally review it before approving you. Once approved, you can apply for any upcoming Vendor Day in two clicks from your dashboard.</p>` +
        `<p><strong>Vendor Day cadence:</strong> last Friday of every month at the shop.</p>` +
        `<p>While you wait, drop by Trainer Center or follow <a href="https://instagram.com/trainercenter.pokemon" style="color:#C8102E">@trainercenter.pokemon</a> on Instagram.</p>` +
        `<p style="margin-top:24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a></p>`
      await sendResendEmail([v.email], subject, wrapHtml(body),
        `Welcome to Trainer Center vendors, ${v.name}!\n\nDashboard: ${SITE_URL}/vendors/dashboard`)
      return json({ ok: true, sent: ['vendor'] })
    }

    if (type === 'member_welcome') {
      if (!payload.member_id) return json({ error: 'member_id required' }, 400)
      const { data: m, error: mErr } = await supabase
        .from('members')
        .select('*')
        .eq('id', payload.member_id)
        .single()
      if (mErr || !m) return json({ error: mErr?.message || 'member not found' }, 404)

      const subject = 'Welcome to the Trainer Center community'
      const body = `<p>Hi ${m.first_name || 'there'},</p>` +
        `<p>You're in! You can vote for your favorite vendors at any future Vendor Day. Voting opens at the shop on event day — just tap <strong>Review Vendors</strong> on the Vendors page when you're here.</p>` +
        `<p><strong>Vendor Day cadence:</strong> last Friday of every month.</p>` +
        `<p>We'll send you a reminder a few days before the next one. No spam, no list-selling — just shop news.</p>` +
        `<p style="margin-top:24px"><a href="${SITE_URL}/vendors" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">See Vendors page</a></p>`
      await sendResendEmail([m.email], subject, wrapHtml(body),
        `Welcome to Trainer Center, ${m.first_name || ''}!\n\nVendor Day = last Friday of every month. Vote at the shop on event day.\n\n${SITE_URL}/vendors`)
      return json({ ok: true, sent: ['member'] })
    }

    if (type === 'application_received' || type === 'application_decided') {
      if (!payload.application_id) return json({ error: 'application_id required' }, 400)
      const { data: app, error: aErr } = await supabase
        .from('vendor_applications')
        .select('*, vendor:vendors(*), event:events(*)')
        .eq('id', payload.application_id)
        .single()
      if (aErr || !app) return json({ error: aErr?.message || 'application not found' }, 404)

      const v = app.vendor
      const e = app.event
      const dateStr = e?.event_date ? formatEventDate(e.event_date) : 'an upcoming Vendor Day'
      const eventTitle = e?.title || 'Vendor Day'

      if (type === 'application_received') {
        const vendorSubject = `Got your application for ${dateStr}`
        const vendorBody = `<p>Hi ${v.name},</p><p>We got your interest in vending on <strong>${dateStr}</strong> for <strong>${eventTitle}</strong>. Chef will confirm your spot soon.</p>`
        await sendResendEmail([v.email], vendorSubject,
          wrapHtml(vendorBody + `<p style="margin-top:24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#C8102E;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open your dashboard</a></p>`),
          `${vendorSubject}\n\nDashboard: ${SITE_URL}/vendors/dashboard`
        )
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
        const subject = `You're in for ${dateStr}`
        const body = `<p>Hi ${v.name},</p><p>Chef approved your application for <strong>${eventTitle}</strong> on <strong>${dateStr}</strong>.</p><p>Bring your inventory, your energy, and your A-game. When you arrive on event day, log in and tap <strong>Check in</strong> on your dashboard. After the event you can come back and upload photos and a clip from your table — those go on our public Vendors page.</p>${app.decision_note ? `<p style="font-size:14px;background:#f9fafb;border-left:3px solid #16a34a;padding:10px 14px">${app.decision_note}</p>` : ''}<p style="margin-top:24px"><a href="${SITE_URL}/vendors/dashboard" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Open dashboard</a></p>`
        await sendResendEmail([v.email], subject, wrapHtml(body),
          `Approved for ${eventTitle} on ${dateStr}.\n\nDashboard: ${SITE_URL}/vendors/dashboard`)
      } else if (status === 'declined') {
        const subject = `About your Vendor Day application`
        const body = `<p>Hi ${v.name},</p><p>Thanks for applying for <strong>${eventTitle}</strong> on <strong>${dateStr}</strong>. We aren't able to accommodate you this time.</p>${app.decision_note ? `<p style="font-size:14px;background:#f9fafb;border-left:3px solid #999;padding:10px 14px">${app.decision_note}</p>` : ''}<p>You're welcome to apply for future Vendor Days. We appreciate your interest in Trainer Center.</p>`
        await sendResendEmail([v.email], subject, wrapHtml(body),
          `About your Vendor Day application: not approved this time.`)
      } else {
        return json({ ok: true, skipped: 'not a notify-worthy status' })
      }
      return json({ ok: true, sent: ['vendor'] })
    }

    return json({ error: `unknown type: ${type}` }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
