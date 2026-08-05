// ShinyVault Stripe webhook — durable source of truth for order payment
// state (shinyvault-checkout's confirm_session is just an eager best-effort
// on the browser's return trip; this is what actually has to work if the
// customer closes the tab before redirecting back).
//
// Checkout Sessions are created with { stripeAccount: <connected account> }
// (direct charge), so these events fire on the CONNECTED account's event
// stream, not the platform account's. Register this endpoint under
// Stripe Dashboard -> Connect -> Webhooks (not the regular Webhooks page)
// listening for checkout.session.completed and checkout.session.expired,
// and set SHINYVAULT_STRIPE_WEBHOOK_SECRET to that endpoint's signing
// secret (separate from any platform-level webhook secret).
//
// checkout.session.completed -> mark order paid; if shipping was purchased
//   (fulfillment_method='ship' and an EasyPost rate was locked in at
//   checkout), buy the label now — only after payment has actually cleared.
// checkout.session.expired    -> release the inventory create_order() held,
//   mark the order expired, so it goes back on the shelf for the next buyer.
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const webhookSecret = Deno.env.get('SHINYVAULT_STRIPE_WEBHOOK_SECRET') || ''
const SHIPPO_API_KEY = Deno.env.get('SHIPPO_API_KEY') || ''
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const stripe = new Stripe(stripeKey || '', { apiVersion: '2023-10-16' })
  const sig = req.headers.get('stripe-signature') || ''
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = webhookSecret
      ? await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret)
      : JSON.parse(rawBody) // webhookSecret unset in early testing only — never in production
  } catch (e) {
    console.error('[shinyvault-stripe-webhook] signature verify failed', (e as Error).message)
    return new Response('bad signature', { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const orderId = session.metadata?.order_id
      if (!orderId) return new Response('ok')

      const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle()
      if (!order || order.payment_status === 'paid') return new Response('ok') // already handled (confirm_session or a replayed event)

      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
      let receiptUrl: string | null = null
      if (piId) {
        try {
          const { data: settings } = await supabase.from('stripe_settings').select('stripe_account_id').eq('id', 'main').maybeSingle()
          if (settings?.stripe_account_id) {
            const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] }, { stripeAccount: settings.stripe_account_id })
            const charge = pi.latest_charge as Stripe.Charge | null
            receiptUrl = charge?.receipt_url || null
          }
        } catch (_e) { /* receipt link is a nice-to-have, not worth failing the webhook over */ }
      }

      await supabase.from('orders').update({
        payment_status: 'paid',
        stripe_payment_intent_id: piId || null,
        receipt_url: receiptUrl,
      }).eq('id', order.id)

      // Buy the shipping label only now that payment has actually cleared.
      // This SPENDS REAL MONEY — the rate quoted at checkout gets charged to
      // the Shippo account on file. Shippo lets us buy straight from the rate
      // id captured at quote time, so unlike EasyPost there's no shipment
      // re-fetch and no risk of matching the wrong rate.
      if (order.fulfillment_method === 'ship' && order.shippo_rate_id && SHIPPO_API_KEY) {
        try {
          const buyRes = await fetch('https://api.goshippo.com/transactions/', {
            method: 'POST',
            headers: {
              'Authorization': `ShippoToken ${SHIPPO_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              rate: order.shippo_rate_id,
              label_file_type: 'PDF_4x6',
              // Synchronous so tracking number and label URL are on this
              // response. Async would hand back a QUEUED transaction we'd have
              // to poll, and a Stripe webhook has no good place to poll from.
              async: false,
            }),
          })
          const bought = await buyRes.json()

          // Shippo returns HTTP 201 even for a failed purchase — the real
          // outcome is in bought.status ('SUCCESS' | 'ERROR'), with the reason
          // in bought.messages. Checking buyRes.ok alone would mark a failed
          // label as purchased.
          if (buyRes.ok && bought?.status === 'SUCCESS') {
            await supabase.from('orders').update({
              fulfillment_status: 'label_purchased',
              tracking_number: bought?.tracking_number || null,
              tracking_url: bought?.tracking_url_provider || null,
              label_url: bought?.label_url || null,
            }).eq('id', order.id)
          } else {
            const why = (bought?.messages || []).map((m: any) => m.text).filter(Boolean).join(' ')
            console.error('[shinyvault-stripe-webhook] label purchase failed', why || bought)
          }
        } catch (e) {
          console.error('[shinyvault-stripe-webhook] label purchase error', (e as Error).message)
        }
      }

      // Order confirmation email. Fired after the label attempt so a shipped
      // order's email can carry the tracking link — the customer gets one
      // email, not a confirmation now and a tracking one seconds later. A
      // label failure above is deliberately non-fatal here: the customer has
      // paid and must still get a confirmation, and the admin board shows the
      // order stuck at 'unfulfilled' for staff to resolve.
      try {
        await supabase.functions.invoke('shinyvault-order-email', {
          body: { type: 'order_confirmation', order_id: order.id },
        })
      } catch (e) {
        console.error('[shinyvault-stripe-webhook] confirmation email error', (e as Error).message)
      }

      return new Response('ok')
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session
      const orderId = session.metadata?.order_id
      if (!orderId) return new Response('ok')

      const { data: order } = await supabase.from('orders').select('id, payment_status').eq('id', orderId).maybeSingle()
      if (!order || order.payment_status !== 'pending') return new Response('ok') // already paid or already released

      const { data: items } = await supabase.from('order_items').select('product_id, quantity').eq('order_id', orderId)
      for (const item of items || []) {
        if (!item.product_id) continue
        await supabase.rpc('increment_product_stock', { p_product_id: item.product_id, p_quantity: item.quantity })
      }

      await supabase.from('orders').update({ payment_status: 'expired' }).eq('id', orderId)
      return new Response('ok')
    }

    return new Response('ok')
  } catch (err) {
    console.error('[shinyvault-stripe-webhook]', (err as Error).message)
    return new Response('error', { status: 500 })
  }
})
