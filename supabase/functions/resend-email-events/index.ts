// resend-email-events
// Resend reports delivered / opened / clicked / bounced for mail sent from
// mysendz.com. We verify the Svix signature and keep one row per event so
// /staff/comms can show who actually read what.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || ''
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)))

async function verify(body: string, req: Request) {
  const id = req.headers.get('svix-id') || ''
  const ts = req.headers.get('svix-timestamp') || ''
  const sigHeader = req.headers.get('svix-signature') || ''
  if (!SECRET || !id || !ts || !sigHeader) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const raw = Uint8Array.from(atob(SECRET.replace(/^whsec_/, '')), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))
  return sigHeader.split(' ').some(s => s.split(',')[1] === expected)
}

// Resend returns tags as an object ({campaign: 'x'}) or a list of {name, value}.
function campaignOf(tags: any): string | null {
  if (!tags) return null
  if (Array.isArray(tags)) return tags.find((t: any) => t.name === 'campaign')?.value || null
  return tags.campaign || null
}

const KEEP = new Set(['email.sent', 'email.delivered', 'email.opened', 'email.clicked', 'email.bounced', 'email.complained'])

Deno.serve(async (req) => {
  const body = await req.text()
  if (!(await verify(body, req))) return new Response('bad signature', { status: 401 })
  let evt: any
  try { evt = JSON.parse(body) } catch { return new Response('bad json', { status: 400 }) }
  if (!KEEP.has(evt.type)) return new Response('ignored', { status: 200 })
  const d = evt.data || {}
  const to = Array.isArray(d.to) ? d.to[0] : d.to
  if (!d.email_id || !to) return new Response('no email', { status: 200 })
  const { error } = await supabase.from('email_events').insert({
    resend_email_id: d.email_id,
    event_type: evt.type.replace('email.', ''),
    to_email: String(to).toLowerCase(),
    subject: d.subject || null,
    link: d.click?.link || null,
    campaign: campaignOf(d.tags),
    occurred_at: d.click?.timestamp || d.created_at || evt.created_at || new Date().toISOString(),
  })
  if (error && error.code !== '23505') {
    console.log(JSON.stringify({ msg: 'insert failed', error: error.message }))
    return new Response('db error', { status: 500 })
  }
  return new Response('ok', { status: 200 })
})
