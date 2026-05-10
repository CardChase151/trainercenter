#!/usr/bin/env python3
"""
Generates personalized vendor email drafts.

Uses the same visual shell (white card on light bg, red header) that the
existing send-vendor-email Edge Function uses, so these match the rest of
the TrainerCenter email family.

Action-first format: yellow ACTION REQUIRED box, big green CTA button,
numbered <ol> steps. Minimal copy. No wall-of-text.
"""

import os, html

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'drafts')
os.makedirs(OUT, exist_ok=True)

DASHBOARD = "https://pokemontrainercenter.com/vendors/dashboard"
PREV_EVENT = "https://pokemontrainercenter.com/vendor-day?event=b7cd1f94-a711-4aa4-baef-56139c1827e0"
NEXT_EVENT = "https://pokemontrainercenter.com/vendor-day?event=50a4d8b5-3596-4df6-988c-6e58dde6b3ac"

# applied_29 = True means vendor has already applied for the May 29 event
# (we skip the "please apply" block in their email). Pulled from
# vendor_applications WHERE event_id = '50a4d8b5-3596-4df6-988c-6e58dde6b3ac'.
VENDORS = [
    # Group A: missing both
    {"first": "David",   "last": "Carrillo",        "email": "dc39050@gmail.com",         "group": "A", "applied_29": False},
    {"first": "Jordan",  "last": "Fonte-casillas",  "email": "jordanfcasillas@gmail.com", "group": "A", "applied_29": False},
    {"first": "Mikey",   "last": "Ng",              "email": "khoinhok2k9@gmail.com",     "group": "A", "applied_29": False},
    {"first": "Peter",   "last": "Phan",            "email": "khoiphan92@gmail.com",      "group": "A", "applied_29": False},

    # Group B: has social, needs logo
    {"first": "Adria",   "last": "Sanchez",         "email": "adriansanchez20132014@gmail.com", "group": "B", "applied_29": False},
    {"first": "Alberto", "last": "Hernandez",       "email": "alberthdz15@yahoo.com",     "group": "B", "applied_29": False},
    {"first": "Alex",    "last": "Castro",          "email": "alexcastro15348@yahoo.com", "group": "B", "applied_29": False},
    {"first": "Andrew",  "last": "Vazquez",         "email": "andrewdavidvazquez@gmail.com", "group": "B", "applied_29": False},
    {"first": "Anthony", "last": "Nguyen",          "email": "an943035@gmail.com",        "group": "B", "applied_29": False},
    {"first": "Danny",   "last": "Lu",              "email": "dannyqlulu@gmail.com",      "group": "B", "applied_29": False},
    {"first": "Jeffrey", "last": "Tran",            "email": "seasideripz@gmail.com",     "group": "B", "applied_29": True},
    {"first": "Jordan",  "last": "Fonte-casillas",  "email": "jordanfcasillas@yahoo.com", "group": "B", "applied_29": False},
    {"first": "Julian",  "last": "Corcuera",        "email": "jcorcuera19@yahoo.com",     "group": "B", "applied_29": True},
    {"first": "Matthew", "last": "Muggia",          "email": "domenicomatthew@gmail.com", "group": "B", "applied_29": True},
    {"first": "Nicholas","last": "Ventura",         "email": "nickventura85@gmail.com",   "group": "B", "applied_29": False},
    {"first": "Richard", "last": "Marcelino",       "email": "rchrd.mrcln12@gmail.com",   "group": "B", "applied_29": True},

    # Group C: has logo, needs social
    {"first": "Caleb",   "last": "Aceves",          "email": "rio35brazil@gmail.com",     "group": "C", "applied_29": False},

    # Group D: has both — thanks
    {"first": "Chase",   "last": "Kellis",          "email": "chase@cardchase.org",       "group": "D", "applied_29": False},
    {"first": "Eduardo", "last": "Salgado Fuentes", "email": "eduardosal1402@gmail.com",  "group": "D", "applied_29": False},
    {"first": "Jonte",   "last": "Valentine",       "email": "oberreuterj@gmail.com",     "group": "D", "applied_29": False},
    {"first": "Joseph",  "last": "Foster",          "email": "foster9873@icloud.com",     "group": "D", "applied_29": False},
    {"first": "Joseph",  "last": "Stucken",         "email": "joestar2005@hotmail.com",   "group": "D", "applied_29": False},
    {"first": "Kaden",   "last": "Nguyen",          "email": "vipergq@gmail.com",         "group": "D", "applied_29": True},
    {"first": "Kellan",  "last": "Parker",          "email": "bwpark24@gmail.com",        "group": "D", "applied_29": True},
    {"first": "Limchop", "last": "TCG",             "email": "limchoptcg@gmail.com",      "group": "D", "applied_29": False},
    {"first": "Nathan",  "last": "Ramirez",         "email": "ngageramirez@gmail.com",    "group": "D", "applied_29": False},
    {"first": "Niko",    "last": "Maragos",         "email": "email4niko@gmail.com",      "group": "D", "applied_29": True},
    {"first": "Omar",    "last": "Garcia",          "email": "goingedc@gmail.com",        "group": "D", "applied_29": False},
    {"first": "Sean",    "last": "Frank",           "email": "sefrank91@gmail.com",       "group": "D", "applied_29": False},
    {"first": "Takuma",  "last": "Sato",            "email": "takumas3102@gmail.com",     "group": "D", "applied_29": True},
]

SUBJECTS = {
    "A": "Action required: add a logo + social to your vendor profile",
    "B": "Action required: add a logo to your vendor profile",
    "C": "Action required: add a social handle to your vendor profile",
    "D": "Your vendor profile is set — quick note on why we asked",
}


def wrap_html(inner_html, subject):
    """Matches the wrapHtml() shell in send-vendor-email/index.ts."""
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>{html.escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:28px 16px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.06)">
    <tr><td style="background:#C8102E;padding:20px 28px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:800;letter-spacing:-0.01em">Trainer Center HB</h1>
      <p style="margin:3px 0 0;color:#f5b3b9;font-size:11px;letter-spacing:0.04em">California's Pokemon-only shop</p>
    </td></tr>
    <tr><td style="padding:28px">{inner_html}</td></tr>
    <tr><td style="background:#fafafa;padding:14px 28px;text-align:center;border-top:1px solid #eee">
      <p style="font-size:11px;color:#999;margin:0;line-height:1.5">4911 Warner Ave #210 · Huntington Beach, CA 92649 · (714) 951-9100</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>
"""


def action_box(headline, sub):
    return f"""<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr><td style="background:#fef9e6;border-left:3px solid #d97706;padding:14px 18px;border-radius:4px">
  <p style="margin:0 0 4px;font-size:11px;font-weight:800;color:#92400e;letter-spacing:0.08em;text-transform:uppercase">Action required</p>
  <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#1a1a1a;line-height:1.35">{html.escape(headline)}</p>
  <p style="margin:0;color:#525252;font-size:13px;line-height:1.5">{html.escape(sub)}</p>
</td></tr></table>"""


def cta_button(text, url, color="#16a34a"):
    return f"""<p style="margin:22px 0;text-align:center"><a href="{url}" style="display:inline-block;background:{color};color:#fff;padding:11px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.01em">{html.escape(text)}  →</a></p>"""


def steps_block(steps):
    """Numbered steps as red circles + 'STEP N' label. Email-client safe via
    nested tables, fixed widths, and mso-line-height-rule for Outlook."""
    rows = []
    last = len(steps)
    for i, txt in enumerate(steps, 1):
        bottom_pad = "0" if i == last else "18px"
        rows.append(f"""<tr>
    <td width="48" valign="top" style="padding:0 14px {bottom_pad} 0;width:48px">
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:36px;height:36px;background:#C8102E;border-radius:18px"><tr>
        <td align="center" valign="middle" width="36" height="36" style="width:36px;height:36px;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:800;line-height:36px;text-align:center;mso-line-height-rule:exactly">{i}</td>
      </tr></table>
    </td>
    <td valign="top" style="padding:2px 0 {bottom_pad} 0">
      <p style="margin:0 0 2px;font-size:10px;font-weight:800;color:#C8102E;letter-spacing:0.08em;text-transform:uppercase">Step&nbsp;{i}</p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#1a1a1a">{txt}</p>
    </td>
  </tr>""")
    rows_html = '\n  '.join(rows)
    return f"""<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 22px">
  {rows_html}
</table>"""


def why_block(text):
    return f"""<table width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr><td style="background:#fbf3f4;border-left:3px solid #C8102E;padding:12px 16px;border-radius:4px">
  <p style="margin:0 0 4px;font-size:10px;font-weight:800;color:#C8102E;letter-spacing:0.08em;text-transform:uppercase">Why this matters</p>
  <p style="margin:0;color:#3a3a3a;font-size:13px;line-height:1.55">{text}</p>
</td></tr></table>"""


def lineup_links_block():
    return f"""<table width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-top:1px solid #eee;padding-top:16px"><tr><td>
  <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#888;letter-spacing:0.06em;text-transform:uppercase">Public lineup pages</p>
  <p style="margin:0;font-size:13px;line-height:1.7;color:#444">
    <a href="{PREV_EVENT}" style="color:#C8102E;font-weight:600;text-decoration:none">May 1 (last event)</a>
    &nbsp;·&nbsp;
    <a href="{NEXT_EVENT}" style="color:#C8102E;font-weight:600;text-decoration:none">May 29 (next event)</a>
  </p>
</td></tr></table>"""


def signoff():
    return """<p style="margin:22px 0 0;font-size:13px;color:#666">— Trainer Center HB</p>"""


def apply_29_block():
    """Soft 'please apply for May 29' nudge. Only included when applied_29 is False.
    Sits above the signoff. Casual tone, low pressure."""
    return f"""<table width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-top:1px solid #eee;padding-top:14px"><tr><td>
  <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#888;letter-spacing:0.06em;text-transform:uppercase">May 29 lineup</p>
  <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#525252">We're approving most vendors this week. If you want a spot for the 29th, apply from your dashboard. Either way, enjoy your week.</p>
  <p style="margin:0;font-size:13px"><a href="{DASHBOARD}" style="color:#C8102E;font-weight:600;text-decoration:none">Apply for May 29 →</a></p>
</td></tr></table>"""


# ─── Group A: needs both logo + social ───────────────────────────
def email_A(v):
    inner = f"""<p style="margin:0 0 16px;font-size:14px;color:#1a1a1a">Hi {html.escape(v['first'])},</p>

{action_box("Add 2 things to your vendor profile.", "We need a logo + at least one social handle (IG, TikTok, or Facebook) on file before May 29.")}

{cta_button("Open my dashboard", DASHBOARD)}

{steps_block([
    'Click the button above (or go to <strong>pokemontrainercenter.com/vendors/dashboard</strong>) and log in.',
    'Click <strong>Edit Profile</strong>.',
    'Upload your logo and add at least one social handle. Save.',
])}

<p style="margin:0 0 4px;font-size:13px;color:#666">Takes about 2 minutes.</p>

{why_block("Your logo + social show up on the public Vendor Day lineup so collectors can find and follow you. Vendors with both on file get bumped up in approval order for upcoming events.")}

{lineup_links_block()}

{apply_29_block() if not v.get('applied_29') else ''}

{signoff()}"""
    return wrap_html(inner, SUBJECTS["A"])


# ─── Group B: needs logo (has social) ─────────────────────────────
def email_B(v):
    inner = f"""<p style="margin:0 0 16px;font-size:14px;color:#1a1a1a">Hi {html.escape(v['first'])},</p>

{action_box("Add a logo to your vendor profile.", "We've got your social handle on file — appreciate that. Just need a logo or profile photo before May 29.")}

{cta_button("Open my dashboard", DASHBOARD)}

{steps_block([
    'Click the button above (or go to <strong>pokemontrainercenter.com/vendors/dashboard</strong>) and log in.',
    'Click <strong>Edit Profile</strong>.',
    'Upload a logo or profile photo (square aspect ratio looks best). Save.',
])}

<p style="margin:0 0 4px;font-size:13px;color:#666">Takes about 1 minute.</p>

{why_block("Your logo shows on the public Vendor Day lineup. Without one, your card uses a placeholder, which doesn't help collectors remember you. Vendors with logo + social on file get bumped up in approval order.")}

{lineup_links_block()}

{apply_29_block() if not v.get('applied_29') else ''}

{signoff()}"""
    return wrap_html(inner, SUBJECTS["B"])


# ─── Group C: needs social (has logo) ─────────────────────────────
def email_C(v):
    inner = f"""<p style="margin:0 0 16px;font-size:14px;color:#1a1a1a">Hi {html.escape(v['first'])},</p>

{action_box("Add at least one social handle.", "Your logo is on file (looks great). We just need at least one social handle — IG, TikTok, or Facebook — before May 29.")}

{cta_button("Open my dashboard", DASHBOARD)}

{steps_block([
    'Click the button above (or go to <strong>pokemontrainercenter.com/vendors/dashboard</strong>) and log in.',
    'Click <strong>Edit Profile</strong>.',
    'Add at least one social handle (Instagram, TikTok, or Facebook). Save.',
])}

<p style="margin:0 0 4px;font-size:13px;color:#666">Takes 30 seconds.</p>

{why_block("Your social handle becomes a clickable follow link on the public Vendor Day lineup. That's how collectors stay connected with you between events. Vendors with logo + social on file get bumped up in approval order.")}

{lineup_links_block()}

{apply_29_block() if not v.get('applied_29') else ''}

{signoff()}"""
    return wrap_html(inner, SUBJECTS["C"])


# ─── Group D: has both — thank-you ────────────────────────────────
def email_D(v):
    inner = f"""<p style="margin:0 0 16px;font-size:15px;color:#1a1a1a">Hi {html.escape(v['first'])},</p>

<p style="margin:0 0 14px;font-size:14px;color:#1a1a1a">Quick note: <strong>your vendor profile is dialed in.</strong> Logo + social on file. Thank you.</p>

<p style="margin:0 0 14px;font-size:14px;color:#1a1a1a">Wanted to explain <strong>why we asked everyone to add those</strong> — it's a one-time ask that does more for you than it might seem:</p>

<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 22px">
  <tr>
    <td width="22" valign="top" style="padding:0 10px 10px 0;width:22px;color:#C8102E;font-size:14px;font-weight:800;line-height:1.5">1.</td>
    <td valign="top" style="padding:0 0 10px 0;font-size:14px;line-height:1.5;color:#1a1a1a">Your logo and name show up on the public Vendor Day lineup page.</td>
  </tr>
  <tr>
    <td width="22" valign="top" style="padding:0 10px 10px 0;width:22px;color:#C8102E;font-size:14px;font-weight:800;line-height:1.5">2.</td>
    <td valign="top" style="padding:0 0 10px 0;font-size:14px;line-height:1.5;color:#1a1a1a">Your social handle becomes a clickable follow link for every collector who visits.</td>
  </tr>
  <tr>
    <td width="22" valign="top" style="padding:0 10px 0 0;width:22px;color:#C8102E;font-size:14px;font-weight:800;line-height:1.5">3.</td>
    <td valign="top" style="padding:0;font-size:14px;line-height:1.5;color:#1a1a1a">The page is shareable — post it on your own IG/TikTok and tag yourself.</td>
  </tr>
</table>

{cta_button("View May 29 lineup", NEXT_EVENT, color="#C8102E")}

<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;border-top:1px solid #eee;padding-top:14px"><tr><td>
  <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#888;letter-spacing:0.06em;text-transform:uppercase">Reference</p>
  <p style="margin:0;font-size:13px"><a href="{PREV_EVENT}" style="color:#C8102E;font-weight:600;text-decoration:none">May 1 lineup (last event)</a></p>
</td></tr></table>

<p style="margin:22px 0 0;font-size:13px;line-height:1.55;color:#525252">If you want to share the May 29 link on your story to drive more eyes to the event, that's the kind of cross-promotion that helps everyone. See you on the 29th.</p>

{apply_29_block() if not v.get('applied_29') else ''}

{signoff()}"""
    return wrap_html(inner, SUBJECTS["D"])


GENERATORS = {"A": email_A, "B": email_B, "C": email_C, "D": email_D}


def main():
    counts = {"A": 0, "B": 0, "C": 0, "D": 0}
    manifest = []

    for v in VENDORS:
        group = v["group"]
        gen = GENERATORS[group]
        body = gen(v)

        group_dir = os.path.join(OUT, f"group-{group}")
        os.makedirs(group_dir, exist_ok=True)

        slug = f"{v['first']}-{v['last']}".lower().replace(' ', '-').replace('--', '-')
        path = os.path.join(group_dir, f"{slug}.html")
        with open(path, 'w') as f:
            f.write(body)

        counts[group] += 1
        manifest.append({
            'group': group,
            'name': f"{v['first']} {v['last']}",
            'email': v['email'],
            'subject': SUBJECTS[group],
            'file': os.path.relpath(path, OUT),
        })

    with open(os.path.join(OUT, 'manifest.md'), 'w') as f:
        f.write("# Vendor Email Drafts — Manifest\n\n")
        f.write(f"Generated {sum(counts.values())} drafts.\n\n")
        f.write(f"- Group A (needs both logo + social): **{counts['A']}**\n")
        f.write(f"- Group B (needs logo, has social): **{counts['B']}**\n")
        f.write(f"- Group C (needs social, has logo): **{counts['C']}**\n")
        f.write(f"- Group D (has both, thank-you): **{counts['D']}**\n\n")
        f.write("## Drafts\n\n")
        f.write("| Group | Name | Email | Subject | File |\n")
        f.write("|---|---|---|---|---|\n")
        for m in manifest:
            f.write(f"| {m['group']} | {m['name']} | {m['email']} | {m['subject']} | `{m['file']}` |\n")

    print(f"✓ Generated {sum(counts.values())} drafts")
    print(f"  Group A: {counts['A']}  Group B: {counts['B']}  Group C: {counts['C']}  Group D: {counts['D']}")


if __name__ == "__main__":
    main()
