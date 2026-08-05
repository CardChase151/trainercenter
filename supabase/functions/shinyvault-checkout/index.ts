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
//   get_shipping_rate       { items: [{product_id, quantity}], to_address: {name, street1, street2?, city, state, zip, country} }
//                             -> { available, options?: [{shippo_rate_id, carrier, service, estimated_days, postage_cents, insurance_cents, total_cents, cheapest, fastest}],
//                                  insurance_cents?, declared_value_cents?, signature_required?, reason? }
//   create_checkout_session { items, fulfillment_method, guest_email?, guest_name?, shipping_address?, shippo_rate_id? } -> { url }
//                             Shipping cost/carrier/service are re-derived from shippo_rate_id server-side, NOT accepted from the client.
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

// ─── Shipment extras ────────────────────────────────────────
// Both are priced into the shipping figure the customer pays, so neither costs
// the shop anything. Both are decided at QUOTE time, not purchase time — they
// change the carrier rate and the shipment record, and the webhook later buys a
// rate id that already has them baked in.

// Signature confirmation above this declared value (~$3.95/parcel on USPS,
// included in the carrier rate Shippo returns). $250 by default: that is also
// roughly where insurers start *requiring* a signature for coverage, so the two
// thresholds are deliberately related.
const SIGNATURE_THRESHOLD_CENTS = Number(Deno.env.get('SHINYVAULT_SIGNATURE_THRESHOLD_CENTS') || 25000)

// Insurance above this declared value. $100 by default, and that number is not
// arbitrary: USPS Ground Advantage includes $100 of coverage in the label price,
// and UPS Ground includes $100 of declared-value liability. Insuring below that
// buys coverage the carrier already provides for free.
const INSURANCE_MIN_CENTS = Number(Deno.env.get('SHINYVAULT_INSURANCE_MIN_CENTS') || 10000)

// Shippo insurance (XCover) is 1.25% of declared value domestic. Unlike
// signature, Shippo bills this to the account SEPARATELY from the carrier rate —
// it never appears in rate.amount — so it has to be added to the customer's
// shipping line explicitly or the shop silently eats it.
const INSURANCE_RATE = Number(Deno.env.get('SHINYVAULT_INSURANCE_RATE') || 0.0125)

// Kill switch: set to 'false' to stop insuring regardless of threshold.
const INSURANCE_ENABLED = (Deno.env.get('SHINYVAULT_INSURANCE_ENABLED') || 'true') !== 'false'

// How many service options to offer at checkout. Cheapest is always included;
// the rest are the cheapest option at each distinct faster delivery estimate.
const MAX_RATE_OPTIONS = 4

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
      const wantsSignature = SIGNATURE_THRESHOLD_CENTS > 0 && declaredValueCents >= SIGNATURE_THRESHOLD_CENTS
      const wantsInsurance = INSURANCE_ENABLED && declaredValueCents > INSURANCE_MIN_CENTS

      const extra: Record<string, unknown> = {}
      if (wantsSignature) extra.signature_confirmation = 'STANDARD'
      if (wantsInsurance) {
        extra.insurance = {
          amount: (declaredValueCents / 100).toFixed(2),
          currency: 'USD',
          content: 'Trading cards and collectibles',
        }
      }

      // Rounded up so the shop is never a cent short on what it re-bills.
      // Identical across every service option, since it depends on declared
      // value rather than on the carrier.
      const insuranceCents = wantsInsurance
        ? Math.ceil(declaredValueCents * INSURANCE_RATE)
        : 0

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
        if (!rates.length) {
          const msg = (shipment.messages || []).map((m: any) => m.text).filter(Boolean).join(' ')
          return json({ available: false, reason: msg || 'No carrier rates returned for that address' })
        }

        // Shippo returns a long, noisy list (every service level from every
        // enabled carrier). Offering all of it is worse than offering one — so
        // keep the cheapest option at each distinct delivery estimate, which
        // gives the customer a real speed/price tradeoff rather than six
        // near-identical ground services.
        //
        // Rates with no estimated_days sort last: an unknown ETA can't be
        // presented as a speed upgrade.
        const NO_ETA = 99
        const byEta = new Map<number, any>()
        for (const r of rates) { // already cheapest-first, so first per ETA wins
          const eta = Number(r.estimated_days) > 0 ? Number(r.estimated_days) : NO_ETA
          if (!byEta.has(eta)) byEta.set(eta, r)
        }

        const cheapest = rates[0]
        const cheapestEta = Number(cheapest.estimated_days) > 0 ? Number(cheapest.estimated_days) : NO_ETA

        // Cheapest always shown. Fill the remaining slots with strictly faster
        // options, fastest first, so "pay more to get it sooner" reads top-down.
        const faster = [...byEta.entries()]
          .filter(([eta, r]) => eta < cheapestEta && r.object_id !== cheapest.object_id)
          .sort((a, b) => a[0] - b[0])
          .map(([, r]) => r)
          .slice(0, MAX_RATE_OPTIONS - 1)

        const chosen = [cheapest, ...faster]
        const fastestId = chosen.reduce((best, r) => {
          const e = Number(r.estimated_days) > 0 ? Number(r.estimated_days) : NO_ETA
          const be = Number(best.estimated_days) > 0 ? Number(best.estimated_days) : NO_ETA
          return e < be ? r : best
        }, chosen[0]).object_id

        const options = chosen.map((r: any) => {
          const postageCents = Math.round(parseFloat(r.amount) * 100)
          return {
            shippo_rate_id: r.object_id,
            carrier: r.provider,
            service: r.servicelevel?.name || '',
            estimated_days: Number(r.estimated_days) > 0 ? Number(r.estimated_days) : null,
            postage_cents: postageCents,
            insurance_cents: insuranceCents,
            // What the customer is actually charged for shipping on this
            // option. Insurance is included here because Shippo bills it
            // separately from postage — if it were left out, the shop would
            // quietly absorb it on every insured order.
            total_cents: postageCents + insuranceCents,
            cheapest: r.object_id === cheapest.object_id,
            fastest: r.object_id === fastestId && chosen.length > 1,
          }
        }).sort((a, b) => a.total_cents - b.total_cents)

        return json({
          available: true,
          options,
          declared_value_cents: declaredValueCents,
          insurance_cents: insuranceCents,
          signature_required: wantsSignature,
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

      // Shipping cost is re-derived server-side from the rate id, never taken
      // from the client. create_order() already refuses to trust client-supplied
      // product prices (see 20260714150000); shipping was the remaining hole,
      // and a caller hitting this endpoint directly could otherwise pass
      // shipping_rate_cents: 1 and get overnight delivery for a penny. Now the
      // only thing the client chooses is WHICH rate — the price attached to it
      // comes from Shippo.
      let shippingCents: number | null = null
      let shippingCarrier: string | null = null
      let shippingService: string | null = null

      if (fulfillment === 'ship') {
        const rateId = typeof body.shippo_rate_id === 'string' ? body.shippo_rate_id : ''
        if (!rateId) return json({ error: 'Choose a shipping option before checking out.' }, 400)
        if (!SHIPPO_API_KEY) return json({ error: 'Shipping is not configured yet.' }, 500)

        const rateRes = await fetch(`https://api.goshippo.com/rates/${rateId}`, {
          headers: { 'Authorization': `ShippoToken ${SHIPPO_API_KEY}` },
        })
        const rate = await rateRes.json()
        if (!rateRes.ok || !rate?.amount) {
          // Rates expire, so a stale checkout tab lands here rather than
          // silently buying a price that no longer exists.
          return json({ error: 'That shipping quote expired — please get a fresh rate.' }, 400)
        }

        // Recompute insurance from server-side prices rather than reusing the
        // figure sent back by the browser.
        const { data: priceRows } = await supabase
          .from('products').select('id, price_cents').in('id', items.map((i: any) => i.product_id))
        let declaredCents = 0
        for (const i of items) {
          const p = priceRows?.find((pr: any) => pr.id === i.product_id)
          declaredCents += (p?.price_cents || 0) * (i.quantity || 1)
        }
        const insCents = (INSURANCE_ENABLED && declaredCents > INSURANCE_MIN_CENTS)
          ? Math.ceil(declaredCents * INSURANCE_RATE)
          : 0

        shippingCents = Math.round(parseFloat(rate.amount) * 100) + insCents
        shippingCarrier = rate.provider || null
        shippingService = rate.servicelevel?.name || null
      }

      const { data: orderRows, error: orderErr } = await supabase.rpc('create_order', {
        p_user_id: userId,
        p_guest_email: body.guest_email || null,
        p_guest_name: body.guest_name || null,
        p_fulfillment_method: fulfillment,
        p_shipping_address: fulfillment === 'ship' ? body.shipping_address || null : null,
        p_shipping_rate_cents: shippingCents,
        p_shipping_carrier: shippingCarrier,
        p_shipping_service: shippingService,
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

      // Put the stock back. create_order() decremented quantity_available to
      // hold the item, and the only other release path is the
      // checkout.session.expired webhook — which never fires for an order that
      // was actually paid. Without this a refunded item stays at 0 available
      // and silently disappears from the storefront forever.
      const { data: refundedItems } = await supabase
        .from('order_items').select('product_id, quantity').eq('order_id', order.id)
      for (const it of refundedItems || []) {
        if (!it.product_id) continue // product deleted since the sale
        const { error: stockErr } = await supabase.rpc('increment_product_stock', {
          p_product_id: it.product_id,
          p_quantity: it.quantity,
        })
        if (stockErr) console.error('[shinyvault-checkout] refund restock failed', it.product_id, stockErr.message)
      }
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[shinyvault-checkout]', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
