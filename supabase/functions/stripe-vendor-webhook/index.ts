// Stripe tells us the card was saved. Nothing depends on the browser.
//
// 2026-09-21: a vendor paid, Stripe confirmed, and the site put him back at
// the start of the form - over and over. The card was only ever recorded by
// a call the BROWSER made after Stripe redirected it back, so any hiccup on
// the way home (a phone's in-app browser, a cold page load, a session that
// had not restored yet, a closed tab) meant the card was never written down
// and the vendor was asked for it again forever. Six vendors got through,
// seven did not. This endpoint removes the browser from the path: Stripe
// reports the completed session straight to us and we record it.
//
// Charges are DIRECT on the store's connected account, so these events fire
// on that account. Register this as a Connect webhook on the platform and
// every connected account is covered by one endpoint; the event carries the
// account id. Events handled:
//   checkout.session.completed  mode=setup   -> attach the card, card_saved
//   checkout.session.completed  mode=payment -> mark paid (express / pay link)
//   setup_intent.succeeded                   -> belt and braces for the above
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const WEBHOOK_SECRET = Deno.env.get('STRIPE_VENDOR_WEBHOOK_SECRET') || ''
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ msg, ...extra }))

/** Attach a saved card to every pending paid application this vendor has,
 *  which is exactly what the old browser-side path did. */
async function saveCard(applicationId: string, pm: string, customerId: string | null) {
  const { data: app } = await supabase
    .from('vendor_applications')
    .select('id, vendor_id')
    .eq('id', applicationId)
    .maybeSingle()
  if (!app) {
    log('no such application', { applicationId })
    return
  }
  const { error } = await supabase
    .from('vendor_applications')
    .update({
      stripe_payment_method_id: pm,
      ...(customerId ? { stripe_customer_id: customerId } : {}),
      payment_status: 'card_saved',
    })
    .eq('vendor_id', app.vendor_id)
    .in('status', ['pending', 'incomplete'])
    .is('stripe_payment_method_id', null)
    .gt('fee_cents', 0)
  // 'incomplete' means they applied for a paid date and never saved a card,
  // which keeps the row out of every staff queue. The card just landed, so
  // the application is real now — promote it. Scoped to 'incomplete' so an
  // already-approved vendor swapping cards is never knocked back to pending.
  const { error: promoteErr } = await supabase
    .from('vendor_applications')
    .update({ status: 'pending' })
    .eq('vendor_id', app.vendor_id)
    .eq('status', 'incomplete')
    .not('stripe_payment_method_id', 'is', null)
  log(error || promoteErr ? 'card save failed' : 'card saved', {
    applicationId, vendor: app.vendor_id,
    error: error?.message, promoteError: promoteErr?.message,
  })
}

async function markPaid(applicationId: string, session: Stripe.Checkout.Session) {
  const amount = session.amount_total ?? 0
  const pi = typeof session.payment_intent === 'string'
    ? session.payment_intent : session.payment_intent?.id
  const { error } = await supabase
    .from('vendor_applications')
    .update({
      payment_status: 'charged',
      charged_amount_cents: amount,
      charged_at: new Date().toISOString(),
      ...(pi ? { stripe_payment_intent_id: pi } : {}),
    })
    .eq('id', applicationId)
    .neq('payment_status', 'charged')
  log(error ? 'mark paid failed' : 'marked paid', { applicationId, amount, error: error?.message })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  if (!stripeKey) return new Response('no stripe key', { status: 500 })
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

  const raw = await req.text()
  let event: Stripe.Event
  try {
    // Unsigned events are refused: this endpoint writes payment state, so a
    // forged POST could mark an application paid.
    if (!WEBHOOK_SECRET) return new Response('webhook secret not set', { status: 500 })
    event = await stripe.webhooks.constructEventAsync(
      raw, req.headers.get('stripe-signature') || '', WEBHOOK_SECRET,
      undefined, Stripe.createSubtleCryptoProvider(),
    )
  } catch (e) {
    log('bad signature', { error: String(e).slice(0, 200) })
    return new Response('bad signature', { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session
      const applicationId = s.metadata?.application_id
      if (!applicationId) {
        log('session with no application', { session: s.id })
        return new Response('ok')
      }
      if (s.mode === 'setup') {
        const acct = (event as { account?: string }).account
        const si = typeof s.setup_intent === 'string'
          ? await stripe.setupIntents.retrieve(
              s.setup_intent, {}, acct ? { stripeAccount: acct } : undefined)
          : s.setup_intent
        const pm = typeof si?.payment_method === 'string'
          ? si.payment_method : si?.payment_method?.id
        const cust = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null
        if (pm) await saveCard(applicationId, pm, cust)
        else log('setup session had no payment method', { session: s.id })
      } else if (s.mode === 'payment' && s.payment_status === 'paid') {
        await markPaid(applicationId, s)
      }
    } else if (event.type === 'setup_intent.succeeded') {
      const si = event.data.object as Stripe.SetupIntent
      const applicationId = si.metadata?.application_id
      const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
      const cust = typeof si.customer === 'string' ? si.customer : si.customer?.id ?? null
      if (applicationId && pm) await saveCard(applicationId, pm, cust)
    }
  } catch (e) {
    // Never 500 on a handled event: Stripe would retry forever and the log
    // is where we find out what happened.
    log('handler threw', { type: event.type, error: String(e).slice(0, 300) })
  }
  return new Response('ok')
})
