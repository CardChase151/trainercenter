"""Day-of email for the 09.25.2026 Beach City Trade Night.

Pulls recipients live from marketing_contacts so anyone who unsubscribed after
the "This Friday" blast is skipped. DRAFT until Chase says go.
    (no flag)   print the plain-text version
    --to-chase  send one review copy to Chase
    --send      deliver to the list
"""
import os, sys, json, subprocess, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.expanduser('~/Apps/trainercenter/.env')
env = {}
for line in open(ENV):
    if '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1); env[k.strip()] = v.strip().strip('"').strip("'")
KEY = env['RESEND_API_KEY']
SUPA_URL = env['REACT_APP_SUPABASE_URL']
SUPA_KEY = env['REACT_APP_SUPABASE_ANON_KEY']

FROM = '"Trainer Center HB" <noreply@mysendz.com>'
SUBJECT = 'Thirty years, tonight'
CAMPAIGN = 'event-2026-09-25-dayof'
BASE = 'https://pokemontrainercenter.com'
UNSUB = BASE + '/unsubscribe?token={token}'
IG_POST = 'https://www.instagram.com/p/Ddp6cRTFolV/'
IG = '<a href="https://instagram.com/trainercenter.pokemon" style="color:#C8102E;font-weight:700">@trainercenter.pokemon</a>'
P = 'font-size:16px;color:#333;line-height:1.6;margin:0 0 16px'


def recipients():
    """The 09.25 blast list minus anyone who has unsubscribed since.

    marketing_contacts is not readable with the anon key, so the list itself
    comes from the file built for the "This Friday" send and the opt-outs are
    kept beside it. Refresh tonight_blast_optouts.json from
    `select lower(email) from marketing_contacts where is_subscribed = false`
    before sending, so nobody who has opted out in the meantime gets this.
    """
    rec = json.load(open(os.path.join(HERE, 'friday_blast_recipients.json')))
    out = {e.strip().lower() for e in
           json.load(open(os.path.join(HERE, 'tonight_blast_optouts.json')))}
    return [r for r in rec if (r.get('email') or '').strip().lower() not in out]


def page(inner, unsub):
    return ('<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f9;'
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\">"
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px"><tr><td align="center">'
      '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">'
      '<tr><td style="background:#C8102E;padding:22px 32px;text-align:center">'
      '<h1 style="margin:0;color:#fff;font-size:20px;font-weight:800">Trainer Center HB</h1>'
      '<p style="margin:4px 0 0;color:#fbb;font-size:12px">California\'s Pokemon-only shop</p></td></tr>'
      '<tr><td style="padding:28px 28px 8px">' + inner + '</td></tr>'
      '<tr><td style="background:#f5f5f5;padding:18px 28px;text-align:center">'
      '<p style="font-size:11px;color:#888;margin:0 0 6px">4911 Warner Ave #210 &middot; Huntington Beach, CA 92649 &middot; (714) 951-9100</p>'
      f'<p style="font-size:11px;color:#888;margin:0"><a href="{unsub}" style="color:#888">Unsubscribe</a></p>'
      '</td></tr></table></td></tr></table></body></html>')


SCHEDULE = [
    ('5 PM', 'Doors open. Eight vendor tables set up and ready to trade.'),
    ('6 PM', 'Dragonite is here for photos. Bring the kids, bring your phone.'),
    ('6:30 PM', 'Pack battle number one. 30th Celebration packs, three battles at once.'),
    ('7:30 PM', 'Pack battle number two.'),
    ('8:30 PM', 'Pack battle number three.'),
    ('9:30 PM', 'Last pack battle of the night.'),
    ('All night', 'Scavenger hunt. Earn tickets, trade them for a free pack and a seat at a battle.'),
    ('10 PM', 'We close.'),
]

LOGO = f'{BASE}/email/2026-09-25/30th.png'


def html_for(unsub):
    rows = ''.join(
        '<tr>'
        f'<td style="padding:10px 14px 10px 0;vertical-align:top;white-space:nowrap;font-size:15px;font-weight:800;color:#C8102E">{t}</td>'
        f'<td style="padding:10px 0;vertical-align:top;font-size:15px;color:#333;line-height:1.55">{d}</td>'
        '</tr>' for t, d in SCHEDULE)

    band = (
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border-radius:12px;margin:0 0 24px">'
      '<tr><td style="padding:26px 24px 22px;text-align:center">'
      f'<img src="{LOGO}" alt="Pokemon 30th Celebration" width="300" '
      'style="display:block;width:100%;max-width:300px;height:auto;margin:0 auto 14px">'
      '<p style="margin:0;color:#f5c542;font-size:13px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase">'
      'Thirty years of Pokemon</p>'
      '<p style="margin:6px 0 0;color:#fff;font-size:15px;line-height:1.5">'
      'Tonight is how we are celebrating it</p>'
      '</td></tr></table>')

    return page(
      band +
      f'<p style="{P}"><strong style="font-size:18px">Tonight is the night.</strong> '
      'TC\'s Beach City Card Show at Trainer Center in Huntington Beach, 5 PM to 10 PM. '
      'Free to walk in, and free to play everything in it.</p>'
      f'<p style="{P}">Pokemon turned thirty this year. The games, the cards, the show, all of it started in 1996, '
      'and most of us in that room grew up somewhere along the way. Tonight is the 30th Celebration show, '
      'and the whole night is built around it.</p>'
      f'<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-top:1px solid #eee;border-bottom:1px solid #eee">{rows}</table>'
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e1;border-left:4px solid #f5c542;border-radius:8px;margin:0 0 20px">'
      '<tr><td style="padding:18px 20px">'
      '<p style="margin:0 0 8px;font-size:13px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#8a6d00">'
      'The pack battles</p>'
      '<p style="margin:0;font-size:15px;color:#333;line-height:1.6">'
      'Every battle opens 30th Celebration product. Four start times, three battles going at each one, '
      'so there are seats all night. A seat costs nothing. Play the scavenger hunt, earn a ticket, '
      'trade the ticket for a free pack and a spot at the table.</p>'
      '</td></tr></table>'
      f'<p style="{P}"><strong>Bring your binders.</strong> Eight tables in one room means you can '
      'walk the whole floor, compare what everyone is asking, and buy at a price you feel good about. '
      'Our vendors price their cards to move and they will tell you how they got to the number. '
      'That is the whole point of the night.</p>'
      f'<p style="margin:8px 0 22px;text-align:center"><a href="{IG_POST}" style="display:inline-block;background:#C8102E;color:#fff;'
      'text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:800;font-size:15px">See the whole night</a></p>'
      f'<p style="{P}">4911 Warner Ave #210, Huntington Beach. Questions, DM us at {IG} or call (714) 951-9100.</p>'
      f'<p style="{P}">Thirty years. Come celebrate it with us.<br>Chase</p>', unsub)


def text_for(unsub):
    lines = '\n'.join(f'{t} - {d}' for t, d in SCHEDULE)
    return f"""THIRTY YEARS OF POKEMON. Tonight is how we are celebrating it.

Tonight is the night. TC's Beach City Card Show at Trainer Center in Huntington
Beach, 5 PM to 10 PM. Free to walk in, and free to play everything in it.

Pokemon turned thirty this year. The games, the cards, the show, all of it
started in 1996, and most of us in that room grew up somewhere along the way.
Tonight is the 30th Celebration show, and the whole night is built around it.

{lines}

THE PACK BATTLES
Every battle opens 30th Celebration product. Four start times, three battles
going at each one, so there are seats all night. A seat costs nothing. Play the
scavenger hunt, earn a ticket, trade the ticket for a free pack and a spot at
the table.

Bring your binders. Eight tables in one room means you can walk the whole floor,
compare what everyone is asking, and buy at a price you feel good about. Our
vendors price their cards to move and they will tell you how they got to the
number. That is the whole point of the night.

See the whole night: {IG_POST}

4911 Warner Ave #210, Huntington Beach. Questions, DM us at
@trainercenter.pokemon or call (714) 951-9100.

Thirty years. Come celebrate it with us.
Chase

4911 Warner Ave #210, Huntington Beach, CA 92649 | (714) 951-9100
Unsubscribe: {unsub}
"""


def send(to, subject, html, text, unsub=None, campaign=None):
    # curl, not urllib: Resend sits behind Cloudflare and urllib's default
    # user agent gets a 403 (error 1010) before the API is ever reached.
    body = {'from': FROM, 'to': [to], 'subject': subject, 'html': html, 'text': text}
    if campaign:
        body['tags'] = [{'name': 'campaign', 'value': campaign}]
    if unsub:
        body['headers'] = {'List-Unsubscribe': f'<{unsub}>'}
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        f.write(json.dumps(body)); path = f.name
    out = subprocess.run(['curl', '-s', '-X', 'POST', 'https://api.resend.com/emails',
        '-H', f'Authorization: Bearer {KEY}', '-H', 'Content-Type: application/json',
        '--data-binary', f'@{path}'], capture_output=True, text=True).stdout
    os.unlink(path)
    try:
        return json.loads(out)
    except Exception:
        return {'error': out[:200]}


if '--send' in sys.argv:
    rec = recipients()
    logp = os.path.join(HERE, 'tonight_blast_sent.log')
    done = set(open(logp).read().split()) if os.path.exists(logp) else set()
    seen, ok, bad, skipped = set(), 0, 0, 0
    for r in rec:
        em = (r.get('email') or '').strip().lower()
        if not em or '@' not in em or em in seen or em in done:
            skipped += 1; continue
        seen.add(em)
        u = UNSUB.format(token=r['unsubscribe_token'])
        res = send(em, SUBJECT, html_for(u), text_for(u), unsub=u, campaign=CAMPAIGN)
        if res.get('id'):
            ok += 1
            open(logp, 'a').write(em + '\n')
        else:
            bad += 1; print('FAILED', em, res)
            if 'rate' in str(res).lower(): time.sleep(5)
        time.sleep(0.6)   # under Resend's 2 per second
    print('sent', ok, 'failed', bad, 'skipped', skipped)
elif '--to-chase' in sys.argv:
    u = UNSUB.format(token='REVIEW-COPY')
    n = len(recipients())
    banner = ('<div style="background:#fff3cd;border-bottom:3px solid #e08a00;padding:14px 20px;'
              "font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#7a4a00\">"
              f'<strong>REVIEW COPY, not sent to the list.</strong><br>Goes to {n} subscribed contacts.'
              f'<br>Subject: {SUBJECT}</div>')
    print(send('thek2way17@gmail.com', 'Review: Tonight email',
               banner + html_for(u), text_for(u), campaign='review-' + CAMPAIGN).get('id', 'no id'))
else:
    print('SUBJECT:', SUBJECT)
    print('RECIPIENTS:', len(recipients()), 'subscribed contacts')
    print('-' * 60)
    print(text_for(UNSUB.format(token='TOKEN')))
