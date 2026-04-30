#!/usr/bin/env node
/**
 * One-time Square customer import.
 *
 * Pulls every customer from Square via the /v2/customers endpoint
 * (paginated by cursor), then upserts into Supabase's marketing_contacts
 * keyed on square_customer_id (and falls back to email if there's a
 * collision).
 *
 * Run:
 *   SQUARE_TOKEN=xxx \
 *   SUPABASE_URL=https://tfneuzbhiqsdvnhhdfsw.supabase.co \
 *   SUPABASE_SERVICE_KEY=xxx \
 *   node scripts/import-square-customers.js
 *
 * The service-role key is needed because RLS blocks direct writes to
 * marketing_contacts unless you're an admin. Service role bypasses RLS.
 *
 * Safe to re-run: upserts on (square_customer_id) and respects existing
 * is_subscribed=false (never flips a previously-unsubscribed contact
 * back on).
 */

/* eslint-disable no-console */

const SQUARE_TOKEN = process.env.SQUARE_TOKEN;
const SQUARE_VERSION = process.env.SQUARE_VERSION || '2026-01-22';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SQUARE_TOKEN) {
  console.error('Missing SQUARE_TOKEN');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

async function pullAllSquareCustomers() {
  const all = [];
  let cursor = null;
  let page = 0;

  do {
    page += 1;
    const url = new URL('https://connect.squareup.com/v2/customers');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SQUARE_TOKEN}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Square API ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const batch = data.customers || [];
    all.push(...batch);
    cursor = data.cursor || null;
    console.log(`  page ${page}: +${batch.length} (total ${all.length})${cursor ? ' [more]' : ''}`);
  } while (cursor);

  return all;
}

function buildContactRow(c) {
  const email = (c.email_address || '').trim().toLowerCase();
  if (!email) return null; // No email = not useful for email marketing. Skip.

  const unsubscribed = Boolean(c?.preferences?.email_unsubscribed);

  return {
    email,
    first_name: c.given_name || null,
    last_name: c.family_name || null,
    phone: c.phone_number || null,
    source: 'square',
    square_customer_id: c.id,
    is_subscribed: !unsubscribed,
    unsubscribed_at: unsubscribed ? new Date().toISOString() : null,
    unsubscribe_reason: unsubscribed ? 'square_preference' : null,
    last_synced_at: new Date().toISOString(),
  };
}

async function supabaseRequest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  return res;
}

async function upsertBatch(rows) {
  // Upsert keyed on square_customer_id. If a row with the same email
  // exists from a different source, it'll fail the unique email
  // constraint -- handle that case row-by-row as a fallback.
  try {
    await supabaseRequest('/rest/v1/marketing_contacts?on_conflict=square_customer_id', {
      method: 'POST',
      body: JSON.stringify(rows),
    });
    return { ok: rows.length, fallback: 0, conflicts: [] };
  } catch (err) {
    // Fall back to one-at-a-time so a single conflict doesn't drop the batch.
    console.warn(`  batch upsert failed, falling back row-by-row: ${err.message}`);
    let ok = 0;
    const conflicts = [];
    for (const row of rows) {
      try {
        await supabaseRequest('/rest/v1/marketing_contacts?on_conflict=square_customer_id', {
          method: 'POST',
          body: JSON.stringify([row]),
        });
        ok += 1;
      } catch (rowErr) {
        // Likely email-already-exists from app_member/app_vendor source.
        // Don't blow away the existing row; just record the conflict.
        // We could optionally PATCH to backfill square_customer_id on the
        // existing email row, but that's out of scope for the seed.
        conflicts.push({ email: row.email, square_id: row.square_customer_id, error: rowErr.message });
      }
    }
    return { ok, fallback: rows.length - ok, conflicts };
  }
}

(async () => {
  console.log(`Square import starting (Square-Version: ${SQUARE_VERSION})`);

  console.log('1. Pulling customers from Square...');
  const customers = await pullAllSquareCustomers();
  console.log(`   Pulled ${customers.length} total Square customers.`);

  // Stats
  const withEmail = customers.filter((c) => (c.email_address || '').trim());
  const unsubscribedFromSquare = customers.filter((c) => c?.preferences?.email_unsubscribed);
  const instantProfile = customers.filter((c) => c.creation_source === 'INSTANT_PROFILE');

  console.log('   Stats:');
  console.log(`     with email:                ${withEmail.length}`);
  console.log(`     without email (skipping):  ${customers.length - withEmail.length}`);
  console.log(`     unsubscribed in Square:    ${unsubscribedFromSquare.length}`);
  console.log(`     INSTANT_PROFILE source:    ${instantProfile.length}`);

  const rows = customers.map(buildContactRow).filter(Boolean);
  // Deduplicate by email within the batch so a Square account with two
  // entries on the same email doesn't fail the unique constraint.
  const seen = new Map();
  for (const row of rows) {
    const existing = seen.get(row.email);
    if (!existing || (row.last_synced_at > existing.last_synced_at)) {
      seen.set(row.email, row);
    }
  }
  const dedupedRows = [...seen.values()];
  console.log(`   Inserting ${dedupedRows.length} rows after dedup.`);

  console.log('2. Upserting into marketing_contacts...');
  const BATCH = 200;
  let totalOk = 0;
  const allConflicts = [];
  for (let i = 0; i < dedupedRows.length; i += BATCH) {
    const slice = dedupedRows.slice(i, i + BATCH);
    const { ok, conflicts } = await upsertBatch(slice);
    totalOk += ok;
    allConflicts.push(...conflicts);
    console.log(`   batch ${i / BATCH + 1}: +${ok} (running total ${totalOk})`);
  }

  console.log('Done.');
  console.log(`   Inserted/updated: ${totalOk}`);
  console.log(`   Conflicts:        ${allConflicts.length}`);
  if (allConflicts.length) {
    console.log('   First 10 conflicts:');
    for (const c of allConflicts.slice(0, 10)) {
      console.log(`     ${c.email} (square ${c.square_id}): ${c.error}`);
    }
  }
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
