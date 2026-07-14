// Table-fee payments on the store's connected Stripe account.
//
// Flow: vendor applies for a paid Vendor Day -> we save their card via
// Stripe Checkout (setup mode, no charge) with consent to charge up to the
// event's locked fee -> staff clicks Approve & collect and charges any
// amount 0..fee (0 = waive, less than fee = discount) -> money lands in
// the store's bank via the connected account (see stripe-connect).
// If the off-session charge declines, staff can send a hosted pay link.
//
// Vendor actions (must own the application's vendor row):
//   create_setup_session { application_id }        -> { url }
//   confirm_setup       { session_id }             -> { ok }
//   confirm_pay_link    { session_id }             -> { ok }
//   express_checkout    { event_id }               -> { url } | { ok, free }
//   confirm_express     { session_id }             -> { ok }
// Staff actions (profiles.is_admin):
//   charge          { application_id, amount_cents, note } -> { ok } | { ok:false, decline }
//   create_pay_link { application_id, amount_cents }       -> { url }
//   refund          { application_id }                     -> { ok }
//
// Express = the "last-minute fast pass" link staff share directly:
// /vendors/express?event=<id>. Vendor pays the full fee up front and is
// auto-approved the moment payment lands (their vendor profile flips to
// approved too). Successful charges store Stripe's hosted receipt_url so
// vendors always have a receipt.
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const SITE_URL = Deno.env.get('SITE_URL') || 'https://pokemontrainercenter.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
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
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`

// App Catalyst gets half of what's left after Stripe's own processing cut
// (estimated at the standard 2.9% + 30¢ card rate) — the store's connected
// account keeps the other half. Exact Stripe fee isn't known until the
// charge settles, so this is an estimate; it lands within a cent or two of
// a true post-fee 50/50 split on ordinary domestic card charges.
const platformFeeCents = (amountCents: number) => {
  const estStripeFee = Math.round(amountCents * 0.029) + 30
  const remainder = Math.max(amountCents - estStripeFee, 0)
  return Math.round(remainder / 2)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Not logged in' }, 401)
    const userId = userData.user.id

    if (!stripeKey) return json({ error: 'Payments are not configured yet (missing Stripe key).' }, 500)
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    const { data: settings } = await supabase
      .from('stripe_settings').select('stripe_account_id, charges_enabled').eq('id', 'main').maybeSingle()
    const acct = settings?.stripe_account_id
    if (!acct) return json({ error: 'Banking is not connected yet. An owner needs to finish setup on the Banking page.' }, 400)
    const onAcct = { stripeAccount: acct }

    const body = await req.json()
    const { action } = body

    // ── Load the application + joined vendor/event (every action needs it
    //    except the session confirms, which carry the app id in metadata) ──
    const loadApp = async (id: string) => {
      const { data } = await supabase
        .from('vendor_applications')
        .select('*, vendor:vendors(id, user_id, name, email), event:events(id, title, event_date, table_fee_cents)')
        .eq('id', id)
        .maybeSingle()
      return data
    }

    const requireStaff = async () => {
      const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', userId).maybeSingle()
      return !!prof?.is_admin
    }

    // ─── Vendor: save a card (Checkout setup mode, no charge) ───
    if (action === 'create_setup_session') {
      const app = await loadApp(body.application_id)
      if (!app) return json({ error: 'Application not found' }, 404)
      if (app.vendor?.user_id !== userId) return json({ error: 'Not your application' }, 403)
      if (!app.fee_cents) return json({ error: 'This event has no table fee' }, 400)

      // Reuse the vendor's Stripe customer from any earlier paid application
      // so returning vendors keep one customer record on the account.
      let customerId = app.stripe_customer_id as string | null
      if (!customerId) {
        const { data: prev } = await supabase
          .from('vendor_applications')
          .select('stripe_customer_id')
          .eq('vendor_id', app.vendor_id)
          .not('stripe_customer_id', 'is', null)
          .order('applied_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        customerId = prev?.stripe_customer_id || null
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: app.vendor.name || undefined,
          email: app.vendor.email || undefined,
          metadata: { vendor_id: app.vendor_id },
        }, onAcct)
        customerId = customer.id
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'setup',
        customer: customerId,
        payment_method_types: ['card'],
        success_url: `${SITE_URL}/vendors/dashboard?fee_setup={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/vendors/dashboard?fee_setup_cancelled=1`,
        metadata: { application_id: app.id },
      }, onAcct)

      await supabase.from('vendor_applications').update({
        stripe_customer_id: customerId,
        stripe_setup_session_id: session.id,
        payment_status: 'card_pending',
      }).eq('id', app.id)

      return json({ url: session.url })
    }

    // ─── Vendor: back from Checkout — attach the saved payment method ───
    if (action === 'confirm_setup') {
      const session = await stripe.checkout.sessions.retrieve(body.session_id, { expand: ['setup_intent'] }, onAcct)
      const appId = session.metadata?.application_id
      if (!appId) return json({ error: 'Session has no application' }, 400)
      const app = await loadApp(appId)
      if (!app) return json({ error: 'Application not found' }, 404)
      if (app.vendor?.user_id !== userId) return json({ error: 'Not your application' }, 403)

      const si = session.setup_intent as Stripe.SetupIntent | null
      const pm = typeof si?.payment_method === 'string' ? si.payment_method : si?.payment_method?.id
      if (!pm || si?.status !== 'succeeded') return json({ ok: false, reason: 'Card setup not completed' })

      // This action can legitimately be called more than once for the same
      // session (stale bookmark, back button, retried network call) — only
      // treat it as "the application just became real" the first time the
      // card actually lands, not on a replay.
      const wasAlreadySaved = app.payment_status === 'card_saved'
      await supabase.from('vendor_applications').update({
        stripe_payment_method_id: pm,
        payment_status: 'card_saved',
      }).eq('id', app.id)

      if (!wasAlreadySaved) {
        // Only now is this a successful application — fire the "application
        // received" notification here instead of at apply time, so staff
        // never get notified about a card that was never actually saved.
        const { count } = await supabase
          .from('vendor_attendance')
          .select('*', { count: 'exact', head: true })
          .eq('vendor_id', app.vendor_id)
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-vendor-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ type: 'application_received', application_id: app.id, is_first_time: !count }),
          })
        } catch (notifyErr) {
          console.error('[stripe-vendor-payment] application_received notify failed', notifyErr)
        }
      }
      return json({ ok: true, application_id: app.id })
    }

    // Stripe's hosted receipt page for a PaymentIntent (via its charge).
    const receiptUrlFor = async (piId: string | null | undefined) => {
      if (!piId) return null
      try {
        const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] }, onAcct)
        const charge = pi.latest_charge as Stripe.Charge | null
        return charge?.receipt_url || null
      } catch (_e) {
        return null
      }
    }

    // ─── Vendor: back from a pay link — verify + mark paid ───
    if (action === 'confirm_pay_link') {
      const session = await stripe.checkout.sessions.retrieve(body.session_id, {}, onAcct)
      const appId = session.metadata?.application_id
      if (!appId) return json({ error: 'Session has no application' }, 400)
      const app = await loadApp(appId)
      if (!app) return json({ error: 'Application not found' }, 404)
      if (app.vendor?.user_id !== userId) return json({ error: 'Not your application' }, 403)
      if (session.payment_status !== 'paid') return json({ ok: false, reason: 'Not paid yet' })

      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
      await supabase.from('vendor_applications').update({
        payment_status: 'charged',
        charged_amount_cents: session.amount_total,
        stripe_payment_intent_id: piId,
        receipt_url: await receiptUrlFor(piId),
        charged_at: new Date().toISOString(),
      }).eq('id', app.id)
      return json({ ok: true })
    }

    // ─── Vendor: express fast-pass — pay full fee now, auto-approved ───
    if (action === 'express_checkout') {
      const { data: ev } = await supabase
        .from('events')
        .select('id, title, event_date, table_fee_cents, has_vendors, cancelled')
        .eq('id', body.event_id)
        .maybeSingle()
      if (!ev || !ev.has_vendors || ev.cancelled) return json({ error: 'Event not found' }, 404)
      // Store timezone, not server UTC — a link opened the morning after an
      // evening event shouldn't still read as "today" server-side.
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
      if (ev.event_date < todayStr) return json({ error: 'This event has already happened. Reach out to Trainer Center HB for the current sign-up link.' }, 400)

      const { data: vendor } = await supabase
        .from('vendors').select('id, name, email, status').eq('user_id', userId).maybeSingle()
      if (!vendor) return json({ error: 'No vendor profile yet' }, 400)

      // Existing application row for this event (e.g. a pending one) gets
      // reused; otherwise insert one now so the checkout has an anchor.
      const { data: existingApp } = await supabase
        .from('vendor_applications')
        .select('id, status, payment_status')
        .eq('vendor_id', vendor.id).eq('event_id', ev.id)
        .maybeSingle()
      if (existingApp?.payment_status === 'charged' && existingApp.status === 'approved') {
        return json({ ok: true, already: true })
      }

      const fee = ev.table_fee_cents || 0
      let appId = existingApp?.id
      if (!appId) {
        const { data: inserted, error: insErr } = await supabase
          .from('vendor_applications')
          .insert({
            vendor_id: vendor.id,
            event_id: ev.id,
            requested_start_time: '12:00',
            requested_end_time: '20:00',
            requested_table_size: 'tbd',
            fee_cents: fee,
            payment_status: fee > 0 ? 'card_pending' : 'none',
          })
          .select('id')
          .single()
        if (insErr) return json({ error: insErr.message }, 500)
        appId = inserted.id
      } else {
        await supabase.from('vendor_applications').update({ fee_cents: fee }).eq('id', appId)
      }

      // Free event: no payment step, approve immediately.
      if (fee === 0) {
        await supabase.from('vendor_applications').update({
          status: 'approved',
          decided_at: new Date().toISOString(),
          decision_note: 'Express link',
        }).eq('id', appId)
        if (vendor.status !== 'approved') {
          await supabase.from('vendors').update({ status: 'approved' }).eq('id', vendor.id)
        }
        return json({ ok: true, free: true, application_id: appId })
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: vendor.email || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: fee,
            product_data: { name: `Table fee — ${ev.title || 'Vendor Day'} (${ev.event_date})` },
          },
        }],
        payment_intent_data: {
          receipt_email: vendor.email || undefined,
          application_fee_amount: platformFeeCents(fee),
        },
        success_url: `${SITE_URL}/vendors/express?event=${ev.id}&express_paid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/vendors/express?event=${ev.id}`,
        metadata: { application_id: appId, express: '1' },
      }, onAcct)

      return json({ url: session.url })
    }

    // ─── Vendor: back from express checkout — verify, approve, done ───
    if (action === 'confirm_express') {
      const session = await stripe.checkout.sessions.retrieve(body.session_id, {}, onAcct)
      const appId = session.metadata?.application_id
      if (!appId) return json({ error: 'Session has no application' }, 400)
      const app = await loadApp(appId)
      if (!app) return json({ error: 'Application not found' }, 404)
      if (app.vendor?.user_id !== userId) return json({ error: 'Not your application' }, 403)
      if (session.payment_status !== 'paid') return json({ ok: false, reason: 'Not paid yet' })

      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
      await supabase.from('vendor_applications').update({
        status: 'approved',
        decided_at: new Date().toISOString(),
        decision_note: 'Express link — paid up front',
        payment_status: 'charged',
        charged_amount_cents: session.amount_total,
        stripe_payment_intent_id: piId,
        receipt_url: await receiptUrlFor(piId),
        charged_at: new Date().toISOString(),
      }).eq('id', app.id)
      // Express implies the profile is in — staff shared the link on purpose.
      const { data: vRow } = await supabase.from('vendors').select('status').eq('id', app.vendor_id).maybeSingle()
      if (vRow && vRow.status !== 'approved') {
        await supabase.from('vendors').update({ status: 'approved' }).eq('id', app.vendor_id)
      }
      return json({ ok: true, application_id: app.id })
    }

    // ─── Staff: charge on approval (0 = waive, < fee = discount) ───
    if (action === 'charge') {
      if (!(await requireStaff())) return json({ error: 'Staff only' }, 403)
      const app = await loadApp(body.application_id)
      if (!app) return json({ error: 'Application not found' }, 404)

      const amount = Math.round(Number(body.amount_cents))
      if (!Number.isFinite(amount) || amount < 0) return json({ error: 'Bad amount' }, 400)
      // Hard server-side ceiling: never above what the vendor consented to.
      if (amount > app.fee_cents) return json({ error: `Amount exceeds the ${money(app.fee_cents)} fee the vendor agreed to` }, 400)
      if (app.payment_status === 'charged') return json({ error: 'Already charged' }, 400)

      const note = (body.note || '').trim() || null

      if (amount === 0) {
        await supabase.from('vendor_applications').update({
          payment_status: 'waived',
          charged_amount_cents: 0,
          payment_note: note,
          payment_decided_by: userId,
          charged_at: new Date().toISOString(),
        }).eq('id', app.id)
        return json({ ok: true, waived: true })
      }

      if (!app.stripe_customer_id || !app.stripe_payment_method_id) {
        return json({ ok: false, decline: 'No card on file — send a pay link instead.' })
      }

      try {
        const pi = await stripe.paymentIntents.create({
          amount,
          currency: 'usd',
          customer: app.stripe_customer_id,
          payment_method: app.stripe_payment_method_id,
          off_session: true,
          confirm: true,
          application_fee_amount: platformFeeCents(amount),
          receipt_email: app.vendor?.email || undefined,
          description: `Table fee — ${app.event?.title || 'Vendor Day'} ${app.event?.event_date || ''}`.trim(),
          metadata: { application_id: app.id, vendor_id: app.vendor_id },
          expand: ['latest_charge'],
        }, onAcct)

        const charge = pi.latest_charge as Stripe.Charge | null
        await supabase.from('vendor_applications').update({
          payment_status: 'charged',
          charged_amount_cents: amount,
          stripe_payment_intent_id: pi.id,
          receipt_url: charge?.receipt_url || null,
          payment_note: note,
          payment_decided_by: userId,
          charged_at: new Date().toISOString(),
        }).eq('id', app.id)
        return json({ ok: true, charged_cents: amount })
      } catch (e) {
        const msg = (e as Stripe.errors.StripeError).message || 'Card declined'
        await supabase.from('vendor_applications').update({
          payment_status: 'failed',
          payment_note: note,
          payment_decided_by: userId,
        }).eq('id', app.id)
        return json({ ok: false, decline: msg })
      }
    }

    // ─── Staff: hosted pay link fallback (declined card, or no card) ───
    if (action === 'create_pay_link') {
      if (!(await requireStaff())) return json({ error: 'Staff only' }, 403)
      const app = await loadApp(body.application_id)
      if (!app) return json({ error: 'Application not found' }, 404)

      const amount = Math.round(Number(body.amount_cents))
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Bad amount' }, 400)
      if (amount > app.fee_cents) return json({ error: `Amount exceeds the ${money(app.fee_cents)} fee the vendor agreed to` }, 400)

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...(app.stripe_customer_id ? { customer: app.stripe_customer_id } : { customer_email: app.vendor?.email || undefined }),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: { name: `Table fee — ${app.event?.title || 'Vendor Day'} (${app.event?.event_date || ''})` },
          },
        }],
        payment_intent_data: {
          receipt_email: app.vendor?.email || undefined,
          application_fee_amount: platformFeeCents(amount),
        },
        success_url: `${SITE_URL}/vendors/dashboard?fee_paid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}/vendors/dashboard`,
        metadata: { application_id: app.id },
      }, onAcct)

      return json({ url: session.url })
    }

    // ─── Staff: refund (vendor cancelled, event cancelled, etc.) ───
    if (action === 'refund') {
      if (!(await requireStaff())) return json({ error: 'Staff only' }, 403)
      const app = await loadApp(body.application_id)
      if (!app) return json({ error: 'Application not found' }, 404)
      if (app.payment_status !== 'charged' || !app.stripe_payment_intent_id) {
        return json({ error: 'Nothing to refund' }, 400)
      }

      await stripe.refunds.create({ payment_intent: app.stripe_payment_intent_id }, onAcct)
      await supabase.from('vendor_applications').update({
        payment_status: 'refunded',
        refunded_at: new Date().toISOString(),
      }).eq('id', app.id)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[stripe-vendor-payment]', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
