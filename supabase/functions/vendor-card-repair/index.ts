// One-shot repair, 2026-09-21. Every application stuck at card_pending that
// reached a Stripe setup session is checked against Stripe; if the card was
// actually saved there, it is written down here. Temporary: delete once run.
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
Deno.serve(async () => {
  const { data: settings } = await supabase.from('stripe_settings')
    .select('stripe_account_id').eq('id', 'main').maybeSingle()
  const onAcct = { stripeAccount: settings!.stripe_account_id as string }
  const { data: stuck } = await supabase.from('vendor_applications')
    .select('id, vendor_id, stripe_setup_session_id, fee_cents')
    .eq('payment_status', 'card_pending').not('stripe_setup_session_id', 'is', null).gt('fee_cents', 0)
  const out: unknown[] = []
  for (const a of stuck || []) {
    try {
      const s = await stripe.checkout.sessions.retrieve(a.stripe_setup_session_id!, {}, onAcct)
      const siId = typeof s.setup_intent === 'string' ? s.setup_intent : s.setup_intent?.id
      if (!siId) { out.push({ id: a.id, result: 'never completed' }); continue }
      const si = await stripe.setupIntents.retrieve(siId, {}, onAcct)
      const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
      if (si.status !== 'succeeded' || !pm) {
        // Each retry overwrites the stored session id, so a card saved on
        // an EARLIER attempt is invisible here. Ask the customer instead.
        const custId = typeof s.customer === 'string' ? s.customer : s.customer?.id
        if (custId) {
          const pms = await stripe.paymentMethods.list({ customer: custId, type: 'card', limit: 3 }, onAcct)
          const newest = pms.data[0]
          if (newest) {
            const { error: e2 } = await supabase.from('vendor_applications').update({
              stripe_payment_method_id: newest.id, stripe_customer_id: custId,
              payment_status: 'card_saved',
            }).eq('vendor_id', a.vendor_id).eq('status', 'pending')
              .is('stripe_payment_method_id', null).gt('fee_cents', 0)
            out.push({ id: a.id, result: e2 ? `db error ${e2.message}` : `CARD RECOVERED from customer (${newest.card?.brand} ${newest.card?.last4})` })
            continue
          }
        }
        out.push({ id: a.id, result: `no card anywhere (session ${si.status})` }); continue
      }
      const cust = typeof s.customer === 'string' ? s.customer : s.customer?.id
      const { error } = await supabase.from('vendor_applications').update({
        stripe_payment_method_id: pm, ...(cust ? { stripe_customer_id: cust } : {}),
        payment_status: 'card_saved',
      }).eq('vendor_id', a.vendor_id).eq('status', 'pending')
        .is('stripe_payment_method_id', null).gt('fee_cents', 0)
      out.push({ id: a.id, result: error ? `db error ${error.message}` : 'CARD RECOVERED' })
    } catch (e) { out.push({ id: a.id, result: `stripe: ${String(e).slice(0, 120)}` }) }
  }
  return new Response(JSON.stringify({ checked: (stuck || []).length, out }, null, 1),
    { headers: { 'Content-Type': 'application/json' } })
})
