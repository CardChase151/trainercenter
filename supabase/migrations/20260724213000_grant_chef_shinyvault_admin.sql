-- Chef gets Shiny Vault admin too (Chase 2026-07-24). Final roster:
--   Chase, Brent, Chef - admin on both apps
--   Olin               - Shiny Vault only
--   Seth               - neither
update public.profiles
   set is_shinyvault_admin = true,
       updated_at = now()
 where lower(email) = 'chef@trainercenter.com';
