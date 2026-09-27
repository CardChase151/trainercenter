// Edge Function: shinyvault-cart-reminder
// Abandoned-cart emails for ShinyVault. Run by pg_cron every 15 minutes
// (migration 20260919120000_shinyvault_cart_recovery.sql).
//
// Walks open rows in sv_cart_leads and sends the step that is due:
//   step 1  ~1h after the last cart activity
//   step 2  ~24h after, and at least 12h after step 1
//   step 3  ~72h after, and at least 24h after step 2 (the last one)
//
// Before every send it re-checks the things that make an email wrong to send:
// they bought, they unsubscribed, they're mid-payment right now, or nothing in
// the cart is still for sale. Only items still in stock appear in the email.
//
// Each send claims its step with a conditional update first (steps_sent = N),
// so two overlapping runs can't both send the same step.
//
// Same Resend key and sender as shinyvault-order-email.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const RESEND_API_KEY = Deno.env.get('SHINYVAULT_RESEND_API_KEY') || ''
const FROM_ADDRESS = Deno.env.get('SHINYVAULT_FROM_ADDRESS') || '"ShinyVault" <noreply@mysendz.com>'
const SITE_URL = (Deno.env.get('SHINYVAULT_SITE_URL') || 'https://shinyvaultlgs.com').replace(/\/$/, '')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

// Commercial email has to carry a real postal address. Reuse the ship-from
// address Shippo already prints on every label.
const POSTAL = [
  Deno.env.get('SHIPPO_FROM_STREET1'),
  [Deno.env.get('SHIPPO_FROM_CITY'), Deno.env.get('SHIPPO_FROM_STATE')].filter(Boolean).join(', '),
  Deno.env.get('SHIPPO_FROM_ZIP'),
].filter(Boolean).join(' ')

const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const HOUR = 3600_000
const STEPS = [
  { after: 1 * HOUR, gap: 0 },
  { after: 24 * HOUR, gap: 12 * HOUR },
  { after: 72 * HOUR, gap: 24 * HOUR },
]
// A lead nobody touched for two weeks before its first email is stale.
const STALE = 14 * 24 * HOUR

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const imageUrl = (path: string | null) => {
  if (!path) return null
  if (/^https?:\/\//.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/render/image/public/shinyvault-media/${path.split('/').map(encodeURIComponent).join('/')}?width=240&quality=75&resize=contain`
}

type Item = { name: string; price_cents: number; quantity: number; image: string | null; last_one: boolean }

// ---- Copy. One joke per email, then get out of the way. No em dashes. ----
function copy(step: number, items: Item[]) {
  const first = items[0].name
  const more = items.length > 1 ? ` and ${items.length - 1} more` : ''
  const lastOne = items.find((i) => i.last_one)
  if (step === 1) {
    return {
      subject: 'Your cards want to be ripped',
      heading: "These packs aren't going to open themselves.",
      body: `You left <strong>${esc(first)}</strong>${more} in your cart. It's been sitting in the vault staring at the door ever since. Come back and give it the rip it deserves.`,
      text: `You left ${first}${more} in your cart. It's been sitting in the vault staring at the door ever since. Come back and give it the rip it deserves.`,
      button: 'Rip it open',
    }
  }
  if (step === 2) {
    return {
      subject: 'Still sealed. Still waiting.',
      heading: 'Day two in the vault.',
      body: `Your <strong>${esc(first)}</strong> has started telling the other boxes about you. It's getting a little awkward in here. Your cart is saved exactly how you left it.`,
      text: `Your ${first} has started telling the other boxes about you. It's getting a little awkward in here. Your cart is saved exactly how you left it.`,
      button: 'Back to my cart',
    }
  }
  const scarcity = lastOne ? ` Heads up: ${esc(lastOne.name)} is the last one we have.` : ''
  return {
    subject: 'Last call from the vault',
    heading: "This is the last time we'll bring it up.",
    body: `After this your cart goes quiet and someone else gets the rip.${scarcity} If you still want it, it's one tap away.`,
    text: `After this your cart goes quiet and someone else gets the rip.${lastOne ? ` Heads up: ${lastOne.name} is the last one we have.` : ''} If you still want it, it's one tap away.`,
    button: 'Claim my cart',
  }
}

function render(step: number, items: Item[], restoreUrl: string, unsubUrl: string) {
  const c = copy(step, items)
  const rows = items.map((i) => `
    <tr>
      <td width="76" style="padding:10px 0;vertical-align:middle;">
        ${i.image
          ? `<img src="${esc(i.image)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:contain;border-radius:10px;background:#191924;" />`
          : `<div style="width:64px;height:64px;border-radius:10px;background:#191924;"></div>`}
      </td>
      <td style="padding:10px 0;vertical-align:middle;font-size:15px;color:#f4f2ff;">
        ${esc(i.name)}${i.quantity > 1 ? ` <span style="color:#9d97b8;">&times;${i.quantity}</span>` : ''}
      </td>
      <td style="padding:10px 0;vertical-align:middle;text-align:right;font-size:15px;font-weight:700;color:#f4f2ff;white-space:nowrap;">
        ${money(i.price_cents * i.quantity)}
      </td>
    </tr>`).join('')

  const html = `
<div style="background:#0b0b12;padding:28px 12px;font-family:'Sora',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#14141e;border:1px solid #2a2a3a;border-radius:16px;overflow:hidden;">
    <div style="height:4px;background:linear-gradient(90deg,#5227ff,#b07cff,#5227ff);"></div>
    <div style="padding:26px 26px 8px;">
      <div style="font-size:13px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#b07cff;">ShinyVault</div>
      <h1 style="font-size:24px;line-height:1.25;font-weight:800;color:#f4f2ff;margin:14px 0 12px;">${c.heading}</h1>
      <p style="font-size:15px;line-height:1.6;color:#c9c4e0;margin:0 0 18px;">${c.body}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #2a2a3a;border-bottom:1px solid #2a2a3a;">${rows}</table>
      <div style="text-align:center;margin:24px 0 26px;">
        <a href="${esc(restoreUrl)}" style="display:inline-block;background:#5227ff;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 30px;border-radius:12px;">${c.button}</a>
      </div>
    </div>
  </div>
  <div style="max-width:560px;margin:16px auto 0;text-align:center;font-size:12px;line-height:1.6;color:#6f6a88;">
    You're getting this because you started a checkout at ShinyVault.<br />
    <a href="${esc(unsubUrl)}" style="color:#9d97b8;">Unsubscribe from cart reminders</a>${POSTAL ? `<br />${esc(POSTAL)}` : ''}
  </div>
</div>`

  const text = `${c.heading}\n\n${c.text}\n\n` +
    items.map((i) => `- ${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ''}  ${money(i.price_cents * i.quantity)}`).join('\n') +
    `\n\n${c.button}: ${restoreUrl}\n\nUnsubscribe from cart reminders: ${unsubUrl}${POSTAL ? `\n${POSTAL}` : ''}`

  return { subject: c.subject, html, text }
}

async function send(to: string, subject: string, html: string, text: string, unsubUrl: string) {
  if (!RESEND_API_KEY) return { error: 'SHINYVAULT_RESEND_API_KEY not set' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_ADDRESS, to, subject, html, text,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
    }),
  })
  const body = await res.json().catch(() => ({}))
  return res.ok ? { id: body?.id as string } : { error: JSON.stringify(body) }
}

const close = (id: string, reason: string) =>
  supabase.from('sv_cart_leads').update({ closed_at: new Date().toISOString(), closed_reason: reason }).eq('id', id)

Deno.serve(async (req) => {
  const { data: leads, error } = await supabase.from('sv_cart_leads')
    .select('*').is('closed_at', null).lt('steps_sent', 3)
  if (error) return json({ error: error.message }, 500)

  const now = Date.now()
  const results: unknown[] = []

  for (const lead of leads || []) {
    const idle = now - new Date(lead.last_activity_at).getTime()
    const sinceLast = lead.last_sent_at ? now - new Date(lead.last_sent_at).getTime() : Infinity
    const step = STEPS[lead.steps_sent]

    if (lead.steps_sent === 0 && idle > STALE) { await close(lead.id, 'stale'); continue }
    if (idle < step.after || sinceLast < step.gap) continue

    const email = String(lead.email).toLowerCase()

    const { data: optout } = await supabase.from('sv_email_optouts').select('email').eq('email', email).maybeSingle()
    if (optout) { await close(lead.id, 'unsubscribed'); continue }

    // Bought since the lead started, by email or by account. 'authorized' counts:
    // checkout holds the card and only captures when the label is bought.
    let paid = supabase.from('orders').select('id', { count: 'exact', head: true })
      .in('payment_status', ['authorized', 'paid']).gte('created_at', lead.created_at)
    paid = lead.user_id ? paid.or(`guest_email.ilike.${email},user_id.eq.${lead.user_id}`) : paid.ilike('guest_email', email)
    const { count: paidCount } = await paid
    if ((paidCount || 0) > 0) { await close(lead.id, 'purchased'); continue }

    // Someone on the Stripe page right now shouldn't get a "you forgot" email.
    const { count: inFlight } = await supabase.from('orders').select('id', { count: 'exact', head: true })
      .ilike('guest_email', email).eq('payment_status', 'pending')
      .gte('created_at', new Date(now - HOUR).toISOString())
    if ((inFlight || 0) > 0) continue

    const wanted = (lead.items || []) as { product_id: string; quantity: number }[]
    const { data: products } = await supabase.from('products')
      .select('id, name, price_cents, quantity_available, status, product_media(storage_path, sort_order)')
      .in('id', wanted.map((w) => w.product_id))
    const items: Item[] = []
    for (const w of wanted) {
      const p = (products || []).find((x: any) => x.id === w.product_id)
      if (!p || p.status !== 'active' || p.quantity_available <= 0) continue
      const media = (p.product_media || []).filter((m: any) => m.storage_path)
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
      items.push({
        name: p.name,
        price_cents: p.price_cents,
        quantity: Math.min(w.quantity, p.quantity_available),
        image: imageUrl(media[0]?.storage_path || null),
        last_one: p.quantity_available === 1,
      })
    }
    if (items.length === 0) { await close(lead.id, 'sold_out'); continue }

    // Claim the step before sending.
    const stepNo = lead.steps_sent + 1
    const { data: claimed } = await supabase.from('sv_cart_leads')
      .update({ steps_sent: stepNo, last_sent_at: new Date().toISOString() })
      .eq('id', lead.id).eq('steps_sent', lead.steps_sent).is('closed_at', null)
      .select('id')
    if (!claimed?.length) continue

    const restoreUrl = `${SITE_URL}/cart?restore=${lead.token}`
    const unsubUrl = `${SITE_URL}/unsubscribe?t=${lead.token}`
    const msg = render(stepNo, items, restoreUrl, unsubUrl)
    const sent = await send(email, msg.subject, msg.html, msg.text, unsubUrl)

    if ('error' in sent) {
      // Give the step back so the next run retries it.
      await supabase.from('sv_cart_leads')
        .update({ steps_sent: lead.steps_sent, last_sent_at: lead.last_sent_at }).eq('id', lead.id)
      results.push({ lead: lead.id, step: stepNo, error: sent.error })
      continue
    }

    await supabase.from('sv_cart_email_log').insert({ lead_id: lead.id, step: stepNo, email, resend_id: sent.id })
    if (stepNo === 3) await close(lead.id, 'finished')
    results.push({ lead: lead.id, step: stepNo, sent: sent.id })
  }

  return json({ checked: leads?.length || 0, results })
})
