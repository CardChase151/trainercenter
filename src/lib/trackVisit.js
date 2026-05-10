// First-party page visit tracking. Logs every route view (not just initial
// arrival) to public.page_visits in Supabase, so we can answer:
//   - Where did the visit start? (referrer, AI source, social, direct)
//   - Which screens did they view most?
//   - How many pages per session?
//
// Privacy stance: no IP, no precise location, no cookies. Only referrer,
// user-agent, path, and a random per-session id (sessionStorage — cleared
// on tab close). The daily SEO digest reads this table.
//
// Usage:
//   import { logPageVisit } from './lib/trackVisit';
//   // The initial visit fires automatically on module import.
//   // On subsequent route changes (React Router), call:
//   useEffect(() => { logPageVisit(); }, [location.pathname]);

import { supabase } from '../supabaseClient';

// Detect AI source from referrer + UA. Kept in one place so the JS tracker
// and the Python digest stay in lockstep (digest has the same logic
// duplicated in scripts/seo-daily-digest.py for the historical-data case).
function detectAiBot(referrerHost, ua) {
  const refLow = (referrerHost || '').toLowerCase();
  const uaLow = (ua || '').toLowerCase();
  if (refLow.includes('chatgpt.com') || refLow.includes('chat.openai') || refLow.includes('openai.com') ||
      uaLow.includes('chatgpt') || uaLow.includes('gptbot') || uaLow.includes('oai-searchbot')) return 'chatgpt';
  if (refLow.includes('claude.ai') || refLow.includes('anthropic.com') ||
      uaLow.includes('anthropic-ai') || uaLow.includes('claude-web') || uaLow.includes('claudebot')) return 'claude';
  if (refLow.includes('perplexity.ai') || refLow.includes('perplexity.com') ||
      uaLow.includes('perplexitybot') || uaLow.includes('perplexity-user')) return 'perplexity';
  if (refLow.includes('gemini.google') || refLow.includes('bard.google') ||
      refLow.includes('aistudio.google') || uaLow.includes('google-extended')) return 'gemini';
  if (refLow.includes('bing.com/chat') || refLow.includes('copilot.microsoft') ||
      refLow.includes('copilot.cloud.microsoft') || uaLow.includes('copilot')) return 'copilot';
  if (refLow.includes('grok.com') || refLow.includes('x.ai') || uaLow.includes('grok')) return 'grok';
  if (refLow.includes('you.com') || uaLow.includes('youbot') || uaLow.includes('ccbot')) return 'other-ai';
  return null;
}

function getOrCreateSessionId() {
  if (typeof window === 'undefined') return null;
  let sid = sessionStorage.getItem('_pv_sid');
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('_pv_sid', sid);
  }
  return sid;
}

/**
 * Log a single page view. Called automatically on initial module import
 * (captures the entry referrer) and on every React Router location change
 * (captures every internal nav so we know which screens get viewed most).
 *
 * No-op outside the browser.
 */
export function logPageVisit() {
  if (typeof window === 'undefined') return;

  try {
    const url = new URL(window.location.href);
    const referrer = document.referrer || '';
    let referrerHost = '';
    try { if (referrer) referrerHost = new URL(referrer).hostname.toLowerCase(); } catch (_) {}

    // Internal navigations have a referrer pointing back at our own host.
    // We still want to log them so the most-viewed-pages stat works, but
    // we null out referrer_host so they don't pollute the "where they came
    // from" attribution.
    const ourHost = window.location.hostname.toLowerCase();
    const isInternal = referrerHost === ourHost;
    const effectiveReferrerHost = isInternal ? null : (referrerHost || null);

    const aiBot = detectAiBot(effectiveReferrerHost, navigator.userAgent);
    const sid = getOrCreateSessionId();

    const payload = {
      path: url.pathname,
      full_url: url.href.slice(0, 1000),
      referrer: !isInternal && referrer ? referrer.slice(0, 1000) : null,
      referrer_host: effectiveReferrerHost,
      user_agent: (navigator.userAgent || '').slice(0, 500),
      ai_bot: aiBot,
      screen_w: window.screen ? window.screen.width : null,
      screen_h: window.screen ? window.screen.height : null,
      session_id: sid,
    };

    supabase.from('page_visits').insert(payload).then(() => {}).catch(() => {});
  } catch (_) {
    // Swallow — tracking should never break the app
  }
}

// Fire once for the initial pageload (captures the source/referrer).
// Subsequent route changes need to call logPageVisit() from a router hook
// (see usePageViewTracker.js).
(function trackInitialLoad() {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem('_pv_first_logged')) return;
  sessionStorage.setItem('_pv_first_logged', '1');
  logPageVisit();
})();
