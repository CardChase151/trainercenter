// ShinyVault Shippo tracking webhook — carrier scans are the real proof of
// what happened to a parcel, so this is what actually moves an order from
// 'shipped' to 'delivered' without anyone in the shop touching a button.
//
// Register in the Shippo dashboard (Settings -> API -> Webhooks) for the
// 'track_updated' event pointed at this function. Shippo only sends
// track_updated for parcels it is tracking; buying a label through
// shinyvault-stripe-webhook registers the parcel automatically, so there is
// nothing extra to subscribe per shipment.
//
// Payload shape (https://docs.goshippo.com/docs/tracking/webhooks/):
//   { event: 'track_updated', test: bool, data: {
//       tracking_number, carrier,
//       tracking_status: { status, status_details, status_date, substatus },
//       tracking_history: [ { status, status_details, status_date } ], ... } }
// status is one of PRE_TRANSIT | TRANSIT | DELIVERED | RETURNED | FAILURE |
// UNKNOWN (https://docs.goshippo.com/docs/tracking/tracking/).
//
// Two things drive almost every design decision in here:
//   1. Shippo's docs state tracking webhooks are NOT idempotent and the same
//      event can arrive more than once, out of order, or late. So every write
//      is guarded by an explicit rank ordering and only ever moves an order
//      FORWARD.
//   2. Shippo retries non-2xx responses. A parcel that is not ours (or a
//      payload we cannot parse) must still answer 200, or Shippo will retry
//      it forever and bury the real failures in the logs.
//
// Deploy with --no-verify-jwt: Shippo cannot send a Supabase JWT.
//   supabase functions deploy shinyvault-track-webhook --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Optional HMAC secret. Shippo signs webhooks with SHA-256 HMAC over
// "<timestamp>.<raw body>" and sends it as Shippo-Auth-Signature:
// "t=<unix>,v1=<hex>" (https://docs.goshippo.com/tracking/webhook-security).
// It is OFF by default because the secret is not self-serve — Shippo's
// solutions team has to enable HMAC on the account and hand over the secret.
// Until then the residual risk is real but small: anyone who knows a live
// tracking number could POST here and mark that order delivered. They cannot
// pick an arbitrary order (tracking_number is the only lookup key), cannot
// move an order backwards, cannot touch money, and tracking numbers are only
// disclosed to the buyer of that order. Set this the day Shippo provisions it:
//   supabase secrets set SHINYVAULT_SHIPPO_WEBHOOK_SECRET=... --project-ref tfneuzbhiqsdvnhhdfsw
const SHIPPO_WEBHOOK_SECRET = Deno.env.get('SHINYVAULT_SHIPPO_WEBHOOK_SECRET') || ''

// Reject signatures older than this to stop a captured payload being replayed
// weeks later. Only enforced when the HMAC secret is set.
const SIGNATURE_TOLERANCE_SECONDS = Number(Deno.env.get('SHINYVAULT_SHIPPO_SIGNATURE_TOLERANCE') || 300)

// Delivered-confirmation email. Off by default on purpose: shinyvault-order-email
// only grew its 'order_delivered' branch alongside this function, and if this
// gets deployed before that one does, the old copy would fall through to its
// default branch and mail the customer a fresh ORDER CONFIRMATION for an order
// that already arrived. Flip it on once both functions are deployed:
//   supabase secrets set SHINYVAULT_DELIVERED_EMAIL=true --project-ref tfneuzbhiqsdvnhhdfsw
const DELIVERED_EMAIL_ENABLED = (Deno.env.get('SHINYVAULT_DELIVERED_EMAIL') || 'false') === 'true'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, shippo-auth-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// How far along the fulfillment pipeline each state is. Every write compares
// ranks and only advances, because a duplicate or out-of-order webhook must
// never drag an order back down (a late-arriving TRANSIT event landing after
// DELIVERED is the case that actually happens in practice).
//
// 'ready_for_pickup' and 'picked_up' are the in-store lane, not the shipping
// lane. They are ranked so a shipping event can never regress them, and the
// PICKUP_LANE guard below skips them entirely — a pickup order that somehow has
// a tracking number is a human problem, not something to silently reconcile.
const RANK: Record<string, number> = {
  unfulfilled: 0,
  label_purchased: 1,
  printed: 2,
  sealed: 3,
  ready_for_pickup: 3,
  shipped: 4,
  delivered: 5,
  picked_up: 5,
  completed: 6,
}
const PICKUP_LANE = new Set(['ready_for_pickup', 'picked_up'])

// Shippo status -> our fulfillment_status. RETURNED and FAILURE map to null
// deliberately: those mean a parcel is coming back or is lost/damaged, which
// needs a person deciding on a refund or a reship. Auto-advancing the order
// would hide it from whoever has to make that call, so we only record
// carrier_status and let the admin board surface it.
const STATUS_MAP: Record<string, string | null> = {
  PRE_TRANSIT: null, // label scanned into the system; the shop already knows, nothing new to record
  TRANSIT: 'shipped',
  DELIVERED: 'delivered',
  RETURNED: null,
  FAILURE: null,
  UNKNOWN: null,
}

// Carrier timestamps arrive as ISO 8601 strings but are occasionally missing or
// malformed; fall back to now rather than writing an invalid timestamp.
const asDate = (value: unknown): string => {
  const parsed = value ? new Date(String(value)) : null
  return parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
}

// When DELIVERED arrives without us ever having seen the TRANSIT event (late
// registration, a missed delivery, Shippo collapsing history), the delivery
// timestamp is the wrong thing to record as shipped_at. tracking_history
// carries the whole scan list, so dig out the earliest TRANSIT scan instead.
const firstTransitDate = (history: unknown): string | null => {
  if (!Array.isArray(history)) return null
  const dates = history
    .filter((h: any) => h?.status === 'TRANSIT' && h?.status_date)
    .map((h: any) => new Date(String(h.status_date)).getTime())
    .filter((t) => !isNaN(t))
  return dates.length ? new Date(Math.min(...dates)).toISOString() : null
}

// Shippo's documented scheme: HMAC-SHA256 over `${timestamp}.${rawBody}`,
// compared against the v1 value in the signature header.
async function verifySignature(rawBody: string, header: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return i === -1 ? ['', ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const timestamp = parts['t']
  const signature = parts['v1']
  if (!timestamp || !signature) return false

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SHIPPO_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`))
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')

  // Length-safe constant-time-ish compare so a mismatch does not leak where it
  // diverged through timing.
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // Shippo pings the endpoint on registration; anything that is not a POST
  // still gets a 200 so the registration check passes.
  if (req.method !== 'POST') return json({ ok: true })

  try {
    const rawBody = await req.text()

    if (SHIPPO_WEBHOOK_SECRET) {
      // Shippo documents the header in its CGI form (HTTP_SHIPPO_AUTH_SIGNATURE);
      // on the wire that is Shippo-Auth-Signature. Check both so enabling HMAC
      // does not depend on which spelling their edge actually sends.
      const sig = req.headers.get('shippo-auth-signature')
        || req.headers.get('http-shippo-auth-signature')
        || ''
      if (!sig || !(await verifySignature(rawBody, sig))) {
        console.error('[shinyvault-track-webhook] signature verify failed')
        // 401 here is correct and safe: a genuine Shippo retry would carry a
        // valid signature, so retries on this path are forgeries, not our
        // parcels.
        return json({ error: 'bad signature' }, 401)
      }
    }

    let body: any
    try {
      body = JSON.parse(rawBody)
    } catch {
      console.error('[shinyvault-track-webhook] unparseable body')
      return json({ ok: true, ignored: 'unparseable' })
    }

    // Shippo wraps the Track object in { event, test, data }, but some
    // dashboard-registered endpoints post the Track object bare. Accept both
    // rather than silently ignoring half the traffic.
    const track = body?.data ?? body
    const event = body?.event
    if (event && event !== 'track_updated') return json({ ok: true, ignored: event })

    const trackingNumber = typeof track?.tracking_number === 'string' ? track.tracking_number.trim() : ''
    const carrierStatus = typeof track?.tracking_status?.status === 'string' ? track.tracking_status.status : ''
    if (!trackingNumber || !carrierStatus) {
      console.log('[shinyvault-track-webhook] payload missing tracking_number or status; ignoring')
      return json({ ok: true, ignored: 'incomplete' })
    }

    // The tracking number is the ONLY thing in this payload allowed to choose a
    // row. Nothing else here is trusted for selection — no order id, no email,
    // no metadata — so a forged payload can at worst target a parcel whose
    // tracking number the sender already knows.
    //
    // Ordered newest-first with a 2-row window: Shippo's test tracking numbers
    // (SHIPPO_TRANSIT, SHIPPO_DELIVERED, ...) are constants and will collide
    // across test orders. Acting on the newest match keeps test mode usable,
    // and the warning makes a real-world collision visible.
    const { data: matches, error: lookupError } = await supabase
      .from('orders')
      .select('id, fulfillment_status, shipped_at, delivered_at, fulfillment_method')
      .eq('tracking_number', trackingNumber)
      .order('created_at', { ascending: false })
      .limit(2)

    if (lookupError) {
      console.error('[shinyvault-track-webhook] lookup failed', lookupError.message)
      // A DB hiccup IS worth a retry, so this is the one case that returns 5xx.
      return json({ error: 'lookup failed' }, 500)
    }

    if (!matches || matches.length === 0) {
      // Not our parcel — a shared Shippo account, an old order, or noise.
      // 200 on purpose so Shippo stops retrying it.
      console.log(`[shinyvault-track-webhook] no order for tracking ${trackingNumber} (${carrierStatus}); ignoring`)
      return json({ ok: true, ignored: 'no matching order' })
    }
    if (matches.length > 1) {
      console.warn(`[shinyvault-track-webhook] tracking ${trackingNumber} matches multiple orders; using newest`)
    }

    const order = matches[0]
    const nextStatus = STATUS_MAP[carrierStatus] ?? null
    const currentRank = RANK[order.fulfillment_status] ?? 0

    // Every event records the raw carrier status, even the ones that do not
    // move the order — that is how staff see RETURNED or FAILURE at all.
    const patch: Record<string, unknown> = { carrier_status: carrierStatus }

    const isPickupLane = PICKUP_LANE.has(order.fulfillment_status)
    const advances = !!nextStatus && !isPickupLane && (RANK[nextStatus] ?? 0) > currentRank

    if (advances && nextStatus) {
      patch.fulfillment_status = nextStatus

      // The carrier scan is the real proof it shipped, and staff may never have
      // tapped the button — so backfill shipped_at from the scan. Only when it
      // is still NULL: an existing value came from the shop and is the earlier,
      // truer moment.
      if (!order.shipped_at) {
        patch.shipped_at = nextStatus === 'delivered'
          ? (firstTransitDate(track?.tracking_history) ?? asDate(track?.tracking_status?.status_date))
          : asDate(track?.tracking_status?.status_date)
      }
      if (nextStatus === 'delivered' && !order.delivered_at) {
        patch.delivered_at = asDate(track?.tracking_status?.status_date)
      }
    }

    // Conditional on the status we just read. Two copies of the same webhook
    // arriving at once would both pass the rank check above; this makes the
    // loser's update a no-op instead of a second "first transition to
    // delivered" (and therefore a second email).
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', order.id)
      .eq('fulfillment_status', order.fulfillment_status)
      .select('id')

    if (updateError) {
      console.error('[shinyvault-track-webhook] update failed', updateError.message)
      return json({ error: 'update failed' }, 500)
    }

    const applied = (updated?.length ?? 0) > 0
    console.log(
      `[shinyvault-track-webhook] ${trackingNumber} ${carrierStatus}`
      + ` (${track?.tracking_status?.substatus?.code || track?.tracking_status?.status_details || '-'})`
      + ` order=${order.id} ${order.fulfillment_status}${advances ? ` -> ${nextStatus}` : ' (no advance)'}`
      + `${applied ? '' : ' [raced, skipped]'}${body?.test ? ' [test]' : ''}`,
    )

    // First transition into delivered only — `applied` guarantees we won the
    // conditional update, so a duplicate webhook cannot send this twice.
    if (applied && advances && nextStatus === 'delivered' && DELIVERED_EMAIL_ENABLED) {
      try {
        await supabase.functions.invoke('shinyvault-order-email', {
          body: { type: 'order_delivered', order_id: order.id },
        })
      } catch (e) {
        // A failed courtesy email must not make Shippo retry a state change we
        // already committed.
        console.error('[shinyvault-track-webhook] delivered email error', (e as Error).message)
      }
    }

    return json({ ok: true, order_id: order.id, carrier_status: carrierStatus, advanced: applied && advances })
  } catch (e) {
    // Anything unexpected: log it and take the 200. Shippo retrying a payload
    // that already crashed us once just multiplies the noise.
    console.error('[shinyvault-track-webhook]', (e as Error).message)
    return json({ ok: true, error: 'handled' })
  }
})
