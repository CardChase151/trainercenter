// ShinyVault bulk-upload AI recognition (bulk.md Step 3).
// Given one item's staged photo(s), reads the card/product with Gemini and
// returns structured catalog fields to pre-fill a draft product. It EXTRACTS
// printed text (name + collector number identify a card exactly) rather than
// guessing — that's what makes a cheap/fast model accurate here. Deno / Supabase
// Edge Function. Gated on shinyvault admin. Never invents a price.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_KEY = Deno.env.get('SHINYVAULT_GEMINI_API_KEY')!
const MODEL = 'gemini-flash-lite-latest' // cheapest fast vision tier; auto-tracks current flash-lite
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const PROMPT = `You are cataloging trading card game (TCG) inventory for a store — mostly Pokemon.
Look at the image(s) of ONE item and extract catalog data by READING the text printed on the card or product. Return JSON only.

Fields:
- product_type: one of "single" (a raw single card), "graded" (a card sealed in a grading slab such as PSA/BGS/CGC), "sealed" (sealed product: booster box, Elite Trainer Box, bundle, pack, collection/premium box), or "accessory" (sleeves, playmat, binder, figure, etc).
- name: the product name, formatted to MATCH THE STORE'S EXISTING NAMING STYLE (see conventions below).
- set_name: the set or product line (e.g. "Shining Legends", "Surging Sparks", "Crown Zenith"). Empty string if not determinable.
- number: the collector number EXACTLY as printed on a card (e.g. "78/73", "032/182", "SM166"). Empty for sealed product and accessories.
- rarity: the card rarity if visible or known (e.g. "Full Art", "Illustration Rare", "Special Illustration Rare", "Holo Rare", "Promo"). Empty if not applicable/unknown.
- language: "English", "Japanese", "Chinese", etc.
- grade: for a graded slab, the grade label exactly (e.g. "PSA 10", "CGC 9.5", "BGS 9.5"); otherwise empty string.
- confidence: number 0 to 1 — your confidence in the identification.

NAMING CONVENTIONS — match how this store already names products:
- Always spell "Pokémon" with the accented é.
- Use Title Case.
- SEALED products: "<Set> [Pokémon Center ]<Full Product Type>[ - <Variant>]". Spell the product type out in FULL — never abbreviate. Use "Elite Trainer Box" (NOT "ETB"), "Booster Box", "Booster Pack", "Premium Collection Box", "Ultra Premium Collection", "Collection Box", "Battle Box", "Figure Collection Box". Include "Pokémon Center" only when the box is the Pokémon Center version. Put a variant/character after a " - " or in parentheses.
  Real examples from this store:
    "Crown Zenith Elite Trainer Box"
    "Silver Tempest Pokémon Center Elite Trainer Box"
    "Paradox Rift Pokémon Center Elite Trainer Box - Roaring Moon"
    "Battle Styles Elite Trainer Box (Red)"
    "Destined Rivals Booster Box"
    "Sword & Shield Charizard Ultra Premium Collection"
- SINGLE / GRADED cards: use the card name exactly as printed (e.g. "Mewtwo GX", "Umbreon").

Read the printed NAME and COLLECTOR NUMBER carefully; together they identify the card exactly. If you cannot read a field, return an empty string rather than guessing. Do NOT estimate or invent a price.`

const SCHEMA = {
  type: 'object',
  properties: {
    product_type: { type: 'string', enum: ['single', 'graded', 'sealed', 'accessory'] },
    name: { type: 'string' },
    set_name: { type: 'string' },
    number: { type: 'string' },
    rarity: { type: 'string' },
    language: { type: 'string' },
    grade: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['product_type', 'name', 'confidence'],
}

async function fetchAsInlineData(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch ${res.status}`)
  const mime = res.headers.get('content-type') || 'image/jpeg'
  const buf = new Uint8Array(await res.arrayBuffer())
  // base64 encode
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  return { inline_data: { mime_type: mime.split(';')[0], data: btoa(bin) } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // ── Auth: shinyvault admin only ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: userData } = await supa.auth.getUser()
    if (!userData?.user) return json({ error: 'Not signed in' }, 401)
    const { data: prof } = await supa
      .from('profiles').select('is_shinyvault_admin').eq('id', userData.user.id).maybeSingle()
    if (!prof?.is_shinyvault_admin) return json({ error: 'Staff only' }, 403)

    // ── Input ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}))
    const urls: string[] = Array.isArray(body?.image_urls) ? body.image_urls.slice(0, 3) : []
    if (urls.length === 0) return json({ error: 'No image_urls provided' }, 400)

    const images = []
    for (const u of urls) {
      try { images.push(await fetchAsInlineData(u)) } catch (_) { /* skip unreadable */ }
    }
    if (images.length === 0) return json({ error: 'Could not read any image' }, 422)

    // ── Gemini ───────────────────────────────────────────────────────────
    const gRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [...images, { text: PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
      }),
    })
    if (!gRes.ok) {
      const t = await gRes.text()
      return json({ error: `Gemini ${gRes.status}`, detail: t.slice(0, 400) }, 502)
    }
    const gJson = await gRes.json()
    const text = gJson?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return json({ error: 'No result from model' }, 502)

    let parsed
    try { parsed = JSON.parse(text) } catch { return json({ error: 'Model returned non-JSON', raw: text.slice(0, 400) }, 502) }

    return json({ result: parsed })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
