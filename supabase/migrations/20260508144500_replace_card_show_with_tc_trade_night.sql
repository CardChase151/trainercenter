-- Replace the generic 'card_show' category with the TC-branded
-- 'tc_trade_night' category. Trainer Center's biggest event — last Friday of
-- the month. Every event currently tagged card_show is in fact a TC Beach City
-- Trade Night, so the rename is a 1:1 swap. The legacy 'trade_night' category
-- (red, weekly) stays untouched.

-- 1. Retag every TC Beach City Trade Night event (matches 11 rows: 10 tagged
--    card_show plus one stray May 29 row tagged trade_night). Replace the
--    whole categories array since these events should only ever carry the
--    new tc_trade_night tag.
UPDATE public.events
SET categories = ARRAY['tc_trade_night']
WHERE title ILIKE '%Beach City Trade Night%';

-- 2. Safety net: strip any remaining card_show tags from any other rows
--    that aren't TC Beach City Trade Nights. (None expected, but keeps the
--    string out of the column going forward.)
UPDATE public.events
SET categories = array_remove(categories, 'card_show')
WHERE 'card_show' = ANY(categories);

-- 3. Backfill safety: any row that ended up with an empty categories[] after
--    the strip falls back to 'other' so the UI never sees a 0-length array.
UPDATE public.events
SET categories = ARRAY['other']
WHERE cardinality(categories) = 0;

-- 4. Marketing contacts: rename subscriptions.card_show -> tc_trade_night,
--    preserving each contact's bool preference. Only touches rows that have
--    the old key set; default-shaped subscriptions are unaffected.
UPDATE public.marketing_contacts
SET subscriptions = (subscriptions - 'card_show')
                    || jsonb_build_object('tc_trade_night', subscriptions->'card_show')
WHERE subscriptions ? 'card_show';
