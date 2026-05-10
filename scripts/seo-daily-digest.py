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


def render_email(latest_day, prev_day, week_avg, max_clicks_day, min_clicks_day, top_queries, top_pages, lookback_days):
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

    def cell(label, value, sub_html=''):
        return f'''<td valign="top" style="padding:14px 16px;border:1px solid #eee;border-radius:8px;background:#fafafa">
          <div style="font-size:10px;font-weight:800;color:#888;letter-spacing:0.08em;text-transform:uppercase">{label}</div>
          <div style="font-size:22px;font-weight:800;color:#1a1a1a;margin-top:2px;line-height:1.2">{value}</div>
          {sub_html}
        </td>'''

    def query_row(q):
        return f'''<tr>
          <td style="padding:6px 10px 6px 0;font-size:13px;color:#1a1a1a">{html.escape(q['keys'][0])[:55]}</td>
          <td align="right" style="padding:6px 0;font-size:13px;color:#1a1a1a;font-weight:700;width:60px">{int(q.get('clicks',0))}</td>
          <td align="right" style="padding:6px 0 6px 16px;font-size:12px;color:#888;width:80px">pos {q.get('position',0):.1f}</td>
        </tr>'''

    def page_row(p):
        url = p['keys'][0].replace('https://pokemontrainercenter.com', '') or '/'
        return f'''<tr>
          <td style="padding:6px 10px 6px 0;font-size:13px;color:#1a1a1a">{html.escape(url)[:60]}</td>
          <td align="right" style="padding:6px 0;font-size:13px;color:#1a1a1a;font-weight:700;width:60px">{int(p.get('clicks',0))}</td>
        </tr>'''

    queries_html = '\n'.join(query_row(q) for q in top_queries[:6]) or '<tr><td colspan="3" style="padding:6px 0;color:#888;font-size:13px">No queries with clicks yesterday</td></tr>'
    pages_html = '\n'.join(page_row(p) for p in top_pages[:5]) or '<tr><td colspan="2" style="padding:6px 0;color:#888;font-size:13px">No pages with clicks yesterday</td></tr>'

    high_label = 'New high!' if max_clicks_day == latest_day else f"{lookback_days}-day high: {int(max_clicks_day.get('clicks',0))}"
    low_label = f"{lookback_days}-day low: {int(min_clicks_day.get('clicks',0))}"

    dod_color = color_for_delta(cur_clicks, prev_clicks)
    avg_color = color_for_delta(cur_clicks, avg_clicks)

    return f'''<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Trainer Center HB — Daily SEO Digest</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:28px 16px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.06)">

    <tr><td style="background:#C8102E;padding:20px 28px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:800">Trainer Center HB · Daily SEO Digest</h1>
      <p style="margin:3px 0 0;color:#f5b3b9;font-size:11px;letter-spacing:0.04em">Most recent complete day: {date_str}</p>
    </td></tr>

    <tr><td style="padding:24px 28px">

      <!-- Hero stats -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
        {cell('Clicks', cur_clicks, f'<div style="font-size:11px;color:{dod_color};font-weight:700;margin-top:4px">{fmt_pct_delta(cur_clicks, prev_clicks)} day-over-day</div>')}
      </tr></table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
        {cell('Impressions', f'{cur_imp:,}', f'<div style="font-size:11px;color:{color_for_delta(cur_imp, prev_imp)};font-weight:700;margin-top:4px">{fmt_pct_delta(cur_imp, prev_imp)} DoD</div>')}
        <td style="width:14px"></td>
        {cell('CTR', f'{cur_ctr:.2f}%')}
        <td style="width:14px"></td>
        {cell('Avg pos', f'{cur_pos:.1f}')}
      </tr></table>

      <!-- Comparison table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-collapse:separate;border-spacing:0">
        <tr><td colspan="2" style="padding-bottom:8px;font-size:11px;font-weight:800;color:#888;letter-spacing:0.08em;text-transform:uppercase">How this day compares</td></tr>
        <tr><td style="padding:8px 10px;font-size:13px;color:#444;border-bottom:1px solid #eee">Day before</td><td align="right" style="padding:8px 0;font-size:13px;color:#1a1a1a;font-weight:700;border-bottom:1px solid #eee">{prev_clicks} clicks · {prev_imp:,} imp</td></tr>
        <tr><td style="padding:8px 10px;font-size:13px;color:#444;border-bottom:1px solid #eee">7-day average</td><td align="right" style="padding:8px 0;font-size:13px;color:{avg_color};font-weight:700;border-bottom:1px solid #eee">{avg_clicks:.1f} clicks · {avg_imp:,.0f} imp · {fmt_pct_delta(cur_clicks, avg_clicks)}</td></tr>
        <tr><td style="padding:8px 10px;font-size:13px;color:#444;border-bottom:1px solid #eee">{lookback_days}-day high</td><td align="right" style="padding:8px 0;font-size:13px;color:#1a1a1a;font-weight:700;border-bottom:1px solid #eee">{high_label}</td></tr>
        <tr><td style="padding:8px 10px;font-size:13px;color:#444">{lookback_days}-day low</td><td align="right" style="padding:8px 0;font-size:13px;color:#1a1a1a;font-weight:700">{low_label}</td></tr>
      </table>

      <!-- Top queries -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0">
        <tr><td colspan="3" style="padding-bottom:6px;font-size:11px;font-weight:800;color:#888;letter-spacing:0.08em;text-transform:uppercase">Top queries that day</td></tr>
        {queries_html}
      </table>

      <!-- Top pages -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0">
        <tr><td colspan="2" style="padding-bottom:6px;font-size:11px;font-weight:800;color:#888;letter-spacing:0.08em;text-transform:uppercase">Top pages that day</td></tr>
        {pages_html}
      </table>

      <!-- Footer link -->
      <p style="margin:28px 0 0;text-align:center"><a href="https://search.google.com/search-console?resource_id={urllib.parse.quote(SITE, safe='')}" style="font-size:13px;color:#C8102E;font-weight:600;text-decoration:none">Open in Search Console →</a></p>

    </td></tr>

    <tr><td style="background:#fafafa;padding:14px 28px;text-align:center;border-top:1px solid #eee">
      <p style="font-size:11px;color:#999;margin:0;line-height:1.5">Auto-sent at 8 AM Pacific via GitHub Actions. Data is from Google Search Console with its standard 2-3 day lag.</p>
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

    cur_clicks = int(latest_day.get('clicks', 0))
    prev_clicks = int(prev_day.get('clicks', 0)) if prev_day else 0
    delta_label = fmt_pct_delta(cur_clicks, prev_clicks).replace('▲ ', '+').replace('▼ ', '')
    date_short = latest_date.strftime('%a %b %-d')
    subject = f'TC HB · {date_short}: {cur_clicks} clicks ({delta_label} DoD)'

    body = render_email(latest_day, prev_day, week_avg, max_clicks_day, min_clicks_day, top_queries, top_pages, lookback_days)

    send_email(resend_key, args.to, subject, body, dry_run=args.dry_run)
    if not args.dry_run:
        print(f'Sent digest for {latest_date} to {args.to}')


if __name__ == '__main__':
    main()
