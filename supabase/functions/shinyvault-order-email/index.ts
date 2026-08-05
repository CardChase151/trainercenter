// Edge Function: shinyvault-order-email
// Resend-backed transactional emails for ShinyVault orders.
//
// Types:
//   order_confirmation  (payment cleared — includes tracking link if the label
//                        was already bought, or pickup instructions)
//   order_shipped       (staff advanced a pickup-less order to 'shipped', or a
//                        label got bought late after a retry)
//   order_delivered     (carrier scanned the parcel as delivered — sent by
//                        shinyvault-track-webhook, never by a human)
//
// Why a separate function from send-vendor-email: that one is Trainer Center
// branded, keyed off vendor/member ids, and its FROM is "Trainer Center HB".
// ShinyVault is a different storefront with a different sender identity, and
// bolting a 14th type onto that switch would mean every ShinyVault email
// change risks Chef's vendor comms.
//
// Deployed with --no-verify-jwt: shinyvault-stripe-webhook invokes it with the
// service role key, and there's no end-user session in a webhook context.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// SHINYVAULT_RESEND_API_KEY — ShinyVault's OWN Resend key, deliberately not
// Trainer Center's shared RESEND_API_KEY. Different storefront, different
// sender identity, and a rotation or a sending-reputation problem on one
// shouldn't take out the other. Stored in 1Password as
// "ShinyVault Resend API Key" (App Publishing vault).
//   supabase secrets set SHINYVAULT_RESEND_API_KEY=... --project-ref tfneuzbhiqsdvnhhdfsw
const RESEND_API_KEY = Deno.env.get('SHINYVAULT_RESEND_API_KEY') || ''

// Display name quoted per RFC 5322 — Zoho strips unquoted display names that
// contain spaces (same trap documented in send-vendor-email).
const FROM_ADDRESS = Deno.env.get('SHINYVAULT_FROM_ADDRESS') || '"ShinyVault" <noreply@mysendz.com>'
const SITE_URL = Deno.env.get('SHINYVAULT_SITE_URL') || 'https://shineyvault.netlify.app'
const PICKUP_DETAILS = Deno.env.get('SHINYVAULT_PICKUP_DETAILS') || ''

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

const money = (cents: number | null | undefined) => `$${((cents || 0) / 100).toFixed(2)}`

// Order data is shop-controlled, not user-controlled, but product names are
// free text typed into the admin and land inside an HTML email — escape them
// rather than trusting that nobody ever pastes an ampersand or an angle
// bracket into a card title.
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) {
    console.log('[shinyvault-order-email] RESEND_API_KEY not set; skipping send')
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
  const body = await res.json()
  if (!res.ok) {
    console.error('[shinyvault-order-email] resend error', body)
    return { error: body }
  }
  return { id: body?.id }
}

const shell = (heading: string, bodyHtml: string) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <div style="font-size:1.25rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:4px;">ShinyVault</div>
  <h1 style="font-size:1.35rem;font-weight:800;margin:18px 0 14px;">${heading}</h1>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e5e5e5;margin:26px 0 14px;" />
  <div style="font-size:0.78rem;color:#777;">
    Questions? Just reply to this email.
  </div>
</div>`

const itemRows = (items: any[]) => items.map((i) => `
  <tr>
    <td style="padding:7px 0;font-size:0.9rem;">${esc(i.product_name_snapshot)}${i.quantity > 1 ? ` &times;${i.quantity}` : ''}</td>
    <td style="padding:7px 0;font-size:0.9rem;text-align:right;">${money(i.price_cents_snapshot * i.quantity)}</td>
  </tr>`).join('')

const trackingBlock = (order: any) => {
  if (!order.tracking_number) return ''
  const carrier = [order.shipping_carrier, order.shipping_service].filter(Boolean).join(' ')
  const num = esc(order.tracking_number)
  // Link only when the carrier gave us a real URL. A bare tracking number
  // beats an anchor pointing at nothing.
  const linked = order.tracking_url
    ? `<a href="${esc(order.tracking_url)}" style="color:#2563eb;font-weight:700;">${num}</a>`
    : `<strong>${num}</strong>`
  return `
  <div style="background:#f5f7ff;border-radius:10px;padding:14px 16px;margin:18px 0;">
    <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;color:#666;letter-spacing:0.04em;">Tracking</div>
    <div style="margin-top:6px;font-size:0.95rem;">${linked}</div>
    ${carrier ? `<div style="margin-top:4px;font-size:0.8rem;color:#666;">${esc(carrier)}</div>` : ''}
    ${order.tracking_url ? `<a href="${esc(order.tracking_url)}" style="display:inline-block;margin-top:12px;background:#1a1a1a;color:#fff;text-decoration:none;padding:9px 16px;border-radius:7px;font-size:0.85rem;font-weight:700;">Track your package</a>` : ''}
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { type, order_id } = await req.json()
    if (!order_id) return json({ error: 'order_id is required' }, 400)

    const { data: order, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', order_id)
      .single()
    if (error) return json({ error: error.message }, 500)
    if (!order) return json({ error: 'Order not found' }, 404)

    // Registered buyers have no guest_email, so fall back to their auth record.
    let to = order.guest_email as string | null
    if (!to && order.user_id) {
      const { data: authUser } = await supabase.auth.admin.getUserById(order.user_id)
      to = authUser?.user?.email || null
    }
    if (!to) return json({ error: 'No email address on this order' }, 400)

    const items = order.order_items || []
    const isShip = order.fulfillment_method === 'ship'
    // Deep link to the order page. The route is /order/:token (App.js) and the
    // token — not the order id — is the credential get_order_by_token() checks,
    // so this link works for guests with no account. /order/lookup is the
    // paste-your-token fallback page and is not what we want here.
    const lookupUrl = `${SITE_URL}/order/${order.order_token}`

    const totals = `
      <table style="width:100%;border-collapse:collapse;margin-top:6px;">
        ${itemRows(items)}
        <tr><td colspan="2" style="padding-top:10px;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;" /></td></tr>
        <tr>
          <td style="padding:7px 0;font-size:0.88rem;color:#666;">Subtotal</td>
          <td style="padding:7px 0;font-size:0.88rem;text-align:right;color:#666;">${money(order.subtotal_cents)}</td>
        </tr>
        ${isShip ? `<tr>
          <td style="padding:0 0 7px;font-size:0.88rem;color:#666;">Shipping</td>
          <td style="padding:0 0 7px;font-size:0.88rem;text-align:right;color:#666;">${money(order.shipping_rate_cents)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:7px 0;font-weight:800;">Total</td>
          <td style="padding:7px 0;font-weight:800;text-align:right;">${money(order.total_cents)}</td>
        </tr>
      </table>`

    let subject: string
    let html: string
    let text: string

    if (type === 'order_shipped') {
      subject = `Your ShinyVault order is on its way`
      html = shell('Your order shipped', `
        <p style="font-size:0.95rem;line-height:1.55;">Good news — your order is on its way.</p>
        ${trackingBlock(order)}
        ${totals}
        <p style="font-size:0.85rem;color:#666;margin-top:18px;">
          <a href="${lookupUrl}" style="color:#2563eb;">View your order</a>
        </p>`)
      text = [
        'Your ShinyVault order shipped.',
        order.tracking_number ? `Tracking: ${order.tracking_number}` : '',
        order.tracking_url || '',
        `Total: ${money(order.total_cents)}`,
        `View your order: ${lookupUrl}`,
      ].filter(Boolean).join('\n')
    } else if (type === 'order_delivered') {
      subject = `Your ShinyVault order was delivered`
      html = shell('Your order was delivered', `
        <p style="font-size:0.95rem;line-height:1.55;">The carrier scanned your package as delivered. Enjoy it.</p>
        ${trackingBlock(order)}
        ${totals}
        <p style="font-size:0.88rem;line-height:1.55;margin-top:18px;">
          Not where you expected? Carriers sometimes scan a package delivered a little early, or leave it
          with a neighbor or in a back door area. Give it until the end of the next day, then reply to this
          email and we'll chase it down with the carrier.
        </p>
        <p style="font-size:0.85rem;color:#666;margin-top:18px;">
          <a href="${lookupUrl}" style="color:#2563eb;">View your order</a>
        </p>`)
      text = [
        'Your ShinyVault order was delivered.',
        order.tracking_number ? `Tracking: ${order.tracking_number}` : '',
        order.tracking_url || '',
        `Total: ${money(order.total_cents)}`,
        "Not where you expected? Give it until the end of the next day, then reply to this email and we'll chase it down with the carrier.",
        `View your order: ${lookupUrl}`,
      ].filter(Boolean).join('\n')
    } else {
      // Default: order_confirmation. The webhook fires this after attempting
      // the label purchase, so a shipped order usually already has tracking
      // and the customer gets one email instead of two.
      subject = `ShinyVault order confirmed — ${money(order.total_cents)}`
      const fulfillmentNote = isShip
        ? (order.tracking_number
            ? '<p style="font-size:0.95rem;line-height:1.55;">Your label is printed and your package is on its way.</p>'
            : '<p style="font-size:0.95rem;line-height:1.55;">We\'re packing your order now. You\'ll get a tracking number as soon as it ships.</p>')
        : `<p style="font-size:0.95rem;line-height:1.55;">We'll email you as soon as it's ready for pickup.${PICKUP_DETAILS ? ` ${esc(PICKUP_DETAILS)}` : ''}</p>`

      html = shell('Thanks for your order', `
        <p style="font-size:0.95rem;line-height:1.55;">We got your payment. Here's what you ordered:</p>
        ${totals}
        ${fulfillmentNote}
        ${trackingBlock(order)}
        <p style="font-size:0.85rem;color:#666;margin-top:18px;">
          <a href="${lookupUrl}" style="color:#2563eb;">View your order</a>
        </p>`)
      text = [
        'Thanks for your order.',
        ...items.map((i: any) => `- ${i.product_name_snapshot}${i.quantity > 1 ? ` x${i.quantity}` : ''}  ${money(i.price_cents_snapshot * i.quantity)}`),
        `Total: ${money(order.total_cents)}`,
        order.tracking_number ? `Tracking: ${order.tracking_number}` : '',
        order.tracking_url || '',
        `View your order: ${lookupUrl}`,
      ].filter(Boolean).join('\n')
    }

    const result = await sendEmail(to, subject, html, text)
    return json({ ok: !result?.error, ...result })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
