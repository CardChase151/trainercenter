// Edge Function: shinyvault-buy-label
//
// Buys a shipping label for an order that does not have one. Staff-triggered
// from the Fulfillment board's "Retry label" button.
//
// Why this exists (Chase 2026-08-27): the label was only ever bought in one
// place, inside shinyvault-stripe-webhook, at the moment payment cleared. If
// that purchase failed the order was simply left with no label and no way to
// get one from the app - the Retry button was disabled with a comment saying
// to go buy it in the Shippo dashboard and paste the URL onto the order by
// hand. That is what happened on 2026-08-26 when a UPS label was refused
// because the UPS account had never been activated: paid customer, no label,
// nothing staff could do in the tool they were standing in.
//
// THIS SPENDS REAL MONEY. Every successful call buys postage on the Shippo
// account. Hence: staff-only, one label per order enforced by re-reading the
// order inside the request, and a hard refusal if a label already exists.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SHIPPO_API_KEY = Deno.env.get('SHIPPO_API_KEY') || ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // ── Auth: shinyvault admin only ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: userData } = await supa.auth.getUser()
    if (!userData?.user) return json({ error: 'Not signed in' }, 401)
    const { data: prof } = await supa
      .from('profiles').select('is_shinyvault_admin').eq('id', userData.user.id).maybeSingle()
    if (!prof?.is_shinyvault_admin) return json({ error: 'Staff only' }, 403)

    const body = await req.json().catch(() => ({}))
    const orderId = body?.order_id
    if (!orderId) return json({ error: 'No order_id provided' }, 400)

    // Service role from here: the order read and write must not depend on
    // whatever RLS the staff session happens to carry.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: order } = await admin
      .from('orders')
      .select('id, fulfillment_method, shippo_rate_id, label_url, payment_status')
      .eq('id', orderId)
      .maybeSingle()

    if (!order) return json({ error: 'Order not found' }, 404)
    // Never buy twice. The board can double-fire, and a second label is a
    // second charge plus a parcel with two tracking numbers.
    if (order.label_url) return json({ error: 'This order already has a label' }, 409)
    if (order.fulfillment_method !== 'ship') {
      return json({ error: 'This is a pickup order - it does not need a label' }, 400)
    }
    if (!order.shippo_rate_id) {
      return json({
        error: 'No shipping rate was saved for this order, so there is nothing to buy from. '
          + 'Buy the label in Shippo and paste the URL onto the order.',
      }, 422)
    }
    if (!SHIPPO_API_KEY) return json({ error: 'Shipping is not configured' }, 500)

    // Same purchase the webhook does. Synchronous so the label URL and
    // tracking number come back on this response rather than needing a poll.
    const buyRes = await fetch('https://api.goshippo.com/transactions/', {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rate: order.shippo_rate_id,
        label_file_type: 'PDF_4x6',
        async: false,
      }),
    })
    const bought = await buyRes.json()

    // Shippo answers 201 even when the purchase failed - the truth is in
    // bought.status, with the reason in bought.messages.
    if (!buyRes.ok || bought?.status !== 'SUCCESS') {
      const why = (bought?.messages || []).map((m: any) => m.text).filter(Boolean).join(' ')
      console.error('[shinyvault-buy-label] purchase failed', why || bought)
      // The reason is RETURNED, not stored. Storing it would need a new column
      // on orders, and this project has ~44 local migrations unrecorded in
      // remote history, so a schema change here is not a thing to do casually.
      // Returning it gets staff the actual carrier message on screen the
      // moment they press the button, which is the whole point - previously
      // this text only ever reached a server log nobody reads.
      return json({
        error: why || 'The carrier refused the label purchase',
        rate_expired: /rate.*(expire|not found|invalid)/i.test(why || ''),
      }, 422)
    }

    await admin.from('orders').update({
      fulfillment_status: 'label_purchased',
      tracking_number: bought?.tracking_number || null,
      tracking_url: bought?.tracking_url_provider || null,
      label_url: bought?.label_url || null,
    }).eq('id', order.id)

    return json({
      ok: true,
      label_url: bought?.label_url || null,
      tracking_number: bought?.tracking_number || null,
    })
  } catch (e) {
    console.error('[shinyvault-buy-label] error', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
