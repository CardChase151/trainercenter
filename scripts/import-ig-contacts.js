#!/usr/bin/env node
/**
 * One-time Instagram contacts import.
 *
 * Parses the two JSON files from an IG data export:
 *   - connections/followers_and_following/followers_1.json
 *   - connections/followers_and_following/following.json
 *
 * Computes relationship (follower / following / mutual), then upserts
 * each handle into public.ig_contacts. Re-running is safe -- existing
 * rows have their profile_url + relationship refreshed but their tag,
 * notes, last_contacted_at, and *_id links are preserved.
 *
 * Service-role key is required because RLS blocks direct writes unless
 * the caller is_admin(). Service role bypasses RLS.
 *
 * Run:
 *   SUPABASE_URL=https://tfneuzbhiqsdvnhhdfsw.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   IG_ARCHIVE_DIR=./instagram-archive/connections \
 *   node scripts/import-ig-contacts.js
 *
 * IG_ARCHIVE_DIR defaults to ./instagram-archive/connections (where
 * the extract step puts followers_1.json + following.json).
 */

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const IG_DIR = process.env.IG_ARCHIVE_DIR || path.resolve('instagram-archive/connections');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const FOLLOWERS_PATH = path.join(IG_DIR, 'followers_1.json');
const FOLLOWING_PATH = path.join(IG_DIR, 'following.json');

if (!fs.existsSync(FOLLOWERS_PATH) || !fs.existsSync(FOLLOWING_PATH)) {
  console.error(`Could not find followers_1.json + following.json in ${IG_DIR}`);
  console.error('Extract them from the IG zip first:');
  console.error('  unzip -j instagram-*.zip "connections/followers_and_following/*.json" -d instagram-archive/connections/');
  process.exit(1);
}

function normalizeHandle(s) {
  return (s || '').trim().toLowerCase();
}

function parseFollowers() {
  const raw = JSON.parse(fs.readFileSync(FOLLOWERS_PATH, 'utf8'));
  const out = new Map();
  for (const entry of raw) {
    const sld = entry.string_list_data && entry.string_list_data[0];
    if (!sld) continue;
    const handle = normalizeHandle(sld.value);
    if (!handle) continue;
    out.set(handle, { profile_url: sld.href || null, timestamp: sld.timestamp || null });
  }
  return out;
}

function parseFollowing() {
  const raw = JSON.parse(fs.readFileSync(FOLLOWING_PATH, 'utf8'));
  const list = raw.relationships_following || [];
  const out = new Map();
  for (const entry of list) {
    const sld = entry.string_list_data && entry.string_list_data[0];
    let handle = normalizeHandle(entry.title);
    if (!handle && sld && sld.href) {
      handle = normalizeHandle(sld.href.split('/').filter(Boolean).pop());
    }
    if (!handle) continue;
    out.set(handle, { profile_url: sld ? (sld.href || null) : null, timestamp: sld ? (sld.timestamp || null) : null });
  }
  return out;
}

function buildRows(followers, following) {
  const all = new Set([...followers.keys(), ...following.keys()]);
  const rows = [];
  for (const handle of all) {
    const isF = followers.has(handle);
    const isG = following.has(handle);
    const src = followers.get(handle) || following.get(handle);
    const relationship = isF && isG ? 'mutual' : isF ? 'follower' : 'following';
    rows.push({
      handle,
      profile_url: src.profile_url,
      relationship,
      followed_at: src.timestamp ? new Date(src.timestamp * 1000).toISOString() : null,
    });
  }
  rows.sort((a, b) => a.handle.localeCompare(b.handle));
  return rows;
}

async function supabaseRequest(pathSuffix, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathSuffix}`, {
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

async function upsertBatch(batch) {
  // on_conflict=handle preserves tag/notes/etc on existing rows because we
  // only send the columns we want to refresh.
  await supabaseRequest('/rest/v1/ig_contacts?on_conflict=handle', {
    method: 'POST',
    body: JSON.stringify(batch),
  });
}

(async () => {
  console.log('IG contacts import starting');
  console.log(`  archive dir: ${IG_DIR}`);

  const followers = parseFollowers();
  const following = parseFollowing();
  console.log(`  followers: ${followers.size}`);
  console.log(`  following: ${following.size}`);

  const rows = buildRows(followers, following);
  const mutuals = rows.filter((r) => r.relationship === 'mutual').length;
  console.log(`  total unique handles: ${rows.length}`);
  console.log(`  mutuals: ${mutuals}`);

  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await upsertBatch(batch);
    done += batch.length;
    process.stdout.write(`\r  upserted ${done}/${rows.length}`);
  }
  process.stdout.write('\n');
  console.log('Done.');
})().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
