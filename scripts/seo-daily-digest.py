#!/usr/bin/env python3
"""
Daily GSC digest for pokemontrainercenter.com.

Pulls last ~31 days of search analytics, picks the most recent complete day
(GSC has a 2-3 day data lag), and emails a digest comparing that day to:
  - the previous day
  - the trailing 7-day average (excluding the most recent day to avoid lag bias)
  - the 28-day high and low

Wired to run from GitHub Actions on a daily cron. Requires two env vars:
  GSC_SERVICE_ACCOUNT_JSON  — full JSON content of the service account key
                              (the one with GSC Owner access; same key as
                              ~/Apps/me/keys/gsc-service-account.json locally)
  RESEND_API_KEY            — Resend API key for the trainercenter Resend account
                              (mysendz.com verified)

Usage:
  python3 seo-daily-digest.py             # send live
  python3 seo-daily-digest.py --dry-run   # print HTML + summary, don't send
  python3 seo-daily-digest.py --to other@example.com   # override recipient
"""

import os, sys, json, datetime, urllib.request, urllib.parse, urllib.error, argparse, html

SITE = 'https://pokemontrainercenter.com/'
RECIPIENT = 'thek2way17@gmail.com'
FROM_ADDRESS = 'Trainer Center HB SEO <noreply@mysendz.com>'

# Supabase project for first-party visit tracking. Reads from page_visits
# via service_role so we can break down traffic by source (Google, IG, AI,
# direct) alongside the GSC-only Google search numbers above.
SUPABASE_URL = 'https://tfneuzbhiqsdvnhhdfsw.supabase.co'

# ─── GSC data fetch ──────────────────────────────────────────────────────────


def gsc_query(token, dimensions, start_date, end_date, row_limit=1000, filters=None):
    body = {
        'startDate': start_date.isoformat(),
        'endDate': end_date.isoformat(),
        'dimensions': dimensions,
        'rowLimit': row_limit,
    }
    if filters:
        body['dimensionFilterGroups'] = [{'filters': filters}]
    url = f'https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(SITE, safe="")}/searchAnalytics/query'
    req = urllib.request.Request(
        url, method='POST',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'TrainerCenterHB-SEODigest/1.0',
        },
        data=json.dumps(body).encode('utf-8'),
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get_access_token(sa_json):
    """Exchanges a service account key for a GSC read access token."""
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_info(
        sa_json, scopes=['https://www.googleapis.com/auth/webmasters.readonly']
    )
    creds.refresh(Request())
    return creds.token


# ─── First-party visit attribution (Supabase page_visits) ────────────────────


def categorize_referrer(host, ai_bot):
    """Bucket a referrer hostname into a friendly source label."""
    if ai_bot:
        return {
            'chatgpt': 'ChatGPT',
            'claude': 'Claude',
            'perplexity': 'Perplexity',
            'gemini': 'Gemini',
            'copilot': 'Copilot',
            'grok': 'Grok',
            'other-ai': 'Other AI',
        }.get(ai_bot, ai_bot.title())
    if not host:
        return 'Direct'
    h = host.lower()
    # AI assistants — catch by host even when ai_bot column is null (backfill safety)
    if 'chatgpt.com' in h or 'chat.openai' in h or 'openai.com' in h:
        return 'ChatGPT'
    if 'claude.ai' in h or 'anthropic.com' in h:
        return 'Claude'
    if 'perplexity.ai' in h or 'perplexity.com' in h:
        return 'Perplexity'
    if 'gemini.google' in h or 'bard.google' in h or 'aistudio.google' in h:
        return 'Gemini'
    if 'copilot.microsoft' in h or 'copilot.cloud.microsoft' in h or 'bing.com/chat' in h:
        return 'Copilot'
    if 'grok.com' in h or 'x.ai' in h:
        return 'Grok'
    if 'you.com' in h:
        return 'You.com'
    # Search engines
    if 'google.' in h:
        return 'Google Search'
    if 'bing.com' in h or 'duckduckgo.com' in h:
        return 'Bing/DuckDuckGo'
    # Social
    if 'instagram.com' in h or 'l.instagram.com' in h or 'lm.facebook.com' in h:
        return 'Instagram'
    if 'tiktok.com' in h:
        return 'TikTok'
    if 'facebook.com' in h or 'fb.com' in h or 'm.facebook.com' in h:
        return 'Facebook'
    if 'twitter.com' in h or 't.co' in h or 'x.com' in h:
        return 'Twitter / X'
    if 'reddit.com' in h:
        return 'Reddit'
    if 'linkedin.com' in h or 'lnkd.in' in h:
        return 'LinkedIn'
    if 'youtube.com' in h or 'youtu.be' in h:
        return 'YouTube'
    if 'pokemontrainercenter.com' in h:
        return None  # internal nav — skip
    return host


def fetch_visit_sources(supabase_url, service_role_key, target_date):
    """Returns a list of (label, visits, unique_sessions) buckets sorted by visits."""
    if not service_role_key:
        return []
    # Pull yesterday's visits. We use service_role to bypass RLS read protection.
    start_iso = f"{target_date.isoformat()}T00:00:00Z"
    end_iso = f"{(target_date + datetime.timedelta(days=1)).isoformat()}T00:00:00Z"
    params = {
        'select': 'referrer_host,ai_bot,session_id',
        'created_at': f'gte.{start_iso}',
        'and': f'(created_at.lt.{end_iso})',
    }
    url = f"{supabase_url}/rest/v1/page_visits?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            'apikey': service_role_key,
            'Authorization': f'Bearer {service_role_key}',
            'Accept': 'application/json',
            'User-Agent': 'TrainerCenterHB-SEODigest/1.0',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            rows = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f'[page_visits] HTTP {e.code}: {e.read().decode()[:200]}')
        return []
    except Exception as e:
        print(f'[page_visits] {type(e).__name__}: {e}')
        return []

    buckets = {}
    for r in rows:
        label = categorize_referrer(r.get('referrer_host'), r.get('ai_bot'))
        if not label:
            continue
        if label not in buckets:
            buckets[label] = {'visits': 0, 'sessions': set()}
        buckets[label]['visits'] += 1
        sid = r.get('session_id')
        if sid:
            buckets[label]['sessions'].add(sid)

    out = [
        (label, b['visits'], len(b['sessions']))
        for label, b in buckets.items()
    ]
    out.sort(key=lambda x: x[1], reverse=True)
    return out


# ─── Analysis ────────────────────────────────────────────────────────────────


def find_most_recent_data_day(daily_rows):
    """Find the most recent day in `daily_rows` with non-zero clicks OR impressions.
    GSC has a 2-3 day lag so the calendar 'yesterday' often has zero/null data.
    """
    sorted_days = sorted(daily_rows, key=lambda r: r['keys'][0], reverse=True)
    for r in sorted_days:
        clicks = int(r.get('clicks', 0))
        imp = int(r.get('impressions', 0))
        if clicks > 0 or imp > 0:
            return r
    return None


def fmt_pct_delta(new, old):
    if old == 0 and new == 0:
        return '— flat'
    if old == 0:
        return '▲ new'
    pct = (new - old) / old * 100
    if pct > 0:
        return f'▲ +{pct:.0f}%'
    if pct < 0:
        return f'▼ {pct:.0f}%'
    return '— flat'


def color_for_delta(new, old):
    if new > old:
        return '#16a34a'   # green
    if new < old:
        return '#dc2626'   # red
    return '#666'           # neutral


# ─── Email rendering ────────────────────────────────────────────────────────


def render_sources_section(visit_sources, date_str):
    """Render the 'where visitors came from' block. Returns empty string if
    no data (e.g. tracking script hasn't deployed yet or no visits that day)."""
    if not visit_sources:
        return f'''<div style="margin:26px 0 0;padding:14px 16px;background:#f4f6f9;border-radius:6px">
          <div style="font-size:11px;font-weight:800;color:#888;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">🌐 Where visitors came from</div>
          <p style="margin:0;font-size:13px;color:#666;line-height:1.55">No first-party visit data for {html.escape(date_str)} yet. Either no visits, or the page-visit tracking is still gathering its first day of data. (This section will populate once the tracker is live.)</p>
        </div>'''

    total_visits = sum(v for _, v, _ in visit_sources)
    total_sessions = sum(s for _, _, s in visit_sources)

    # Source styling: AI tools get a purple bar/tag, Direct gets gray with
    # a clarifying note about Grok, search gets blue, social gets pink.
    AI_LABELS = {'ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Copilot', 'Grok', 'Other AI', 'You.com'}
    SEARCH_LABELS = {'Google Search', 'Bing/DuckDuckGo'}
    SOCIAL_LABELS = {'Instagram', 'TikTok', 'Facebook', 'Twitter / X', 'Reddit', 'LinkedIn', 'YouTube'}

    def style_for(label):
        if label in AI_LABELS:
            return {'tag': 'AI', 'tag_bg': '#ede9fe', 'tag_fg': '#6d28d9', 'bar': '#7c3aed'}
        if label in SEARCH_LABELS:
            return {'tag': 'Search', 'tag_bg': '#dbeafe', 'tag_fg': '#1d4ed8', 'bar': '#2563eb'}
        if label in SOCIAL_LABELS:
            return {'tag': 'Social', 'tag_bg': '#fce7f3', 'tag_fg': '#be185d', 'bar': '#db2777'}
        if label == 'Direct':
            return {'tag': 'Direct', 'tag_bg': '#f3f4f6', 'tag_fg': '#525252', 'bar': '#9ca3af'}
        # Unknown / unmatched referrer host
        return {'tag': 'Other', 'tag_bg': '#fef3c7', 'tag_fg': '#92400e', 'bar': '#d97706'}

    rows = []
    for label, visits, sessions in visit_sources[:10]:
        pct = (visits / total_visits * 100) if total_visits > 0 else 0
        ppl = '1 person' if sessions == 1 else f'{sessions} people'
        style = style_for(label)
        # Inline progress bar — uses a fixed-width table cell so it renders in email clients
        bar_width = max(int(pct), 2)  # min 2% so even tiny sources show a sliver
        note_html = ''
        if label == 'Direct':
            note_html = '<div style="font-size:11px;color:#888;margin-top:4px;font-style:italic">Typed URLs, bookmarks, Grok citations, and other referrer-stripped tools</div>'
        rows.append(f'''<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>
          <td style="padding:12px 14px;background:#fafafa;border-radius:6px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:14px;font-weight:700;color:#1a1a1a">
                <span style="display:inline-block;background:{style['tag_bg']};color:{style['tag_fg']};font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:4px;margin-right:8px;vertical-align:middle">{style['tag']}</span>
                {html.escape(label)}
              </td>
              <td align="right" style="font-size:14px;color:#1a1a1a;font-weight:800;white-space:nowrap">{visits} visit{"s" if visits != 1 else ""} · {pct:.0f}%</td>
            </tr></table>
            <!-- Progress bar -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>
              <td style="height:6px;background:#e5e7eb;border-radius:3px;line-height:0;font-size:0">
                <table width="{bar_width}%" cellpadding="0" cellspacing="0"><tr>
                  <td style="height:6px;background:{style['bar']};border-radius:3px;line-height:0;font-size:0">&nbsp;</td>
                </tr></table>
              </td>
            </tr></table>
            <div style="font-size:12px;color:#525252;margin-top:6px">{ppl}</div>
            {note_html}
          </td>
        </tr></table>''')

    return f'''<div style="margin:26px 0 0">
      <div style="font-size:11px;font-weight:800;color:#C8102E;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">🌐 Where visitors came from</div>
      <div style="font-size:13px;color:#666;margin-bottom:14px;line-height:1.5">
        <strong>{total_visits} total visit{"s" if total_visits != 1 else ""}</strong> from <strong>{total_sessions} unique session{"s" if total_sessions != 1 else ""}</strong> on {html.escape(date_str)}. Each row is the best guess at where that visit started.
      </div>
      {''.join(rows)}
    </div>'''



def render_email(latest_day, prev_day, week_avg, max_clicks_day, min_clicks_day, top_queries, top_pages, lookback_days, visit_sources=None):
    date_obj = datetime.date.fromisoformat(latest_day['keys'][0])
    date_str = date_obj.strftime('%A, %B %-d')
    cur_clicks = int(latest_day.get('clicks', 0))
    cur_imp = int(latest_day.get('impressions', 0))
    cur_ctr = latest_day.get('ctr', 0) * 100
    cur_pos = latest_day.get('position', 0)

    prev_clicks = int(prev_day.get('clicks', 0)) if prev_day else 0
    prev_imp = int(prev_day.get('impressions', 0)) if prev_day else 0

    avg_clicks = week_avg['clicks']
    avg_imp = week_avg['impressions']

    high_clicks = int(max_clicks_day.get('clicks', 0))
    low_clicks = int(min_clicks_day.get('clicks', 0))
    is_new_high = max_clicks_day == latest_day and cur_clicks > 0
    is_new_low = min_clicks_day == latest_day and cur_clicks == low_clicks

    # ─── Plain-English TL;DR ──────────────────────────────────
    if cur_clicks == 0 and cur_imp == 0:
        summary = f"On {date_str}, no one searched for or saw your site. Quiet day."
    elif cur_clicks == 0:
        summary = f"On {date_str}, your site showed up <strong>{cur_imp:,} times</strong> in Google search results, but no one clicked through. Common when ranking on page 2 or lower."
    else:
        people = "1 person" if cur_clicks == 1 else f"<strong>{cur_clicks} people</strong>"
        summary = f"On {date_str}, your site showed up <strong>{cur_imp:,} times</strong> in Google search results. {people} clicked through to visit. That's a <strong>{cur_ctr:.1f}%</strong> click-through rate, with your average ranking at position <strong>{cur_pos:.1f}</strong> across all the searches you appeared in."

    # Comparison sentence
    if prev_clicks == cur_clicks:
        compare_dod = f"Same as the day before ({prev_clicks} clicks)."
    elif cur_clicks > prev_clicks:
        diff = cur_clicks - prev_clicks
        compare_dod = f'<span style="color:#16a34a;font-weight:700">▲ Up {diff} click{"s" if diff != 1 else ""}</span> from the day before ({prev_clicks}).'
    else:
        diff = prev_clicks - cur_clicks
        compare_dod = f'<span style="color:#dc2626;font-weight:700">▼ Down {diff} click{"s" if diff != 1 else ""}</span> from the day before ({prev_clicks}).'

    if avg_clicks > 0:
        if cur_clicks > avg_clicks * 1.1:
            compare_avg = f'<span style="color:#16a34a;font-weight:700">Above</span> the trailing 7-day average of {avg_clicks:.1f} clicks/day.'
        elif cur_clicks < avg_clicks * 0.9:
            compare_avg = f'<span style="color:#dc2626;font-weight:700">Below</span> the trailing 7-day average of {avg_clicks:.1f} clicks/day.'
        else:
            compare_avg = f"Roughly in line with the trailing 7-day average of {avg_clicks:.1f} clicks/day."
    else:
        compare_avg = "No clicks at all in the trailing 7 days, so no average to compare to."

    if is_new_high and cur_clicks > 0:
        compare_range = f"<strong>🎉 New {lookback_days}-day high.</strong> Best day in the window."
    elif is_new_low:
        compare_range = f"Tied or matching the {lookback_days}-day low ({low_clicks} clicks)."
    else:
        compare_range = f'In the {lookback_days}-day window, the best day had <strong>{high_clicks}</strong> clicks and the worst had <strong>{low_clicks}</strong>.'

    # ─── Metric cards (single column, always stacked) ─────────
    def metric_block(label, value, plain_english, sublines=None):
        sublines_html = ''
        if sublines:
            for s in sublines:
                sublines_html += f'<div style="font-size:13px;color:#525252;line-height:1.55;margin-top:4px">{s}</div>'
        return f'''<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td style="padding:14px 18px;border:1px solid #eee;border-radius:8px;background:#fafafa">
          <div style="font-size:10px;font-weight:800;color:#888;letter-spacing:0.08em;text-transform:uppercase">{label}</div>
          <div style="font-size:28px;font-weight:800;color:#1a1a1a;margin-top:2px;line-height:1.1">{value}</div>
          <div style="font-size:12px;color:#666;margin-top:6px;line-height:1.5;font-style:italic">{plain_english}</div>
          {sublines_html}
        </td></tr></table>'''

    clicks_block = metric_block(
        'Clicks',
        cur_clicks,
        'People who clicked from Google to your site.',
        sublines=[compare_dod, compare_avg, compare_range],
    )
    imp_block = metric_block(
        'Impressions',
        f'{cur_imp:,}',
        'Times your site appeared in Google search results, even if no one clicked.',
        sublines=[
            f"Day before: {prev_imp:,} · 7-day avg: {avg_imp:,.0f}/day"
        ],
    )
    ctr_block = metric_block(
        'Click-through rate (CTR)',
        f'{cur_ctr:.2f}%',
        f'Of the {cur_imp:,} people who saw you in results, {cur_ctr:.1f}% clicked through. Anything above 3% is healthy for a local-business niche.',
    )
    pos_block = metric_block(
        'Average position',
        f'{cur_pos:.1f}',
        f'Your average rank across all searches you appeared in. 1 = top of page 1, 10 = bottom of page 1, 11+ = page 2 or beyond. {"You\'re ranking on page 1 — strong." if cur_pos <= 10 else "Most of your impressions are on page 2 or below — a likely growth area."}',
    )

    # ─── Top queries (single-column, plain rows) ──────────────
    def query_row(q):
        query_text = html.escape(q['keys'][0])
        clicks = int(q.get('clicks', 0))
        imps = int(q.get('impressions', 0))
        pos = q.get('position', 0)
        people = '1 person' if clicks == 1 else f'{clicks} people'
        if clicks > 0:
            line = f'{people} clicked · ranked <strong>#{pos:.0f}</strong> · seen {imps} times'
        else:
            line = f'Seen {imps} times · ranked <strong>#{pos:.0f}</strong> · no clicks'
        return f'''<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr><td style="padding:10px 14px;background:#fafafa;border-radius:6px;border-left:3px solid #C8102E">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;line-height:1.4">"{query_text}"</div>
          <div style="font-size:12px;color:#525252;margin-top:3px">{line}</div>
        </td></tr></table>'''

    queries_with_clicks = [q for q in top_queries if int(q.get('clicks', 0)) > 0][:5]
    if queries_with_clicks:
        queries_html = '\n'.join(query_row(q) for q in queries_with_clicks)
    elif top_queries:
        # No clicks, but show top impression queries so you can see what
        # Google is putting you in front of, even when no one clicks.
        queries_html = '<p style="margin:0 0 12px;font-size:12px;color:#888;font-style:italic">No clicks on any queries that day. Showing top impressions instead — these are searches you appeared in but no one clicked:</p>' + '\n'.join(query_row(q) for q in top_queries[:5])
    else:
        queries_html = '<p style="margin:0;font-size:13px;color:#888;font-style:italic">No queries logged that day.</p>'

    # ─── Top pages ────────────────────────────────────────────
    def page_row(p):
        url = p['keys'][0].replace('https://pokemontrainercenter.com', '') or '/'
        clicks = int(p.get('clicks', 0))
        imps = int(p.get('impressions', 0))
        people = '1 click' if clicks == 1 else f'{clicks} clicks'
        return f'''<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr><td style="padding:10px 14px;background:#fafafa;border-radius:6px">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;font-family:monospace">{html.escape(url)}</div>
          <div style="font-size:12px;color:#525252;margin-top:3px">{people} · seen {imps} times</div>
        </td></tr></table>'''

    pages_with_clicks = [p for p in top_pages if int(p.get('clicks', 0)) > 0][:5]
    if pages_with_clicks:
        pages_html = '\n'.join(page_row(p) for p in pages_with_clicks)
    else:
        pages_html = '<p style="margin:0;font-size:13px;color:#888;font-style:italic">No pages got clicks that day.</p>'

    # ─── Section helper ───────────────────────────────────────
    def section(title, sub, body):
        return f'''<div style="margin:26px 0 0">
          <div style="font-size:11px;font-weight:800;color:#C8102E;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px">{title}</div>
          <div style="font-size:13px;color:#666;margin-bottom:14px;line-height:1.5">{sub}</div>
          {body}
        </div>'''

    return f'''<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Trainer Center HB — Daily SEO Digest</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.06)">

    <tr><td style="background:#C8102E;padding:20px 24px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:800">Daily SEO Digest</h1>
      <p style="margin:3px 0 0;color:#f5b3b9;font-size:12px">Trainer Center HB · {date_str}</p>
    </td></tr>

    <tr><td style="padding:22px 24px">

      <!-- TL;DR plain-English summary -->
      <div style="padding:16px 18px;background:#fff7e6;border-left:3px solid #d97706;border-radius:6px;margin:0 0 22px">
        <div style="font-size:10px;font-weight:800;color:#92400e;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">In plain English</div>
        <p style="margin:0;font-size:14px;line-height:1.55;color:#1a1a1a">{summary}</p>
      </div>

      {clicks_block}
      {imp_block}
      {ctr_block}
      {pos_block}

      {render_sources_section(visit_sources, date_str)}

      {section(
        '🔍 What people searched to find you',
        f"The actual queries someone typed into Google on {date_str} that surfaced your site. Numbers below show how many of those searchers actually visited.",
        queries_html
      )}

      {section(
        '📄 Which pages got the visits',
        f"Where the {cur_clicks} click{'s' if cur_clicks != 1 else ''} on {date_str} landed.",
        pages_html
      )}

      <!-- Footer link -->
      <p style="margin:30px 0 0;text-align:center"><a href="https://search.google.com/search-console" style="font-size:13px;color:#C8102E;font-weight:700;text-decoration:none">Open Google Search Console →</a></p>

    </td></tr>

    <tr><td style="background:#fafafa;padding:14px 24px;text-align:center;border-top:1px solid #eee">
      <p style="font-size:11px;color:#999;margin:0;line-height:1.55">Auto-sent at 8 AM Pacific via GitHub Actions. Google Search Console data has a standard 2-3 day lag, so "{date_str}" is the most recent day with complete data.</p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>'''


# ─── Resend send ─────────────────────────────────────────────────────────────


def send_email(api_key, to_address, subject, html_body, dry_run=False):
    if dry_run:
        print('═══ DRY RUN ═══')
        print(f'To: {to_address}')
        print(f'Subject: {subject}')
        print(f'HTML: {len(html_body)} chars')
        return
    payload = {
        'from': FROM_ADDRESS,
        'to': [to_address],
        'subject': subject,
        'html': html_body,
    }
    req = urllib.request.Request(
        'https://api.resend.com/emails',
        method='POST',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'User-Agent': 'TrainerCenterHB-SEODigest/1.0',
        },
        data=json.dumps(payload).encode('utf-8'),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            print(f'Sent: {data.get("id", "ok")}')
    except urllib.error.HTTPError as e:
        print(f'❌ HTTP {e.code}: {e.read().decode()[:300]}')
        sys.exit(1)


# ─── Main ────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--to', default=RECIPIENT)
    args = parser.parse_args()

    sa_json_str = os.environ.get('GSC_SERVICE_ACCOUNT_JSON', '').strip()
    resend_key = os.environ.get('RESEND_API_KEY', '').strip()
    if not sa_json_str:
        # Allow local file fallback for dev/testing
        local_path = os.path.expanduser('~/Apps/me/keys/gsc-service-account.json')
        if os.path.isfile(local_path):
            with open(local_path) as f:
                sa_json_str = f.read()
    if not sa_json_str:
        print('ERROR: GSC_SERVICE_ACCOUNT_JSON not set'); sys.exit(1)
    if not resend_key and not args.dry_run:
        # Local .env fallback
        env_path = os.path.expanduser('~/Apps/trainercenter/.env')
        if os.path.isfile(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith('RESEND_API_KEY='):
                        resend_key = line.split('=', 1)[1].strip().strip('"').strip("'")
                        break
    if not resend_key and not args.dry_run:
        print('ERROR: RESEND_API_KEY not set'); sys.exit(1)

    sa_info = json.loads(sa_json_str)
    token = get_access_token(sa_info)

    # Pull last 31 days of daily data
    today = datetime.date.today()
    end = today
    start = today - datetime.timedelta(days=31)
    daily = gsc_query(token, ['date'], start, end, row_limit=1000).get('rows', [])

    if not daily:
        print('No GSC data returned. Exiting.'); sys.exit(0)

    latest_day = find_most_recent_data_day(daily)
    if not latest_day:
        print('No day with non-zero data found in last 31 days. Skipping email.'); sys.exit(0)

    latest_date = datetime.date.fromisoformat(latest_day['keys'][0])
    prev_date = latest_date - datetime.timedelta(days=1)
    prev_day = next((r for r in daily if r['keys'][0] == prev_date.isoformat()), None)

    # 7-day average — the 7 days BEFORE latest_date (excludes latest to avoid bias).
    seven_start = latest_date - datetime.timedelta(days=7)
    seven_days = [r for r in daily if seven_start.isoformat() <= r['keys'][0] < latest_date.isoformat()]
    if seven_days:
        week_avg = {
            'clicks': sum(int(r.get('clicks', 0)) for r in seven_days) / len(seven_days),
            'impressions': sum(int(r.get('impressions', 0)) for r in seven_days) / len(seven_days),
        }
    else:
        week_avg = {'clicks': 0, 'impressions': 0}

    # Lookback window for high/low. Use as much data as we have (up to 28 days).
    lookback_start = max(start, latest_date - datetime.timedelta(days=28))
    lookback_window = [r for r in daily if lookback_start.isoformat() <= r['keys'][0] <= latest_date.isoformat()]
    lookback_days = len(lookback_window)
    max_clicks_day = max(lookback_window, key=lambda r: int(r.get('clicks', 0)))
    min_clicks_day = min(lookback_window, key=lambda r: int(r.get('clicks', 0)))

    # Top queries + pages on latest_date only
    top_queries = gsc_query(token, ['query'], latest_date, latest_date, row_limit=10).get('rows', [])
    top_queries.sort(key=lambda r: int(r.get('clicks', 0)), reverse=True)
    top_pages = gsc_query(token, ['page'], latest_date, latest_date, row_limit=10).get('rows', [])
    top_pages.sort(key=lambda r: int(r.get('clicks', 0)), reverse=True)

    # First-party visit sources (Supabase page_visits). Reads SERVICE_ROLE key
    # from env (set as GitHub secret in the workflow). Optional — if missing,
    # the digest just skips the by-source section.
    service_role = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    visit_sources = fetch_visit_sources(SUPABASE_URL, service_role, latest_date)

    cur_clicks = int(latest_day.get('clicks', 0))
    prev_clicks = int(prev_day.get('clicks', 0)) if prev_day else 0
    delta_label = fmt_pct_delta(cur_clicks, prev_clicks).replace('▲ ', '+').replace('▼ ', '')
    date_short = latest_date.strftime('%a %b %-d')
    subject = f'TC HB · {date_short}: {cur_clicks} clicks ({delta_label} DoD)'

    body = render_email(latest_day, prev_day, week_avg, max_clicks_day, min_clicks_day, top_queries, top_pages, lookback_days, visit_sources)

    send_email(resend_key, args.to, subject, body, dry_run=args.dry_run)
    if not args.dry_run:
        print(f'Sent digest for {latest_date} to {args.to}')


if __name__ == '__main__':
    main()
