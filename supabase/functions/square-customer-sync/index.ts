// Edge Function: square-customer-sync
// Daily incremental sync of Square customers into marketing_contacts.
// Triggered by pg_cron via pg_net once per day. Reads the last successful
// sync time from sync_state, asks Square for customers with updated_at >=
// that, and feeds them through bulk_upsert_square_customers.
//
// Auth model: the Square Access Token lives in Supabase Vault (encrypted
// at rest). We pull it on each invocation via the get_square_access_token()
// SECURITY DEFINER RPC, callable only by service_role. This avoids
// per-function env vars and keeps the token rotatable without redeploys.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SQUARE_VERSION = Deno.env.get('SQUARE_VERSION') || '2026-01-22'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

async function getSquareToken(): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_square_access_token`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  if (!res.ok) return null
  const token = await res.json()
  return typeof token === 'string' && token.length > 0 ? token : null
}

async function readLastSync(): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sync_state?key=eq.square_customers_last_sync&select=value`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  )
  if (!res.ok) return null
  const rows = await res.json()
  return rows?.[0]?.value?.last_sync_at ?? null
}

async function writeLastSync(ts: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/sync_state?on_conflict=key`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      key: 'square_customers_last_sync',
      value: { last_sync_at: ts },
      updated_at: ts,
    }),
  })
}

type SquareCustomer = {
  id: string
  given_name?: string
  family_name?: string
  email_address?: string
  phone_number?: string
  preferences?: { email_unsubscribed?: boolean }
  updated_at?: string
}

async function pullUpdatedSince(token: string, sinceIso: string | null): Promise<SquareCustomer[]> {
  const all: SquareCustomer[] = []
  let cursor: string | null = null
  do {
    const body: Record<string, unknown> = {
      query: sinceIso ? { filter: { updated_at: { start_at: sinceIso } } } : {},
      limit: 100,
    }
    if (cursor) body.cursor = cursor

    const res = await fetch('https://connect.squareup.com/v2/customers/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Square API ${res.status}: ${errBody}`)
    }
    const data = await res.json()
    const batch = (data.customers || []) as SquareCustomer[]
    all.push(...batch)
    cursor = data.cursor || null
  } while (cursor)
  return all
}

async function upsertBatch(payload: Record<string, unknown>[]): Promise<{ inserted: number; skipped: number }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bulk_upsert_square_customers`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_data: payload }),
  })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`bulk_upsert_square_customers ${res.status}: ${errBody}`)
  }
  const result = await res.json()
  return { inserted: result?.inserted ?? 0, skipped: result?.skipped ?? 0 }
}

Deno.serve(async (_req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Supabase env not available' }, 500)
  }

  const token = await getSquareToken()
  if (!token) {
    return json({ error: 'Could not read Square token from vault' }, 500)
  }

  const startedAt = new Date()
  const lastSync = await readLastSync()

  let customers: SquareCustomer[]
  try {
    customers = await pullUpdatedSince(token, lastSync)
  } catch (err) {
    return json({ error: 'square_pull_failed', details: String(err) }, 502)
  }

  if (customers.length === 0) {
    await writeLastSync(startedAt.toISOString())
    return json({
      ok: true,
      last_sync_before: lastSync,
      pulled: 0,
      inserted: 0,
      skipped: 0,
      last_sync_after: startedAt.toISOString(),
    })
  }

  const payload = customers.map((c) => ({
    square_customer_id: c.id,
    email: c.email_address || '',
    first_name: c.given_name || '',
    last_name: c.family_name || '',
    phone: c.phone_number || '',
    is_subscribed: !c.preferences?.email_unsubscribed,
  }))

  let inserted = 0
  let skipped = 0
  const BATCH = 500
  try {
    for (let i = 0; i < payload.length; i += BATCH) {
      const slice = payload.slice(i, i + BATCH)
      const r = await upsertBatch(slice)
      inserted += r.inserted
      skipped += r.skipped
    }
  } catch (err) {
    return json({
      error: 'rpc_failed',
      details: String(err),
      pulled: customers.length,
      inserted_so_far: inserted,
    }, 500)
  }

  await writeLastSync(startedAt.toISOString())

  return json({
    ok: true,
    last_sync_before: lastSync,
    pulled: customers.length,
    inserted,
    skipped,
    last_sync_after: startedAt.toISOString(),
  })
})
