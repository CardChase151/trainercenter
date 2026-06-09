"""Render the May 29 vendor call sheet PDF (white bg, red accents, black text)."""
from pathlib import Path

OUT_DIR = Path(__file__).parent
ROWS = [
    # (n, first_last, biz, ig, phone, invites, vote, inv_rank, vote_rank)
    (1,  'Adrian Gafar',          'Pokemasta710',                  'Pokemasta710',             '8402150134', 0,  1, 5, 6),
    (2,  'Adrian Sanchez',        '',                              'Lucardeal__',              '3238911972', 0,  1, 5, 6),
    (3,  'Alex Castro',           '',                              'crooksncastros',           '7148842818', 0,  2, 5, 5),
    (4,  'Alexander Palacios',    '@pokecreedcollection',          'Pokecreedcollection',      '2134699432', 2,  0, 3, 7),
    (5,  'Andrew Samaniego',      '',                              '',                         '7143251555', 0,  0, 5, 7),
    (6,  'Ashley Brimhall',       '',                              '',                         '7145859290', 0,  0, 5, 7),
    (7,  'Christian Alecio',      'Paws & Pulls TCG',              'Paws.n.Pulls',             '3238079799', 1,  0, 4, 7),
    (8,  'Cristoger Chica',       'Allsortsofshtuffcollectibles',  'cj_chica',                 '3236052146', 0,  2, 5, 5),
    (9,  'Erick Montes',          'Badnewsbears',                  'Badnewsbears collectibles','9498993800', 0,  0, 5, 7),
    (10, 'Fahim Mostafa',         '',                              'thatoneguyfahimcollects',  '7146034653', 0,  0, 5, 7),
    (11, 'George Roman',          '2 Broke Bros TCG',              '2brokebrostcg',            '7144998190', 0,  0, 5, 7),
    (12, 'Jeb Ferria',            '',                              'flying_Octopus_llc',       '4012529267', 0,  0, 5, 7),
    (13, 'Jeffrey Tran',          '',                              'seasidecollects',          '7146236149', 2,  2, 3, 5),
    (14, 'Jose Degante Sanchez',  'Qwarks_',                       'qwarks_',                  '6573199730', 0,  0, 5, 7),
    (15, 'Jose Rodriguez',        'TradingCardCollectionsx3',      'tradingcardcollectionsx3', '9516928780', 1,  0, 4, 7),
    (16, 'Jose Valentine',        'valentinewolftcg',              'valentinewolf_',           '3233993612', 0,  1, 5, 6),
    (17, 'Joseph Cervantes',      'OC.ORGANICS.TCG',               'OC.Organics.TCG',          '7146614310', 1,  0, 4, 7),
    (18, 'Joseph Foster',         '',                              'Mid_tcg.puller',           '9096365818', 0,  1, 5, 6),
    (19, 'Julian Corcuera',       '',                              'Julian Corcuera',          '7148819003', 1,  0, 4, 7),
    (20, 'Kaden Nguyen',          '',                              'ShreddedRipping',          '9499039169', 0,  2, 5, 5),
    (21, 'Karlos Ruiz',           'D&D Collectibles',              'Dyd_collectibles',         '6267088166', 0,  0, 5, 7),
    (22, 'Kellan Parker',         '',                              'kop_kollectibles',         '4843471575', 0,  0, 5, 7),
    (23, 'Logan Marin',           '',                              '',                         '7149163686', 0,  0, 5, 7),
    (24, 'Luther Hugh Brooks',    '',                              '',                         '',           0,  0, 5, 7),
    (25, 'Mark Kustera',          '',                              'markscomicbiz',            '7147251142', 0,  0, 5, 7),
    (26, 'Mark Sandoval',         '',                              'GengarAndSons',            '3239073413', 5,  8, 2, 2),
    (27, 'Matty',                 'Stache And Trade',              'stacheandtrade',           '7148138160', 0,  1, 5, 6),
    (28, 'Michael Brydges',       'Pokemonkies TCG',               'pokemonkiestcg',           '9092614547', 1,  1, 4, 6),
    (29, 'Miguel Mier',           'Squinty Eyed Bandit Cards',     'squintyeyedbanditcards',   '3107738165', 0,  0, 5, 7),
    (30, 'Nicholas Ventura',      '',                              'collectorsgoldoc',         '7146157609', 1,  1, 4, 6),
    (31, 'Nicholas Ruiz',         'Fluffymcgooglypoo',             'Fluffymcgooglypoo',        '7143377994', 0,  3, 5, 4),
    (32, 'Niko Maragos',          '',                              'vnrtcg',                   '7142636968', 2,  2, 3, 5),
    (33, 'Raul Oyola',            'Area151.Collectibles',          'Area151.Collectibles',     '9515955275', 1,  0, 4, 7),
    (34, 'Richard',               'Lana & Richard',                'lnr3dprints',              '6264744450', 0,  0, 5, 7),
    (35, 'Robert Rodriguez',      'Rodz Trading Post',             'RodzTradingPost',          '7144864291', 0,  0, 5, 7),
    (36, 'Robert Sanchez',        'Invader_RobsTCG',               'Invader_RobsTCG',          '5623281356', 0,  0, 5, 7),
    (37, 'Robert Vasquez',        'LemillionTCG',                  '',                         '9177732655', 0,  0, 5, 7),
    (38, 'Rogelio Mondragon',     'Dragoncards562',                'Dragoncards562',           '5625076381', 0,  0, 5, 7),
    (39, 'Siiah Batiste',         '',                              '',                         '2813520524', 0,  0, 5, 7),
    (40, 'Sydnee Bavouset',       'Lavendertowntradingco',         'lavendertowntradingco',    '7148624360', 0,  4, 5, 3),
    (41, 'Takuma Sato',           "Otaku's TCG",                   'otakustcg',                '3104692228', 14, 12, 1, 1),
]

MAX_INV_RANK = max(r[7] for r in ROWS)   # 5 → "last" in invites
MAX_VOTE_RANK = max(r[8] for r in ROWS)  # 7 → "last" in votes

def fmt_phone(p):
    if not p or len(p) != 10:
        return '—'
    return f'({p[0:3]}) {p[3:6]}-{p[6:10]}'

def fmt_ig(ig):
    if not ig: return '—'
    return '@' + ig.lstrip('@')

def rank_label(r, max_r):
    if r == max_r: return 'last'
    if r == 1: return '1st'
    if r == 2: return '2nd'
    if r == 3: return '3rd'
    return f'{r}th'

def rank_class(r):
    if r == 1: return 'gold'
    if r == 2: return 'silver'
    if r == 3: return 'bronze'
    return ''

rows_html = []
for n, name, biz, ig, phone, inv, vot, inv_r, vot_r in ROWS:
    biz_disp = biz if biz else '—'
    phone_disp = fmt_phone(phone)
    ig_disp = fmt_ig(ig)
    inv_rank_lbl = rank_label(inv_r, MAX_INV_RANK)
    vot_rank_lbl = rank_label(vot_r, MAX_VOTE_RANK)
    top_row_cls = ' top-row' if (inv_r == 1 or vot_r == 1) else ''
    rows_html.append(f'''
      <tr class="data{top_row_cls}">
        <td class="num">{n}</td>
        <td class="name">{name}</td>
        <td class="biz">{biz_disp}</td>
        <td class="ig">{ig_disp}</td>
        <td class="phone">{phone_disp}</td>
        <td class="stat"><span class="cnt">{inv}</span> <span class="rk {rank_class(inv_r)}">{inv_rank_lbl}</span></td>
        <td class="stat"><span class="cnt">{vot}</span> <span class="rk {rank_class(vot_r)}">{vot_rank_lbl}</span></td>
        <td class="notes"></td>
      </tr>''')

html = f'''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>May 29 Call Sheet</title>
<style>
  @page {{ size: Letter; margin: 0.3in 0.3in; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #000; background: #fff; font-size: 7pt; line-height: 1.15; }}

  h1 {{ font-size: 13pt; font-weight: 800; letter-spacing: -0.4pt; }}
  .sub {{ color: #555; font-size: 7.5pt; margin-bottom: 3pt; }}
  .header {{ display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2pt solid #000; padding-bottom: 3pt; margin-bottom: 3pt; }}
  .badge {{ background: #C8102E; color: #fff; padding: 2pt 7pt; border-radius: 2pt; font-size: 8pt; font-weight: 800; letter-spacing: 0.4pt; text-transform: uppercase; }}

  table {{ width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; table-layout: fixed; }}
  th {{ text-align: left; font-weight: 800; padding: 2pt 3pt; border-bottom: 1.25pt solid #000; font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.4pt; color: #000; }}
  td {{ padding: 1.8pt 3pt; border-bottom: 0.4pt solid #eee; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  td.num {{ width: 16pt; text-align: right; color: #888; font-weight: 700; font-size: 7pt; }}
  td.name {{ font-weight: 700; font-size: 7.8pt; }}
  td.biz {{ color: #555; font-size: 7pt; }}
  td.ig {{ color: #444; font-size: 7pt; font-weight: 600; }}
  td.phone {{ font-size: 7.5pt; font-weight: 600; white-space: nowrap; }}
  td.stat {{ white-space: nowrap; font-size: 7pt; }}
  td.stat .cnt {{ font-weight: 800; color: #000; display: inline-block; min-width: 14pt; }}
  td.stat .rk {{ color: #888; font-size: 6.5pt; text-transform: uppercase; letter-spacing: 0.3pt; }}
  td.stat .rk.gold {{ color: #C8102E; font-weight: 800; }}
  td.stat .rk.silver {{ color: #C8102E; font-weight: 700; }}
  td.stat .rk.bronze {{ color: #C8102E; font-weight: 700; }}
  td.notes {{ border-left: 0.4pt solid #ddd; }}
  tr.top-row td {{ background: #fff5f5; }}

  th.stat-h {{ text-align: left; }}

  .footer {{ margin-top: 5pt; font-size: 6.5pt; color: #888; text-align: center; }}

  /* Column widths */
  col.col-num   {{ width: 16pt; }}
  col.col-name  {{ width: 95pt; }}
  col.col-biz   {{ width: 115pt; }}
  col.col-ig    {{ width: 95pt; }}
  col.col-phone {{ width: 70pt; }}
  col.col-stat  {{ width: 60pt; }}
  col.col-notes {{ width: 80pt; }}
</style></head>
<body>

<div class="header">
  <div>
    <h1>May 29 — Vendor Call Sheet</h1>
    <div class="sub">Trainer Center HB · Beach City Trade Night · 41 approved · 38 check-ins · 44 votes</div>
  </div>
  <div><span class="badge">Call list</span></div>
</div>

<table>
  <colgroup>
    <col class="col-num"/>
    <col class="col-name"/>
    <col class="col-biz"/>
    <col class="col-ig"/>
    <col class="col-phone"/>
    <col class="col-stat"/>
    <col class="col-stat"/>
    <col class="col-notes"/>
  </colgroup>
  <thead>
    <tr>
      <th>#</th>
      <th>Name</th>
      <th>Business</th>
      <th>IG</th>
      <th>Phone</th>
      <th class="stat-h">Invites · Rank</th>
      <th class="stat-h">Likes · Rank</th>
      <th>Call Notes</th>
    </tr>
  </thead>
  <tbody>
    {''.join(rows_html)}
  </tbody>
</table>

<div class="footer">
  Ranks are dense (ties share a rank). "Last" = 0 invites/votes. Top performers (rank 1 either column) highlighted. Generated 2026-05-31.
</div>

</body></html>
'''

OUT_DIR.mkdir(parents=True, exist_ok=True)
(OUT_DIR / 'call-sheet.html').write_text(html)
print('wrote', OUT_DIR / 'call-sheet.html')
