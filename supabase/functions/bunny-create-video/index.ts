// Edge Function: bunny-create-video
// Creates a video record on Bunny Stream, returns signed TUS auth headers so
// the frontend can upload directly to Bunny without ever seeing the API key.
//
// Caller must be authenticated, must have a vendor row, and must have an
// approved application for the given event.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const BUNNY_LIBRARY_ID = Deno.env.get('BUNNY_LIBRARY_ID') || ''
const BUNNY_API_KEY = Deno.env.get('BUNNY_API_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  if (!BUNNY_LIBRARY_ID || !BUNNY_API_KEY) {
    return json({ error: 'Bunny credentials not configured on the server' }, 500)
  }

  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'unauthorized' }, 401)

  // Use the user's JWT so RLS scopes the queries to their vendor row.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )

  let body: { event_id?: string; title?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }
  const { event_id, title } = body
  if (!event_id) return json({ error: 'event_id required' }, 400)

  // Vendor profile (RLS limits this to the caller's own row)
  const { data: vendor, error: vErr } = await supabase
    .from('vendors')
    .select('id, name')
    .single()
  if (vErr || !vendor) return json({ error: 'no vendor profile for this user' }, 403)

  // Approved application for this event
  const { data: app, error: aErr } = await supabase
    .from('vendor_applications')
    .select('status')
    .eq('vendor_id', vendor.id)
    .eq('event_id', event_id)
    .maybeSingle()
  if (aErr) return json({ error: aErr.message }, 500)
  if (!app || app.status !== 'approved') {
    return json({ error: 'no approved application for this event' }, 403)
  }

  // Create video record on Bunny
  const videoTitle = (title && title.slice(0, 200)) || `${vendor.name} - Vendor Day`
  const createRes = await fetch(
    `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
    {
      method: 'POST',
      headers: {
        AccessKey: BUNNY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: videoTitle }),
    }
  )
  if (!createRes.ok) {
    const errText = await createRes.text()
    return json({ error: `bunny create failed: ${errText}` }, 502)
  }
  const created = await createRes.json()
  const videoGuid: string = created.guid

  // Compute SHA256 HMAC signature for TUS direct upload.
  // Bunny formula: sha256( libraryId + apiKey + expire + videoGuid )
  const expire = Math.floor(Date.now() / 1000) + 3600 // 1 hour validity
  const sigInput = `${BUNNY_LIBRARY_ID}${BUNNY_API_KEY}${expire}${videoGuid}`
  const sigBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sigInput))
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return json({
    videoGuid,
    signature,
    expire,
    libraryId: BUNNY_LIBRARY_ID,
  })
})
