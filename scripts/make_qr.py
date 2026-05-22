#!/usr/bin/env python3
"""
Trainer Center HB - Pokeball QR Card Generator (macOS adapted)

Generates a branded QR with:
  - "Trainer Center HB" title (Center in red)
  - Red/black Pokeball-split QR matrix
  - TC logo dropped in the center
  - @trainercenter.pokemon handle row below
  - Red-over-black rounded frame

Adapted from the original prototype: macOS font auto-discovery,
hard-coded TC logo path, hard-coded Instagram URL.

Usage:
    python3 make_qr.py
    python3 make_qr.py --url <other-url> --out <path.png>
"""

import argparse
import os
import sys
from PIL import Image, ImageDraw, ImageFont
import qrcode
from qrcode.constants import ERROR_CORRECT_H


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LOGO = os.path.join(REPO_ROOT, 'public', 'logo-circle-transparent.png')
GOOGLE_G_LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'google_g.png')
DEFAULT_URL = 'https://instagram.com/trainercenter.pokemon'
# Real Google review short link, copied from
# ~/Apps/trainercenter/qr/google-review-url.md (Trainer Center Business
# Profile → Get more reviews → Share form).
DEFAULT_GOOGLE_URL = 'https://g.page/r/Ca6LST9JYXmREBM/review'
DEFAULT_OUT = os.path.expanduser('~/Downloads/trainercenter_qr_instagram.png')

BRAND_RED     = (200, 16, 46)    # TC brand red (#C8102E)
INK           = (26, 26, 26)
WHITE         = (255, 255, 255)
GOOGLE_BLUE   = (66, 133, 244)   # Google blue (#4285F4)
GOOGLE_RED    = (234, 67, 53)    # Google red (#EA4335)
GOOGLE_GREEN  = (52, 168, 83)    # Google green / Maps green (#34A853)
GOOGLE_YELLOW = (251, 188, 4)    # Google yellow / star yellow (#FBBC04)
YELP_RED      = (175, 6, 6)

# Style presets — each picks the top + bottom colors of the Pokeball,
# the accent for the middle title word, the handle text, and whether
# to show the IG camera glyph or a row of stars in the handle area.
STYLES = {
    'default': {
        'top': BRAND_RED, 'bottom': INK,
        'accent': BRAND_RED,
        'title': [('Trainer ', INK), ('Center ', BRAND_RED), ('HB', BRAND_RED)],
        'handle': '@trainercenter.pokemon',
        'show_ig_glyph': True, 'show_stars': False,
        'center': 'logo',   # 'logo' = paste TC logo file, 'google_g' = paste Google G png
    },
    'google': {
        'top': GOOGLE_BLUE, 'bottom': GOOGLE_GREEN,
        'accent': GOOGLE_BLUE,
        'title': [('Trainer ', INK), ('Center ', GOOGLE_BLUE), ('HB', GOOGLE_GREEN)],
        'handle': 'Review us on Google',
        'show_ig_glyph': False, 'show_stars': True,
        'center': 'google_g',
    },
    'yelp': {
        'top': BRAND_RED, 'bottom': YELP_RED,
        'accent': YELP_RED,
        'title': [('Trainer ', INK), ('Center ', YELP_RED), ('HB', YELP_RED)],
        'handle': 'Tap to review on Yelp',
        'show_ig_glyph': False, 'show_stars': False,
        'center': 'logo',
    },
}

MODULE_PX = 26
TITLE_SIZE = 132
HANDLE_SIZE = 62
# Center logo: bumped fraction + smaller safe ring. The logo image is
# autocropped (see build_qr) so internal transparent padding doesn't
# eat into the visible size — only the actual logo marks count.
LOGO_FRAC = 0.26
LOGO_PAD_FRAC = 0.008
# Module shape: 'dot' (circles) or 'square'. Circles give the QR a
# softer, rounder feel without removing any data — every module is
# still drawn, just with curved edges. Scans the same as the square
# version because contrast + position are preserved.
MODULE_SHAPE = 'dot'


# macOS font auto-discovery. Try common bold/medium fonts in priority order.
MAC_BOLD_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Verdana Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Avenir Next.ttc',
]
MAC_MED_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Avenir Next.ttc',
]


def first_existing(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    return None


def load_font(candidates, size):
    path = first_existing(candidates)
    if path:
        return ImageFont.truetype(path, size)
    # Last resort: PIL's default. Will look basic but won't crash.
    return ImageFont.load_default()


def draw_google_g(draw, cx, cy, radius):
    """Stylized Google "G" mark — 4 colored arcs forming a ring with a
    gap on the right, plus a blue horizontal crossbar filling the gap.
    Approximate (not the trademarked exact geometry) but reads as
    Google-G at a glance."""
    outer = radius
    inner = radius * 0.55  # ring thickness (smaller inner = thicker ring)
    bbox_outer = [cx - outer, cy - outer, cx + outer, cy + outer]
    bbox_inner = [cx - inner, cy - inner, cx + inner, cy + inner]

    # PIL pieslice angles: 0° = right (3 o'clock), going clockwise.
    # Quadrants:
    #   0-90   = bottom-right
    #   90-180 = bottom-left
    #   180-270 = top-left
    #   270-360 = top-right
    #
    # Google G has a gap on the right (around 3 o'clock). We leave
    # the angular range -8° to +8° empty, then fill four arcs.
    draw.pieslice(bbox_outer, 280, 352, fill=GOOGLE_RED)     # top-right -> red
    draw.pieslice(bbox_outer, 8,   84,  fill=GOOGLE_YELLOW)  # bottom-right -> yellow
    draw.pieslice(bbox_outer, 96,  172, fill=GOOGLE_GREEN)   # bottom-left -> green
    draw.pieslice(bbox_outer, 184, 276, fill=GOOGLE_BLUE)    # top-left + lower-left -> blue

    # Knock out the center so the colored ring stays just a ring.
    draw.ellipse(bbox_inner, fill=WHITE)

    # Horizontal blue crossbar (the G's tongue) from the right gap
    # toward the center.
    bar_h = (outer - inner) * 0.95
    bar_x1 = cx - inner * 0.05
    bar_x2 = cx + outer
    bar_y1 = cy - bar_h / 2
    bar_y2 = cy + bar_h / 2
    draw.rectangle([bar_x1, bar_y1, bar_x2, bar_y2], fill=GOOGLE_BLUE)


def build_qr(url, logo_path=None, top_color=BRAND_RED, bottom_color=INK, center='logo', force_version=None):
    qr = qrcode.QRCode(
        # force_version lets the sheet builder lock both QRs to the
        # same matrix size (e.g. version 5 = 37x37) regardless of how
        # short each URL is, so both rendered QRs occupy the same pixels.
        version=force_version,
        error_correction=ERROR_CORRECT_H,
        box_size=1,
        border=0,
    )
    qr.add_data(url)
    qr.make(fit=True)

    matrix = qr.get_matrix()
    n = len(matrix)
    qpx = n * MODULE_PX

    qimg = Image.new('RGB', (qpx, qpx), WHITE)
    draw = ImageDraw.Draw(qimg)

    # Full square QR — no clipping. Modules drawn as dots (circles)
    # rather than hard squares for a softer, more "Pokeball-y" feel.
    # Every data module is still present, so the QR scans reliably.
    split_row = n / 2.0
    pad = max(1, MODULE_PX // 14)  # tiny inset so adjacent dots don't visually merge into squares
    for r in range(n):
        for c in range(n):
            if not matrix[r][c]:
                continue
            color = top_color if (r + 0.5) < split_row else bottom_color
            x0 = c * MODULE_PX + pad
            y0 = r * MODULE_PX + pad
            x1 = (c + 1) * MODULE_PX - pad
            y1 = (r + 1) * MODULE_PX - pad
            if MODULE_SHAPE == 'dot':
                draw.ellipse([x0, y0, x1, y1], fill=color)
            else:
                draw.rectangle([x0, y0, x1, y1], fill=color)

    # Center logo (with padding ring so the scanner separates it from data).
    cx, cy = qpx / 2, qpx / 2
    logo_r = qpx * LOGO_FRAC / 2
    pad_r = logo_r + qpx * LOGO_PAD_FRAC
    draw.ellipse([cx - pad_r, cy - pad_r, cx + pad_r, cy + pad_r], fill=WHITE)

    # Pick the actual image to paste based on the requested center style.
    chosen_logo = None
    if center == 'google_g' and os.path.exists(GOOGLE_G_LOGO):
        chosen_logo = GOOGLE_G_LOGO
    elif center == 'google_g':
        # File missing — fall back to the programmatically-drawn G so
        # the script doesn't crash if someone moved it.
        draw_google_g(draw, cx, cy, logo_r)
    elif logo_path and os.path.exists(logo_path):
        chosen_logo = logo_path

    if chosen_logo:
        logo = Image.open(chosen_logo).convert('RGBA')
        # Autocrop transparent padding from the source PNG so what we
        # actually render is just the logo marks themselves.
        bbox = logo.getbbox()
        if bbox:
            logo = logo.crop(bbox)
        target = int(logo_r * 2)
        # Fit the logo to a square target so the circular mask clips
        # consistently regardless of source aspect ratio.
        square = Image.new('RGBA', (target, target), (255, 255, 255, 0))
        logo.thumbnail((target, target), Image.LANCZOS)
        square.paste(logo, ((target - logo.width) // 2, (target - logo.height) // 2), logo)
        # Circular alpha mask — clips the logo (and any source padding
        # that's transparent but eats real estate) into a clean circle.
        circle_mask = Image.new('L', (target, target), 0)
        ImageDraw.Draw(circle_mask).ellipse([0, 0, target - 1, target - 1], fill=255)
        from PIL import ImageChops
        combined_alpha = ImageChops.multiply(square.split()[3], circle_mask)
        square.putalpha(combined_alpha)
        lx = int(cx - target / 2)
        ly = int(cy - target / 2)
        qimg.paste(square, (lx, ly), square)
    elif center != 'google_g':
        # Fallback pokeball button — uses style's bottom_color for the body.
        btn_r = logo_r
        ring_r = logo_r * 0.52
        dot_r = logo_r * 0.26
        draw.ellipse([cx - btn_r, cy - btn_r, cx + btn_r, cy + btn_r], fill=bottom_color)
        draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], fill=WHITE)
        draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=bottom_color)

    return qimg, qpx


def frame_qr(qimg, qpx, top_color=BRAND_RED, bottom_color=INK):
    """Rounded-rectangle Pokeball frame: top_color top, bottom_color bottom."""
    qpad = 60
    qframe = 30
    radius = 70

    block_w = qpx + 2 * qpad + 2 * qframe
    block_h = qpx + 2 * qpad + 2 * qframe
    card = Image.new('RGB', (block_w, block_h), WHITE)
    d = ImageDraw.Draw(card)

    # Whole rounded frame in the top color first...
    d.rounded_rectangle([0, 0, block_w - 1, block_h - 1], radius=radius,
                        outline=top_color, width=qframe)

    # ...then overpaint ONLY the bottom half in bottom_color, masked to bottom.
    overlay = Image.new('RGBA', (block_w, block_h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([0, 0, block_w - 1, block_h - 1], radius=radius,
                         outline=bottom_color + (255,), width=qframe)
    half_mask = Image.new('L', (block_w, block_h), 0)
    hd = ImageDraw.Draw(half_mask)
    hd.rectangle([0, block_h // 2, block_w, block_h], fill=255)
    bottom_alpha = Image.composite(overlay.split()[3],
                                   Image.new('L', (block_w, block_h), 0),
                                   half_mask)
    card.paste(overlay, (0, 0), bottom_alpha)

    card.paste(qimg, ((block_w - qpx) // 2, (block_h - qpx) // 2))
    return card, block_w, block_h


def draw_star(draw, cx, cy, size, fill):
    """5-point star centered at (cx, cy), `size` = outer radius."""
    import math
    points = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        r = size if i % 2 == 0 else size * 0.45
        points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(points, fill=fill)


def build_card(url, logo_path, out_path=None, style_name='default',
               heading_override=None, hide_handle_text=False, return_image=False,
               force_version=None, force_footer_h=None):
    style = STYLES.get(style_name, STYLES['default'])
    top_color    = style['top']
    bottom_color = style['bottom']
    accent_color = style['accent']
    handle_text  = style['handle']
    show_ig_glyph = style.get('show_ig_glyph', False)
    show_stars    = style.get('show_stars', False)

    center = style.get('center', 'logo')
    qimg, qpx = build_qr(url, logo_path, top_color=top_color, bottom_color=bottom_color, center=center, force_version=force_version)
    qrcard, block_w, block_h = frame_qr(qimg, qpx, top_color=top_color, bottom_color=bottom_color)

    title_font = load_font(MAC_BOLD_CANDIDATES, TITLE_SIZE)
    handle_font = load_font(MAC_MED_CANDIDATES, HANDLE_SIZE)

    tmp = ImageDraw.Draw(Image.new('RGB', (10, 10)))

    def measure(text, font):
        b = tmp.textbbox((0, 0), text, font=font)
        return b[2] - b[0], b[3] - b[1], b[1]

    # heading_override (used by sheet rendering) wins over the style's
    # default title. Lets the sheet swap in "Follow Us on IG" instead
    # of "Trainer Center HB" since the shop branding is already on the
    # wall when the sheet is posted.
    title_parts = (heading_override
                   or style.get('title')
                   or [('Trainer ', INK), ('Center ', accent_color), ('HB', INK)])
    part_widths = [measure(t, title_font)[0] for t, _ in title_parts]
    title_total = sum(part_widths)
    title_h = max(measure(t, title_font)[1] for t, _ in title_parts)

    glyph = 68
    glyph_gap = 22
    hw, hh, _ = measure(handle_text, handle_font) if not hide_handle_text else (0, 0, 0)
    handle_glyph_w = (glyph + glyph_gap) if (show_ig_glyph and not hide_handle_text) else 0
    handle_row_w = handle_glyph_w + hw
    handle_row_h = max(glyph if show_ig_glyph else 0, hh) if not hide_handle_text else 0

    # Star row sizing — 5 stars, each ~78px tall, gap between them.
    star_outer = 48
    star_gap = 24
    stars_row_w = (5 * star_outer * 2) + (4 * star_gap)
    stars_row_h = star_outer * 2
    # Gap between stars and handle only matters when both rows exist.
    gap_stars_handle = 28 if not hide_handle_text else 0
    star_block_h = (stars_row_h + gap_stars_handle) if show_stars else 0

    # The footer area is the vertical chunk between the QR block and
    # the card's bottom margin. force_footer_h lets the sheet builder
    # lock both cards to the same footer height so the QR sits at the
    # same Y position and the cards read as identical layouts.
    natural_footer_h = star_block_h + handle_row_h
    footer_h = force_footer_h if force_footer_h is not None else natural_footer_h

    side_margin = 90
    top_margin = 115
    gap_title_qr = 80
    gap_qr_handle = 70
    bottom_margin = 95

    content_w = max(title_total, block_w, handle_row_w, stars_row_w if show_stars else 0)
    canvas_w = content_w + 2 * side_margin
    canvas_h = (top_margin + title_h + gap_title_qr + block_h
                + gap_qr_handle + footer_h + bottom_margin)

    card = Image.new('RGB', (canvas_w, canvas_h), WHITE)
    draw = ImageDraw.Draw(card)

    # Subtle outer sticker edge.
    draw.rounded_rectangle([16, 16, canvas_w - 16, canvas_h - 16],
                           radius=80, outline=(232, 232, 232), width=6)

    # Title (three colored segments side by side, centered).
    y = top_margin
    x = (canvas_w - title_total) // 2
    for (text, color), w in zip(title_parts, part_widths):
        bb = draw.textbbox((0, 0), text, font=title_font)
        draw.text((x, y - bb[1]), text, font=title_font, fill=color)
        x += w

    # Framed QR.
    y2 = top_margin + title_h + gap_title_qr
    card.paste(qrcard, ((canvas_w - block_w) // 2, y2))

    # Footer area starts after the QR block. Center the natural content
    # vertically inside the (possibly forced-larger) footer_h slot so
    # IG and Google line up structurally on the sheet.
    y_after_qr = y2 + block_h + gap_qr_handle
    footer_pad_top = (footer_h - natural_footer_h) // 2 if footer_h > natural_footer_h else 0
    y_after_qr += footer_pad_top

    # Optional star row (Google style) — 5 yellow filled stars.
    if show_stars:
        sx = (canvas_w - stars_row_w) // 2
        sy = y_after_qr + stars_row_h // 2
        for i in range(5):
            cx_star = sx + star_outer + i * (star_outer * 2 + star_gap)
            draw_star(draw, cx_star, sy, star_outer, GOOGLE_YELLOW)
        y3 = y_after_qr + stars_row_h + gap_stars_handle
    else:
        y3 = y_after_qr

    # Handle row. IG style gets the camera glyph + @handle. Other styles
    # (google, yelp) get just the call-to-action text. hide_handle_text
    # (used by the Google sheet variant) skips this row entirely so
    # the stars are the final element.
    if not hide_handle_text:
        hx = (canvas_w - handle_row_w) // 2
        if show_ig_glyph:
            gy = y3 + (max(glyph, hh) - glyph) // 2
            draw.rounded_rectangle([hx, gy, hx + glyph, gy + glyph], radius=20, outline=INK, width=7)
            gcx, gcy = hx + glyph / 2, gy + glyph / 2
            lens = glyph * 0.27
            draw.ellipse([gcx - lens, gcy - lens, gcx + lens, gcy + lens], outline=INK, width=7)
            dot = glyph * 0.075
            ddx, ddy = hx + glyph - 18, gy + 18
            draw.ellipse([ddx - dot, ddy - dot, ddx + dot, ddy + dot], fill=INK)
            text_x = hx + glyph + glyph_gap
        else:
            text_x = hx
        tb = draw.textbbox((0, 0), handle_text, font=handle_font)
        ty = y3 + (max(glyph, hh) - hh) // 2 - tb[1]
        draw.text((text_x, ty), handle_text, font=handle_font, fill=INK)

    if return_image:
        return card
    card.save(out_path, dpi=(300, 300))
    print(f'Saved -> {out_path}  ({card.size[0]}x{card.size[1]} px)')


def build_bare_qr(url, logo_path, out_path, style_name='default'):
    """Just the colored Pokeball-styled QR matrix + center logo. No
    title, no surrounding card frame, no footer — for use cases where
    the printable just needs the code itself."""
    style = STYLES.get(style_name, STYLES['default'])
    top_color = style['top']
    bottom_color = style['bottom']
    center = style.get('center', 'logo')
    qimg, qpx = build_qr(
        url, logo_path,
        top_color=top_color, bottom_color=bottom_color, center=center,
    )
    qimg.save(out_path, dpi=(300, 300))
    print(f'Saved -> {out_path}  ({qpx}x{qpx} px, bare QR)')


def build_sheet(orientation, out_path, ig_url, google_url, logo_path):
    """8.5x11 print sheet with both the IG QR and Google QR.

    Each block drops the 'Trainer Center HB' brand title (the sheet is
    posted in the shop, so the brand is already on the wall) and uses
    a direct CTA heading instead. Bottom of each block is the action
    visual: handle for IG, 5 stars for Google.
    """
    ig_heading = [('Follow Us on ', INK), ('IG', BRAND_RED)]
    google_heading = [('Review us on ', INK), ('Google', GOOGLE_BLUE)]

    # Lock both cards to identical structural dimensions:
    #   - Same QR matrix size (version 5 fits both URLs comfortably)
    #   - Same footer area (Google's stars row is the tallest, so both
    #     use its height; IG's handle row gets centered in the same slot)
    FORCED_QR_VERSION = 5
    # Compute Google's natural footer = stars + gap + nothing else.
    # IG's natural footer = handle row (max of glyph or text). Pick max.
    SHARED_FOOTER_H = (48 * 2) + 28 + 68  # stars_row_h + gap_stars_handle + handle_row_h fallback

    ig_card = build_card(
        ig_url, logo_path,
        style_name='default',
        heading_override=ig_heading,
        return_image=True,
        force_version=FORCED_QR_VERSION,
        force_footer_h=SHARED_FOOTER_H,
    )
    google_card = build_card(
        google_url, logo_path,
        style_name='google',
        heading_override=google_heading,
        hide_handle_text=True,  # stars are the final element on the Google block
        return_image=True,
        force_version=FORCED_QR_VERSION,
        force_footer_h=SHARED_FOOTER_H,
    )

    # Normalize both cards to the same bounding box before placement so
    # they render at identical sizes on the sheet. Native heights differ
    # (Google has the star row, IG has the handle row) — without this
    # the Google card ends up slightly bigger and the layout feels off.
    max_w = max(ig_card.width, google_card.width)
    max_h = max(ig_card.height, google_card.height)
    def pad_to(img, w, h):
        if img.size == (w, h):
            return img
        canvas = Image.new('RGB', (w, h), WHITE)
        canvas.paste(img, ((w - img.width) // 2, (h - img.height) // 2))
        return canvas
    ig_card = pad_to(ig_card, max_w, max_h)
    google_card = pad_to(google_card, max_w, max_h)

    # 8.5 x 11 at 300 DPI = 2550 x 3300 portrait, 3300 x 2550 landscape.
    if orientation == 'landscape':
        canvas_w, canvas_h = 3300, 2550
    else:
        canvas_w, canvas_h = 2550, 3300

    margin = 110

    def fit(img, max_w, max_h):
        ratio = min(max_w / img.width, max_h / img.height)
        new_w = max(1, int(img.width * ratio))
        new_h = max(1, int(img.height * ratio))
        return img.resize((new_w, new_h), Image.LANCZOS)

    sheet = Image.new('RGB', (canvas_w, canvas_h), WHITE)

    if orientation == 'portrait':
        # Two blocks stacked vertically. Each takes ~half the height.
        target_w = canvas_w - 2 * margin
        target_h = (canvas_h - 3 * margin) // 2
        ig_fit = fit(ig_card, target_w, target_h)
        g_fit = fit(google_card, target_w, target_h)
        sheet.paste(ig_fit, ((canvas_w - ig_fit.width) // 2, margin))
        sheet.paste(
            g_fit,
            ((canvas_w - g_fit.width) // 2, canvas_h - margin - g_fit.height),
        )
    else:
        # Side-by-side, IG on the left, Google on the right.
        target_w = (canvas_w - 3 * margin) // 2
        target_h = canvas_h - 2 * margin
        ig_fit = fit(ig_card, target_w, target_h)
        g_fit = fit(google_card, target_w, target_h)
        sheet.paste(ig_fit, (margin, (canvas_h - ig_fit.height) // 2))
        sheet.paste(
            g_fit,
            (canvas_w - margin - g_fit.width, (canvas_h - g_fit.height) // 2),
        )

    sheet.save(out_path, dpi=(300, 300))
    print(f'Saved -> {out_path}  ({sheet.size[0]}x{sheet.size[1]} px, 8.5x11 @ 300 DPI {orientation})')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default=DEFAULT_URL)
    ap.add_argument('--logo', default=DEFAULT_LOGO)
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--style', default='default',
                    choices=list(STYLES.keys()),
                    help='Color/handle preset: default (IG red+ink), google (blue+green), yelp.')
    ap.add_argument('--mode', default='card', choices=['card', 'bare'],
                    help='card = full branded card (title+QR+footer). bare = just the colored QR with logo center.')
    # Sheet mode — generates an 8.5x11 print sheet with both IG and
    # Google QRs side by side or stacked.
    ap.add_argument('--sheet', default=None, choices=['portrait', 'landscape'],
                    help='Generate an 8.5x11 print sheet with both QRs.')
    ap.add_argument('--ig-url', default='https://instagram.com/trainercenter.pokemon',
                    help='URL for the IG QR block in --sheet mode.')
    ap.add_argument('--google-url', default=DEFAULT_GOOGLE_URL,
                    help='URL for the Google QR block in --sheet mode.')
    args = ap.parse_args()

    if args.sheet:
        out = args.out
        if out == DEFAULT_OUT:
            out = os.path.expanduser(f'~/Downloads/trainercenter_sheet_{args.sheet}.png')
        build_sheet(args.sheet, out, args.ig_url, args.google_url, args.logo)
    elif args.mode == 'bare':
        build_bare_qr(args.url, args.logo, args.out, style_name=args.style)
    else:
        build_card(args.url, args.logo, args.out, style_name=args.style)
