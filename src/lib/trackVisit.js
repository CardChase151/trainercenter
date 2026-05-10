// First-party page visit tracking. Fires once per browser session and logs
// a row to public.page_visits in Supabase, capturing the referrer + a
// detected AI bot type if applicable.
//
// Privacy stance: no IP, no precise location, no cookies. Only referrer,
// user-agent, and a random per-session id (sessionStorage). The daily SEO
// digest reads this table to attribute traffic beyond what GSC sees.
//
// Why a module-level fire-and-forget instead of a hook: this should run
// once per arrival, not on every React re-render. Importing this file from
// index.js triggers the call exactly once.

import { supabase } from '../supabaseClient';

(function trackOnce() {
  if (typeof window === 'undefined') return;
  // Skip if already logged this session
  if (sessionStorage.getItem('_pv_logged')) return;

  try {
    const url = new URL(window.location.href);
    const referrer = document.referrer || '';
    let referrerHost = '';
    try { if (referrer) referrerHost = new URL(referrer).hostname.toLowerCase(); } catch (_) {}

    const ua = (navigator.userAgent || '').toLowerCase();
    const refLow = referrerHost.toLowerCase();
    let aiBot = null;
    if (refLow.includes('chat.openai') || ua.includes('chatgpt') || ua.includes('gptbot') || ua.includes('oai-searchbot')) {
      aiBot = 'chatgpt';
    } else if (refLow.includes('claude.ai') || ua.includes('anthropic-ai') || ua.includes('claude-web') || ua.includes('claudebot')) {
      aiBot = 'claude';
    } else if (refLow.includes('perplexity') || ua.includes('perplexitybot') || ua.includes('perplexity-user')) {
      aiBot = 'perplexity';
    } else if (refLow.includes('gemini.google') || refLow.includes('bard.google') || ua.includes('google-extended')) {
      aiBot = 'gemini';
    } else if (refLow.includes('bing.com/chat') || refLow.includes('copilot.microsoft') || ua.includes('copilot')) {
      aiBot = 'copilot';
    } else if (ua.includes('youbot') || ua.includes('ccbot') || refLow.includes('you.com')) {
      aiBot = 'other-ai';
    }

    // Per-session id so we can roughly count unique sessions in the digest
    let sid = sessionStorage.getItem('_pv_sid');
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('_pv_sid', sid);
    }

    const payload = {
      path: url.pathname,
      full_url: url.href.slice(0, 1000),
      referrer: referrer ? referrer.slice(0, 1000) : null,
      referrer_host: referrerHost || null,
      user_agent: (navigator.userAgent || '').slice(0, 500),
      ai_bot: aiBot,
      screen_w: window.screen ? window.screen.width : null,
      screen_h: window.screen ? window.screen.height : null,
      session_id: sid,
    };

    // Fire and forget — we don't want analytics to delay rendering or
    // surface errors to the user. Marking _pv_logged before await so a
    // failed network call still doesn't double-log on a retry.
    sessionStorage.setItem('_pv_logged', '1');
    supabase.from('page_visits').insert(payload).then(({ error }) => {
      if (error) {
        // Roll back the flag so a later retry can fire
        try { sessionStorage.removeItem('_pv_logged'); } catch (_) {}
        // Don't log to console in production; analytics errors are noise
      }
    }).catch(() => {
      try { sessionStorage.removeItem('_pv_logged'); } catch (_) {}
    });
  } catch (_) {
    // Swallow — tracking should never break the app
  }
})();
