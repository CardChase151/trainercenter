// Edge Function: vendor-event-respond
//
// Public, token-authenticated endpoint hit from one-click links in drip emails.
// Accepts two modes:
//
//   mode=load
//     Returns vendor name + event title + date so the /vendors/respond page
//     can show "Hey [name], opt out of [event] on [date]?" before the vendor
//     confirms. Pure read.
//
//   mode=submit
//     Performs the action:
//       action=not_interested  → insert vendor_applications row, status=not_interested
//       action=cancel          → flip existing approved row to status=vendor_cancelled
//                                (reason required)
//     Fires staff notification email via send-vendor-email (vendor_optout_notify).
//
// Token = vendors.response_token (uuid, stable per vendor). The url also
// carries event_id + action; the token only proves "I am this vendor."
//
// Writes use the service role key — RLS would block anonymous writes
// otherwise, and the token *is* the credential here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') || ''

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
  mode: 'load' | 'submit'
  token: string
  event_id: string
  action: 'not_interested' | 'cancel'
  reason?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!SERVICE_ROLE) return json({ error: 'service role missing' }, 500)

  let payload: Payload
  try {
    payload = await req.json() as Payload
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const { mode, token, event_id, action } = payload
  if (!mode) return json({ error: 'mode required' }, 400)
  if (!token) return json({ error: 'token required' }, 400)
  if (!event_id) return json({ error: 'event_id required' }, 400)
  if (!action || (action !== 'not_interested' && action !== 'cancel')) {
    return json({ error: 'action must be not_interested or cancel' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Verify token → vendor
  const { data: vendor, error: vErr } = await supabase
    .from('vendors')
    .select('id, name, email, status')
    .eq('response_token', token)
    .single()
  if (vErr || !vendor) return json({ error: 'invalid token' }, 404)

  // Load event for display + validation
  const { data: ev, error: eErr } = await supabase
    .from('events')
    .select('id, title, event_date, vendor_start_time, vendor_end_time, start_time, end_time, cancelled')
    .eq('id', event_id)
    .single()
  if (eErr || !ev) return json({ error: 'event not found' }, 404)

  // Look up any existing application so the page can branch on it
  const { data: existingApp } = await supabase
    .from('vendor_applications')
    .select('id, status')
    .eq('vendor_id', vendor.id)
    .eq('event_id', event_id)
    .maybeSingle()

  if (mode === 'load') {
    return json({
      ok: true,
      vendor: { id: vendor.id, name: vendor.name },
      event: {
        id: ev.id,
        title: ev.title,
        event_date: ev.event_date,
        cancelled: ev.cancelled,
      },
      existing_status: existingApp?.status || null,
      action,
    })
  }

  // mode === 'submit'
  if (ev.cancelled) {
    return json({ error: 'event already cancelled' }, 400)
  }

  if (action === 'not_interested') {
    // Idempotent: if a row exists already, only act if it's not already
    // a vendor-side decision. (If they already opted out, no-op success.)
    if (existingApp) {
      if (existingApp.status === 'not_interested' || existingApp.status === 'vendor_cancelled') {
        return json({ ok: true, already_done: true, status: existingApp.status })
      }
      // Existing approved/pending/declined/cancelled — flip to not_interested
      const { error: updErr } = await supabase
        .from('vendor_applications')
        .update({ status: 'not_interested' })
        .eq('id', existingApp.id)
      if (updErr) return json({ error: updErr.message }, 500)
    } else {
      const placeholderStart = ev.vendor_start_time || ev.start_time || '12:00:00'
      const placeholderEnd   = ev.vendor_end_time   || ev.end_time   || '17:00:00'
      const { error: insErr } = await supabase
        .from('vendor_applications')
        .insert({
          vendor_id: vendor.id,
          event_id: ev.id,
          status: 'not_interested',
          requested_start_time: placeholderStart,
          requested_end_time: placeholderEnd,
        })
      if (insErr) return json({ error: insErr.message }, 500)
    }
  } else {
    // action === 'cancel'
    const reason = (payload.reason || '').trim()
    if (!reason) return json({ error: 'reason required for cancel' }, 400)
    if (!existingApp) return json({ error: 'no application to cancel' }, 400)
    if (existingApp.status === 'vendor_cancelled') {
      return json({ ok: true, already_done: true, status: 'vendor_cancelled' })
    }
    if (existingApp.status !== 'approved') {
      return json({ error: `cannot cancel an application with status '${existingApp.status}'` }, 400)
    }
    const { error: updErr } = await supabase
      .from('vendor_applications')
      .update({ status: 'vendor_cancelled', vendor_note: reason })
      .eq('id', existingApp.id)
    if (updErr) return json({ error: updErr.message }, 500)
  }

  // Fire staff notification (Chef + Chase) via the existing send-vendor-email
  // function. Done as a non-blocking fire-and-forget; failure here doesn't
  // roll back the DB write since the vendor's action already succeeded.
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-vendor-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({
        type: 'vendor_optout_notify',
        vendor_id: vendor.id,
        event_id: ev.id,
        optout_kind: action === 'cancel' ? 'vendor_cancelled' : 'not_interested',
        reason: action === 'cancel' ? (payload.reason || '').trim() : '',
      }),
    })
  } catch (notifyErr) {
    console.error('[vendor-event-respond] staff notify failed', notifyErr)
  }

  return json({ ok: true, action })
})
