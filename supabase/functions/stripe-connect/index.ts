// Stripe Connect onboarding for the store's receiving bank account.
// Same pass-through pattern as Tacos Miranda / UniTeam: we create ONE
// Stripe Connect Standard account (singleton row stripe_settings.id='main'),
// Stripe hosts the onboarding where the owner enters business + bank info,
// and we only ever store the account id + capability flags. Checkout flows
// later charge directly on the connected account so funds land in the
// store's bank, never ours.
//
// Owner-gated: caller must be logged in AND profiles.is_owner = true
// (Chase, Chef, Brent). Staff without the owner flag get a 403.
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // ── Owner gate ──
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'Not logged in' }, 401)
    const { data: prof } = await supabase
      .from('profiles')
      .select('is_owner')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (!prof?.is_owner) return json({ error: 'Owner access only' }, 403)

    if (!stripeKey) {
      return json({ error: 'STRIPE_SECRET_KEY not configured in Supabase secrets yet' }, 500)
    }
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    const { action, return_url, refresh_url } = await req.json()

    // Singleton: id='main'
    const { data: existing } = await supabase
      .from('stripe_settings')
      .select('*')
      .eq('id', 'main')
      .maybeSingle()

    if (action === 'create_account') {
      let accountId = existing?.stripe_account_id as string | null

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'standard',
          metadata: { trainer_center: 'owner' },
        })
        accountId = account.id

        await supabase.from('stripe_settings').upsert({
          id: 'main',
          stripe_account_id: accountId,
          onboarding_complete: false,
          charges_enabled: false,
          payouts_enabled: false,
          updated_at: new Date().toISOString(),
        })
      }

      const link = await stripe.accountLinks.create({
        account: accountId!,
        return_url: return_url || 'https://pokemontrainercenter.com/staff/banking?stripe=return',
        refresh_url: refresh_url || 'https://pokemontrainercenter.com/staff/banking?stripe=refresh',
        type: 'account_onboarding',
      })

      return json({ url: link.url })
    }

    if (action === 'check_status') {
      if (!existing?.stripe_account_id) {
        return json({ connected: false })
      }
      const account = await stripe.accounts.retrieve(existing.stripe_account_id)

      await supabase
        .from('stripe_settings')
        .update({
          onboarding_complete: account.details_submitted,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          business_name:
            account.business_profile?.name ||
            account.settings?.dashboard?.display_name ||
            null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'main')

      return json({
        connected: true,
        onboarding_complete: account.details_submitted,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        business_name:
          account.business_profile?.name ||
          account.settings?.dashboard?.display_name,
      })
    }

    if (action === 'login_link') {
      if (!existing?.stripe_account_id) {
        return json({ error: 'Not connected' }, 400)
      }
      // Standard accounts log in with their own Stripe credentials, so
      // createLoginLink usually 400s — fall back to the hosted dashboard.
      try {
        const link = await stripe.accounts.createLoginLink(existing.stripe_account_id)
        return json({ url: link.url })
      } catch (_e) {
        return json({ url: 'https://dashboard.stripe.com/' })
      }
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[stripe-connect]', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
