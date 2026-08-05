// ShinyVault checkout — shipping rate quotes + order creation + Stripe
// Checkout Session creation, on the same connected Stripe account as
// Trainer Center's own payments (see stripe-connect). App Catalyst takes a
// flat 1% platform fee on every sale (application_fee_amount), separate
// from Trainer Center's unrelated 50/50 vendor table-fee split in
// stripe-vendor-payment.
//
// create_checkout_session does BOTH the create_order() RPC call (atomic
// inventory hold) and the Stripe session creation in one request, instead
// of the browser calling create_order directly and then asking for a
// session — if the Stripe call failed after a client-driven create_order,
// the held inventory would have no expiring Checkout Session to eventually
// release it. Doing both here means a Stripe failure can roll the hold back
// immediately (see the catch block) rather than leaving it stuck until
// someone notices.
//
// Actions:
//   get_shipping_rate       { items: [{product_id, quantity}], to_address: {name, street1, street2?, city, state, zip, country} } -> { available, rate_cents?, carrier?, service?, shippo_rate_id?, reason? }
//   create_checkout_session { items, fulfillment_method, guest_email?, guest_name?, shipping_address?, shipping_rate_cents?, shipping_carrier?, shipping_service?, shippo_rate_id? } -> { url }
//   confirm_session          { session_id }                                 -> { ok, order_token? } — eager confirm on the success-page return trip; the
//                                                                              shinyvault-stripe-webhook function is the durable source of truth.
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const SHIPPO_API_KEY = Deno.env.get('SHIPPO_API_KEY') || ''
const SHIPPO_FROM = {
  name: Deno.env.get('SHIPPO_FROM_NAME') || 'ShinyVault',
  street1: Deno.env.get('SHIPPO_FROM_STREET1') || '',
  street2: Deno.env.get('SHIPPO_FROM_STREET2') || '',
  city: Deno.env.get('SHIPPO_FROM_CITY') || '',
  state: Deno.env.get('SHIPPO_FROM_STATE') || '',
  zip: Deno.env.get('SHIPPO_FROM_ZIP') || '',
  country: Deno.env.get('SHIPPO_FROM_COUNTRY') || 'US',
  phone: Deno.env.get('SHIPPO_FROM_PHONE') || '',
  email: Deno.env.get('SHIPPO_FROM_EMAIL') || '',
}

// Shipment extras, both intentionally OFF for launch.
//
// SIGNATURE_THRESHOLD_CENTS: order subtotal at or above which we request
// signature confirmation (~$3.95/parcel on USPS, rolled into the rate the
// customer pays, so it costs the shop nothing). Set to a positive number —
// $250 was the figure discussed — to switch it on. Off for now because the
// first live orders are self-shipped tests and nobody wants to be home to
// sign for them. Note that above ~$250 declared value most insurers *require*
// signature for coverage, so these two settings are related.
const SIGNATURE_THRESHOLD_CENTS = Number(Deno.env.get('SHINYVAULT_SIGNATURE_THRESHOLD_CENTS') || 0)

// INSURE_SHIPMENTS: Shippo insurance via XCover, 1.25% of declared value
// domestic. Billed to the Shippo account separately rather than folded into
// the carrier rate — so unlike signature, turning this on costs the shop
// money directly unless the total is adjusted to match. Deliberately left off
// until that call is made.
const INSURE_SHIPMENTS = (Deno.env.get('SHINYVAULT_INSURE_SHIPMENTS') || '') === 'true'

const SITE_URL = Deno.env.get('SHINYVAULT_SITE_URL') || 'https://shineyvault.netlify.app'
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// App Catalyst's flat 1% platform fee (see PLAN.md) — distinct from
// stripe-vendor-payment's estimated-post-Stripe-fee 50/50 split, which
// applies to an unrelated table-fee product.
const platformFeeCents = (totalCents: number) => Math.round(totalCents * 0.01)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const body = await req.json()
    const { action } = body

    // ─── Shipping rate quote (guest-callable — no auth required to price a cart) ───
    if (action === 'get_shipping_rate') {
      if (!SHIPPO_API_KEY) {
        return json({ available: false, reason: 'Shipping isn’t set up yet — please choose local pickup at checkout.' })
      }

      const items = Array.isArray(body.items) ? body.items : []
      if (!items.length) return json({ error: 'No items' }, 400)
      const to = body.to_address || {}
      if (!to.zip || !to.country) return json({ error: 'Destination address is incomplete' }, 400)

      const ids = items.map((i: any) => i.product_id)
      const { data: products, error: prodErr } = await supabase
        .from('products')
        .select('id, weight_oz, price_cents')
        .in('id', ids)
      if (prodErr) return json({ error: prodErr.message }, 500)

      let totalWeightOz = 0
      // Declared value, used for the signature threshold and (when enabled)
      // the insurance amount. Priced server-side from the products table
      // rather than trusted from the client.
      let declaredValueCents = 0
      for (const item of items) {
        const p = products?.find((pr: any) => pr.id === item.product_id)
        const qty = item.quantity || 1
        totalWeightOz += (p?.weight_oz || 4) * qty // 4oz default for unweighed items (single cards/sleeves)
        declaredValueCents += (p?.price_cents || 0) * qty
      }

      const { data: boxes, error: boxErr } = await supabase
        .from('shipping_boxes')
        .select('*')
        .eq('active', true)
        .order('weight_oz_max', { ascending: true })
      if (boxErr) return json({ error: boxErr.message }, 500)
      const box = (boxes || []).find((b: any) => b.weight_oz_max >= totalWeightOz) || boxes?.[boxes.length - 1]
      if (!box) return json({ available: false, reason: 'No shipping box configured yet.' })

      // Extras are priced into the rate we quote, so they have to be decided
      // here at quote time rather than at purchase time — otherwise the
      // customer gets charged one amount and we buy a more expensive label.
      const extra: Record<string, unknown> = {}
      if (SIGNATURE_THRESHOLD_CENTS > 0 && declaredValueCents >= SIGNATURE_THRESHOLD_CENTS) {
        extra.signature_confirmation = 'STANDARD'
      }
      if (INSURE_SHIPMENTS && declaredValueCents > 0) {
        extra.insurance = {
          amount: (declaredValueCents / 100).toFixed(2),
          currency: 'USD',
          content: 'Trading cards and collectibles',
        }
      }

      try {
        const spRes = await fetch('https://api.goshippo.com/shipments/', {
          method: 'POST',
          headers: {
            'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            address_from: SHIPPO_FROM,
            address_to: {
              // Carriers reject a parcel with no recipient name, so the
              // checkout form makes this required alongside street/city/zip.
              name: to.name || 'Customer',
              street1: to.street1, street2: to.street2 || undefined, city: to.city,
              state: to.state, zip: to.zip, country: to.country,
            },
            parcels: [{
              length: String(box.length_in), width: String(box.width_in), height: String(box.height_in),
              distance_unit: 'in',
              weight: String(totalWeightOz),
              mass_unit: 'oz',
            }],
            ...(Object.keys(extra).length ? { extra } : {}),
            // Synchronous so rates come back inline on this one call. Shippo
            // defaults to async:true, which returns an empty rates array and a
            // shipment to poll — not what a checkout page can wait around for.
            async: false,
          }),
        })
        const shipment = await spRes.json()
        if (!spRes.ok) {
          return json({ available: false, reason: shipment?.detail || 'Rate lookup failed' })
        }

        // Shippo returns an empty rates array plus a `messages` array when it
        // can't rate (bad address, no carrier serves it, parcel over limits).
        // Surfacing that text is the difference between the customer fixing
        // their address and giving up.
        const rates = (shipment.rates || []).slice()
          .sort((a: any, b: any) => parseFloat(a.amount) - parseFloat(b.amount))
        const cheapest = rates[0]
        if (!cheapest) {
          const msg = (shipment.messages || []).map((m: any) => m.text).filter(Boolean).join(' ')
          return json({ available: false, reason: msg || 'No carrier rates returned for that address' })
        }

        return json({
          available: true,
          rate_cents: Math.round(parseFloat(cheapest.amount) * 100),
          carrier: cheapest.provider,
          service: cheapest.servicelevel?.name || '',
          // The rate id, not the shipment id — buying a label is a single
          // POST /transactions/ against this.
          shippo_rate_id: cheapest.object_id,
        })
      } catch (e) {
        return json({ available: false, reason: (e as Error).message })
      }
    }

    // ─── Create the order (atomic inventory hold) + its Stripe Checkout Session ───
    if (action === 'create_checkout_session') {
      if (!stripeKey) return json({ error: 'Payments are not configured yet.' }, 500)
      const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

      const { data: settings } = await supabase
        .from('stripe_settings').select('stripe_account_id, charges_enabled').eq('id', 'main').maybeSingle()
      const acct = settings?.stripe_account_id
      if (!acct) return json({ error: 'Payments are not connected yet.' }, 400)
      const onAcct = { stripeAccount: acct }

      // Optional session — logged-in shoppers get user_id on the order and
      // order history; guests just need an email (enforced inside create_order).
      let userId: string | null = null
      const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
      if (token) {
        const { data: userData } = await supabase.auth.getUser(token)
        userId = userData?.user?.id || null
      }

      const items = Array.isArray(body.items) ? body.items : []
      if (!items.length) return json({ error: 'Cart is empty' }, 400)
      const fulfillment = body.fulfillment_method === 'ship' ? 'ship' : 'pickup'
      if (fulfillment === 'ship' && !body.shipping_rate_cents) {
        return json({ error: 'Get a shipping rate before checking out.' }, 400)
      }

      const { data: orderRows, error: orderErr } = await supabase.rpc('create_order', {
        p_user_id: userId,
        p_guest_email: body.guest_email || null,
        p_guest_name: body.guest_name || null,
        p_fulfillment_method: fulfillment,
        p_shipping_address: fulfillment === 'ship' ? body.shipping_address || null : null,
        p_shipping_rate_cents: fulfillment === 'ship' ? body.shipping_rate_cents : null,
        p_shipping_carrier: fulfillment === 'ship' ? body.shipping_carrier || null : null,
        p_shipping_service: fulfillment === 'ship' ? body.shipping_service || null : null,
        p_shippo_rate_id: fulfillment === 'ship' ? body.shippo_rate_id || null : null,
        p_items: items.map((i: any) => ({ product_id: i.product_id, quantity: i.quantity })),
      })
      if (orderErr) {
        const msg = orderErr.message || ''
        // 200 on purpose — "sold out" is an expected, UI-actionable outcome
        // (someone else bought the last one), not a server failure.
        if (msg.includes('sold_out:')) return json({ error: 'sold_out', product_id: msg.split('sold_out:')[1]?.trim() })
        return json({ error: msg || 'Could not create order' }, 400)
      }
      const order = orderRows?.[0]
      if (!order) return json({ error: 'Could not create order' }, 500)

      const { data: fullOrder } = await supabase
        .from('orders').select('*, order_items(*)').eq('id', order.order_id).maybeSingle()

      try {
        const lineItems = (fullOrder?.order_items || []).map((it: any) => ({
          quantity: it.quantity,
          price_data: {
            currency: 'usd',
            unit_amount: it.price_cents_snapshot,
            product_data: { name: it.product_name_snapshot },
          },
        }))
        if (fullOrder?.shipping_rate_cents) {
          lineItems.push({
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: fullOrder.shipping_rate_cents,
              product_data: { name: `Shipping — ${fullOrder.shipping_carrier || ''} ${fullOrder.shipping_service || ''}`.trim() },
            },
          })
        }

        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: lineItems,
          customer_email: fullOrder?.guest_email || undefined,
          payment_intent_data: {
            receipt_email: fullOrder?.guest_email || undefined,
            application_fee_amount: platformFeeCents(fullOrder.total_cents),
          },
          success_url: `${SITE_URL}/order/${order.order_token}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${SITE_URL}/cart`,
          metadata: { order_id: order.order_id },
          expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 6, // 6h hold on inventory before checkout.session.expired releases it
        }, onAcct)

        await supabase.from('orders').update({ stripe_checkout_session_id: session.id }).eq('id', order.order_id)
        return json({ url: session.url })
      } catch (stripeErr) {
        // Stripe session creation failed — the order already holds
        // inventory with no expiring Checkout Session to release it later,
        // so unwind it here instead of leaving stock stuck.
        console.error('[shinyvault-checkout] stripe session create failed, releasing hold', (stripeErr as Error).message)
        for (const it of fullOrder?.order_items || []) {
          if (it.product_id) await supabase.rpc('increment_product_stock', { p_product_id: it.product_id, p_quantity: it.quantity })
        }
        await supabase.from('orders').update({ payment_status: 'failed' }).eq('id', order.order_id)
        return json({ error: 'Could not start checkout — please try again.' }, 500)
      }
    }

    // ─── Eager confirm on the success-page return trip ───
    if (action === 'confirm_session') {
      if (!stripeKey) return json({ error: 'Payments are not configured yet.' }, 500)
      const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

      const { data: settings } = await supabase
        .from('stripe_settings').select('stripe_account_id').eq('id', 'main').maybeSingle()
      const acct = settings?.stripe_account_id
      if (!acct) return json({ error: 'Payments are not connected yet.' }, 400)

      const session = await stripe.checkout.sessions.retrieve(body.session_id, {}, { stripeAccount: acct })
      const orderId = session.metadata?.order_id
      if (!orderId) return json({ error: 'Session has no order' }, 400)
      if (session.payment_status !== 'paid') return json({ ok: false })

      const { data: order } = await supabase.from('orders').select('id, payment_status, order_token').eq('id', orderId).maybeSingle()
      if (!order) return json({ error: 'Order not found' }, 404)

      // Replay-safe — checkout.session.completed from the webhook may have
      // already flipped this; only update the first time either path wins.
      if (order.payment_status === 'pending') {
        const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
        await supabase.from('orders').update({
          payment_status: 'paid',
          stripe_payment_intent_id: piId,
        }).eq('id', order.id)
      }
      return json({ ok: true, order_token: order.order_token })
    }

    // ─── Admin: refund a paid order ───
    if (action === 'admin_refund') {
      if (!stripeKey) return json({ error: 'Payments are not configured yet.' }, 500)
      const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
      const { data: userData, error: userErr } = await supabase.auth.getUser(token)
      if (userErr || !userData?.user) return json({ error: 'Not logged in' }, 401)
      // Shiny Vault admin only. This runs on the service-role client, which
      // bypasses RLS, so this check IS the authorization boundary for refunds —
      // Trainer Center's is_admin must not be sufficient to move money here.
      const { data: prof } = await supabase
        .from('profiles').select('is_shinyvault_admin').eq('id', userData.user.id).maybeSingle()
      if (!prof?.is_shinyvault_admin) return json({ error: 'Staff only' }, 403)

      const { data: order } = await supabase.from('orders').select('*').eq('id', body.order_id).maybeSingle()
      if (!order) return json({ error: 'Order not found' }, 404)
      if (order.payment_status !== 'paid' || !order.stripe_payment_intent_id) {
        return json({ error: 'Nothing to refund' }, 400)
      }

      const { data: settings } = await supabase
        .from('stripe_settings').select('stripe_account_id').eq('id', 'main').maybeSingle()
      const acct = settings?.stripe_account_id
      if (!acct) return json({ error: 'Payments are not connected yet.' }, 400)
      const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

      await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id }, { stripeAccount: acct })
      await supabase.from('orders').update({ payment_status: 'refunded' }).eq('id', order.id)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[shinyvault-checkout]', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
