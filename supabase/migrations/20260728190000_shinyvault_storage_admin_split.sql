-- Shiny Vault media-upload RLS fix (2026-07-28)
--
-- The 2026-07-24 admin-privilege split (20260724203000) moved every Shiny Vault
-- *table* policy from public.is_admin() onto public.is_shinyvault_admin(), but
-- missed the storage bucket policy on storage.objects for the shinyvault-media
-- bucket. Result: a Shiny Vault-only admin (Olin) could INSERT the product_media
-- DB row but could NOT upload the actual file — the storage INSERT still
-- required the Trainer Center is_admin flag, so the file write failed with
-- "new row violates row-level security policy".
--
-- Fix: recreate the shinyvault-media manage policy on is_shinyvault_admin(),
-- matching the pattern of every other Shiny Vault commerce policy. All four
-- admins (Chase/Brent/Chef have both flags; Olin has is_shinyvault_admin) pass.
-- Scoped strictly to bucket_id = 'shinyvault-media'; vendor-media and all
-- Trainer Center storage policies are untouched.

drop policy if exists "Admins manage shinyvault-media" on storage.objects;

create policy "Admins manage shinyvault-media"
  on storage.objects for all to authenticated
  using (bucket_id = 'shinyvault-media' and public.is_shinyvault_admin(auth.uid()))
  with check (bucket_id = 'shinyvault-media' and public.is_shinyvault_admin(auth.uid()));
