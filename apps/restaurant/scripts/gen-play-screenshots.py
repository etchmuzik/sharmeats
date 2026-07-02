#!/usr/bin/env python3
"""
Generate Play-compliant phone screenshots for the Sharm Eats RESTAURANT (staff)
app.

These are faithful renders of the app's REAL screens — exact UI strings taken
from apps/restaurant/app/*.tsx and the exact theme colours from
apps/restaurant/src/theme.ts — composed into Google Play phone slots. Play
requires screenshots to accurately represent the in-app experience; rendering
the genuine screens (rather than a live simulator capture, which isn't available
in this environment) satisfies that as long as the depicted UI is real.

Output: 1611x2864 PNG (exact 9:16, both sides within Play's 320-3840px range),
one per screen, into apps/restaurant/store-screenshots/play-phone/.

A slim violet caption band at the top of each canvas is clearly promotional
chrome (like the customer app's "Sharm's best food, delivered." posters),
separated from the device frame so it does not read as a fake UI element.
"""
from PIL import Image, ImageDraw, ImageFont
import os

# ---- output geometry (Play phone: exact 9:16) ---------------------------------
OUT_W, OUT_H = 1611, 2864
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "store-screenshots", "play-phone")
os.makedirs(OUT_DIR, exist_ok=True)

# ---- verified theme palette (src/theme.ts) ------------------------------------
VIOLET      = (122, 60, 255)    # #7a3cff  accent (primary)
VIOLET_DK   = (91, 38, 204)     # #5b26cc
VIOLET_SOFT = (236, 227, 255)   # #ece3ff
BG          = (250, 250, 247)   # #fafaf7
BG_SOFT     = (245, 240, 225)   # #f5f0e1
SAND        = (243, 234, 215)   # #f3ead7
INK         = (10, 10, 12)      # #0a0a0c
INK2        = (91, 91, 102)     # #5b5b66
INK3        = (148, 148, 160)   # #9494a0
LINE        = (232, 227, 212)   # #e8e3d4
GREEN       = (46, 138, 93)     # #2e8a5d
GREEN_SOFT  = (226, 241, 234)   # #e2f1ea
RED         = (200, 65, 42)     # #c8412a
RED_SOFT    = (255, 226, 220)   # #ffe2dc
AMBER       = (184, 121, 26)    # #b8791a
AMBER_SOFT  = (251, 242, 221)   # #fbf2dd
SEA         = (14, 124, 145)    # #0e7c91
CORAL       = (255, 90, 60)     # eats coral (from icon)
WHITE       = (255, 255, 255)

# ---- fonts --------------------------------------------------------------------
HELV = "/System/Library/Fonts/Helvetica.ttc"
# Helvetica.ttc face indices: 0 Regular, 1 Bold, 2 Light, ... use bold via index.
def font(size, bold=False, black=False):
    idx = 1 if (bold or black) else 0
    try:
        return ImageFont.truetype(HELV, size, index=idx)
    except Exception:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)

# convenience text helpers ------------------------------------------------------
def tw(draw, text, fnt):
    b = draw.textbbox((0, 0), text, font=fnt)
    return b[2] - b[0], b[3] - b[1]

def text(draw, xy, s, fnt, fill, anchor=None):
    draw.text(xy, s, font=fnt, fill=fill, anchor=anchor)

def rrect(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def pill(draw, xy, s, fnt, fg, bg, padx=22, pady=11):
    w, h = tw(draw, s, fnt)
    x, y = xy
    box = [x, y, x + w + padx * 2, y + h + pady * 2]
    rrect(draw, box, (box[3] - box[1]) // 2, fill=bg)
    text(draw, (x + padx, y + pady - 2), s, fnt, fg)
    return box[2], box[3]  # return right/bottom

# device-frame constants (phone screen area inside the 9:16 canvas) -------------
CAP_H = 300                 # caption band height
FRAME_M = 70                # side margin of the phone frame
FRAME_TOP = CAP_H + 60
FRAME_BOT = OUT_H - 70
FRAME_R = 90                # phone corner radius
SCREEN_PAD = 26             # bezel thickness

def new_canvas():
    return Image.new("RGB", (OUT_W, OUT_H), BG_SOFT)

def draw_caption(cv, draw, title, subtitle):
    # violet band
    draw.rectangle([0, 0, OUT_W, CAP_H], fill=VIOLET)
    ftitle = font(76, black=True)
    fsub = font(40)
    text(draw, (OUT_W // 2, CAP_H // 2 - 44), title, ftitle, WHITE, anchor="mm")
    text(draw, (OUT_W // 2, CAP_H // 2 + 44), subtitle, fsub, VIOLET_SOFT, anchor="mm")

def phone_screen():
    """Return (Image screen, (sx0,sy0,sx1,sy1) content box) for drawing UI."""
    scr_w = OUT_W - FRAME_M * 2 - SCREEN_PAD * 2
    scr_h = FRAME_BOT - FRAME_TOP - SCREEN_PAD * 2
    screen = Image.new("RGB", (scr_w, scr_h), BG)
    return screen, (0, 0, scr_w, scr_h)

def paste_phone(cv, screen):
    # black rounded frame
    d = ImageDraw.Draw(cv)
    frame_box = [FRAME_M, FRAME_TOP, OUT_W - FRAME_M, FRAME_BOT]
    rrect(d, frame_box, FRAME_R, fill=(16, 16, 20))
    # rounded-corner mask for the screen
    sx = FRAME_M + SCREEN_PAD
    sy = FRAME_TOP + SCREEN_PAD
    mask = Image.new("L", screen.size, 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, screen.size[0], screen.size[1]], radius=FRAME_R - SCREEN_PAD, fill=255)
    cv.paste(screen, (sx, sy), mask)

def status_bar(draw, w, dark_text=True, tint=None):
    col = INK if dark_text else WHITE
    text(draw, (34, 24), "9:41", font(30, bold=True), col)
    # signal dots + battery glyph (drawn, no emoji font needed)
    for i in range(4):
        r = 5
        cx = w - 150 + i * 20
        draw.ellipse([cx - r, 34 - r, cx + r, 34 + r], fill=col)
    # battery
    bx = w - 62
    draw.rounded_rectangle([bx, 26, bx + 44, 46], radius=5, outline=col, width=3)
    draw.rounded_rectangle([bx + 4, 30, bx + 34, 42], radius=2, fill=col)
    draw.rectangle([bx + 44, 32, bx + 48, 40], fill=col)

def draw_bell(draw, cx, cy, size, color):
    """Draw a simple notification bell using primitives (no emoji font)."""
    s = size
    # bell body (rounded dome + flared base)
    draw.pieslice([cx - s * 0.55, cy - s * 0.7, cx + s * 0.55, cy + s * 0.5],
                  180, 360, fill=color)
    draw.rectangle([cx - s * 0.55, cy - s * 0.1, cx + s * 0.55, cy + s * 0.35], fill=color)
    # flared rim
    draw.polygon([(cx - s * 0.7, cy + s * 0.35), (cx + s * 0.7, cy + s * 0.35),
                  (cx + s * 0.55, cy + s * 0.5), (cx - s * 0.55, cy + s * 0.5)], fill=color)
    # top nub
    draw.ellipse([cx - s * 0.12, cy - s * 0.85, cx + s * 0.12, cy - s * 0.6], fill=color)
    # clapper
    draw.ellipse([cx - s * 0.16, cy + s * 0.5, cx + s * 0.16, cy + s * 0.72], fill=color)

# ------------------------------------------------------------------------------
# SCREEN 1 — Sign in
# ------------------------------------------------------------------------------
def screen_signin():
    screen, (x0, y0, x1, y1) = phone_screen()
    w, h = screen.size
    d = ImageDraw.Draw(screen)
    # violet top half
    top_h = int(h * 0.42)
    d.rectangle([0, 0, w, top_h], fill=VIOLET)
    status_bar(d, w, dark_text=False)
    text(d, (48, 150), "Sharm Eats", font(66, black=True), WHITE)
    text(d, (48, 232), "Restaurant", font(38), VIOLET_SOFT)
    # form card
    card = [40, top_h - 40, w - 40, h - 60]
    rrect(d, card, 34, fill=BG_SOFT, outline=LINE, width=2)
    cx = card[0] + 44
    cy = card[1] + 54
    text(d, (cx, cy), "Sign in", font(48, black=True), INK)
    cy += 78
    d.text((cx, cy), "Use your restaurant email and password", font=font(28), fill=INK2)
    cy += 40
    d.text((cx, cy), "(same as the web dashboard).", font=font(28), fill=INK2)
    cy += 74
    # email field
    fld_w = card[2] - card[0] - 88
    for placeholder, val in [("owner@restaurant.com", True), ("Password", False)]:
        fb = [cx, cy, cx + fld_w, cy + 92]
        rrect(d, fb, 16, fill=WHITE, outline=LINE, width=2)
        text(d, (cx + 28, cy + 30), placeholder if not val else "manager@kosharyeltahrir.com",
             font(30), INK if val else INK3)
        cy += 118
    cy += 8
    # CTA
    cta = [cx, cy, cx + fld_w, cy + 100]
    rrect(d, cta, 20, fill=VIOLET)
    text(d, ((cta[0] + cta[2]) // 2, (cta[1] + cta[3]) // 2), "Sign in",
         font(38, black=True), WHITE, anchor="mm")
    return screen

# ------------------------------------------------------------------------------
# shared: home header + one order card
# ------------------------------------------------------------------------------
def home_header(d, w, is_open=True):
    status_bar(d, w, dark_text=True)
    text(d, (40, 78), "Koshary El Tahrir", font(42, black=True), INK)
    text(d, (40, 134), "Restaurant · Manager", font(28), INK2)
    # open/pause status pill (top-right)
    lbl = "Open · pause" if is_open else "Closed · open"
    bg = GREEN_SOFT if is_open else RED_SOFT
    fg = GREEN if is_open else RED
    fnt = font(28, bold=True)
    tw_, th_ = tw(d, lbl, fnt)
    px = w - 40 - (tw_ + 40)
    rrect(d, [px, 82, px + tw_ + 40, 82 + th_ + 26], 999, fill=bg)
    text(d, (px + 20, 82 + 13), lbl, fnt, fg)
    # Tier link
    text(d, (w - 130, 150), "Tier", font(28, bold=True), VIOLET)

def section_head(d, x, y, w, label, count, accent=False):
    fnt = font(30, black=True)
    text(d, (x, y), label, fnt, VIOLET if accent else INK2)
    lw, _ = tw(d, label, fnt)
    # count badge
    cb = [x + lw + 18, y - 4, x + lw + 18 + 54, y + 40]
    rrect(d, cb, 999, fill=VIOLET if accent else SAND)
    text(d, ((cb[0] + cb[2]) // 2, (cb[1] + cb[3]) // 2 - 2), str(count),
         font(26, bold=True), WHITE if accent else INK2, anchor="mm")

def order_card(d, x, y, w, *, code, time, total, pay, pay_kind, items, addr,
               fulfil, note=None, actions=None, accent_border=False):
    pad = 30
    lines = 0
    # estimate height
    h = 250 + len(items) * 40 + (70 if note else 0)
    box = [x, y, x + w, y + h]
    rrect(d, box, 26, fill=WHITE, outline=(VIOLET if accent_border else LINE),
          width=4 if accent_border else 2)
    ix = x + pad
    iy = y + pad
    # top row: code + total
    text(d, (ix, iy), code, font(40, black=True), INK)
    ttl_f = font(38, black=True)
    twid, _ = tw(d, total, ttl_f)
    text(d, (box[2] - pad - twid, iy + 2), total, ttl_f, INK)
    iy += 58
    # time + payment
    text(d, (ix, iy), time, font(26), INK3)
    pf = font(26, bold=True)
    pcol = SEA if pay_kind == "cash" else (AMBER if pay_kind == "pending" else GREEN)
    pbg = (226, 241, 246) if pay_kind == "cash" else (AMBER_SOFT if pay_kind == "pending" else GREEN_SOFT)
    pw, ph = tw(d, pay, pf)
    rrect(d, [box[2] - pad - pw - 34, iy - 6, box[2] - pad, iy + ph + 14], 999, fill=pbg)
    text(d, (box[2] - pad - pw - 17, iy + 1), pay, pf, pcol)
    iy += 56
    # items
    for it in items:
        text(d, (ix, iy), it, font(30), INK)
        iy += 40
    iy += 6
    # kitchen note
    if note:
        nb = [ix, iy, box[2] - pad, iy + 54]
        rrect(d, nb, 12, fill=AMBER_SOFT)
        text(d, (ix + 16, iy + 12), "Kitchen note: " + note, font(26), AMBER)
        iy += 70
    # address + fulfilment
    text(d, (ix, iy), addr, font(28, bold=True), INK2)
    iy += 44
    ff = font(24, bold=True)
    fw, fh = tw(d, fulfil, ff)
    rrect(d, [ix, iy, ix + fw + 30, iy + fh + 20], 999, fill=SAND)
    text(d, (ix + 15, iy + 9), fulfil, ff, INK2)
    iy += 62
    # actions
    if actions:
        bw = (w - pad * 2 - 20) // len(actions)
        bx = ix
        for lbl, style in actions:
            bb = [bx, iy, bx + bw, iy + 86]
            if style == "green":
                rrect(d, bb, 18, fill=GREEN)
                fg = WHITE
            elif style == "violet":
                rrect(d, bb, 18, fill=VIOLET)
                fg = WHITE
            elif style == "red-outline":
                rrect(d, bb, 18, fill=WHITE, outline=RED, width=3)
                fg = RED
            else:
                rrect(d, bb, 18, fill=WHITE, outline=LINE, width=2)
                fg = INK
            text(d, ((bb[0] + bb[2]) // 2, (bb[1] + bb[3]) // 2), lbl,
                 font(32, black=True), fg, anchor="mm")
            bx += bw + 20
        iy += 100
    return iy  # bottom y

# ------------------------------------------------------------------------------
# SCREEN 2 — Home / NEW order
# ------------------------------------------------------------------------------
def screen_new_order():
    screen, _ = phone_screen()
    w, h = screen.size
    d = ImageDraw.Draw(screen)
    home_header(d, w, is_open=True)
    y = 210
    section_head(d, 40, y, w, "NEW", 1, accent=True)
    y += 66
    y = order_card(
        d, 40, y, w - 80,
        code="#XYZ123", time="14:32", total="184.00 EGP",
        pay="Cash on delivery", pay_kind="cash",
        items=["2× Koshari (Extra spice)", "1× Falafel wrap", "1× Lentil soup"],
        addr="Rixos Sharm · Room 412",
        fulfil="PLATFORM FLEET",
        note="No onions please",
        actions=[("Accept", "green"), ("Reject", "red-outline")],
        accent_border=True,
    )
    # trailing sections (real app always shows all three)
    y += 40
    section_head(d, 40, y, w, "IN KITCHEN", 1, accent=False)
    y += 66
    y = order_card(
        d, 40, y, w - 80,
        code="#ABC901", time="14:20", total="96.00 EGP",
        pay="Card · paid", pay_kind="paid",
        items=["1× Grilled chicken", "1× Rice & salad"],
        addr="Naama Bay · 12 Sultan St",
        fulfil="SELF-DELIVERY",
        actions=[("Mark ready", "violet")],
    )
    y += 40
    section_head(d, 40, y, w, "READY / PICKED UP", 0, accent=False)
    return screen

# ------------------------------------------------------------------------------
# SCREEN 3 — Home / IN KITCHEN
# ------------------------------------------------------------------------------
def screen_in_kitchen():
    screen, _ = phone_screen()
    w, h = screen.size
    d = ImageDraw.Draw(screen)
    home_header(d, w, is_open=True)
    y = 210
    section_head(d, 40, y, w, "IN KITCHEN", 2, accent=False)
    y += 66
    y = order_card(
        d, 40, y, w - 80,
        code="#DEF456", time="14:28", total="142.00 EGP",
        pay="Cash on delivery", pay_kind="cash",
        items=["3× Shawarma sandwich", "2× Fries"],
        addr="Hilton Fayrouz · Room 205",
        fulfil="PLATFORM FLEET",
        actions=[("Start preparing", "violet")],
    )
    y += 24
    y = order_card(
        d, 40, y, w - 80,
        code="#ABC901", time="14:20", total="96.00 EGP",
        pay="Card · paid", pay_kind="paid",
        items=["1× Grilled chicken", "1× Rice & salad"],
        addr="Naama Bay · 12 Sultan St",
        fulfil="SELF-DELIVERY",
        actions=[("Mark ready", "violet")],
    )
    y += 40
    section_head(d, 40, y, w, "READY / PICKED UP", 1, accent=False)
    y += 66
    order_card(
        d, 40, y, w - 80,
        code="#GHI222", time="14:05", total="210.00 EGP",
        pay="Cash on delivery", pay_kind="cash",
        items=["1× Mixed grill platter", "2× Baklava"],
        addr="Four Seasons · Room 118",
        fulfil="PLATFORM FLEET",
    )
    return screen

# ------------------------------------------------------------------------------
# SCREEN 4 — Home / empty (waiting)
# ------------------------------------------------------------------------------
def screen_empty():
    screen, _ = phone_screen()
    w, h = screen.size
    d = ImageDraw.Draw(screen)
    home_header(d, w, is_open=True)
    # centered empty state
    cy = h // 2 - 120
    # bell circle
    r = 90
    d.ellipse([w // 2 - r, cy - r, w // 2 + r, cy + r], fill=VIOLET_SOFT)
    draw_bell(d, w // 2, cy, 78, VIOLET)
    text(d, (w // 2, cy + 190), "Waiting for orders…", font(46, black=True), INK, anchor="mm")
    # subtext (wrapped)
    sub1 = "New orders appear here instantly"
    sub2 = "with a sound alert."
    text(d, (w // 2, cy + 256), sub1, font(30), INK2, anchor="mm")
    text(d, (w // 2, cy + 300), sub2, font(30), INK2, anchor="mm")
    return screen

# ------------------------------------------------------------------------------
# SCREEN 5 — Tier
# ------------------------------------------------------------------------------
def screen_tier():
    screen, _ = phone_screen()
    w, h = screen.size
    d = ImageDraw.Draw(screen)
    status_bar(d, w, dark_text=True)
    text(d, (40, 80), "‹ Back", font(32, bold=True), VIOLET)
    y = 190
    text(d, (48, y), "Silver tier", font(64, black=True), INK)
    y += 96
    text(d, (48, y), "Featured placement active", font(32, bold=True), VIOLET)
    y += 64
    text(d, (48, y), "48 more orders to next tier", font(30), INK2)
    y += 90
    # two stat cards
    gap = 30
    cw = (w - 80 - gap) // 2
    for i, (label, val) in enumerate([("Orders (90d)", "312"), ("Commission", "12.0%")]):
        cx = 40 + i * (cw + gap)
        cb = [cx, y, cx + cw, y + 230]
        rrect(d, cb, 26, fill=BG_SOFT, outline=LINE, width=2)
        text(d, (cx + 34, y + 40), label, font(30), INK2)
        text(d, (cx + 34, y + 108), val, font(76, black=True), INK)
    y += 290
    # tier progress bar illustration
    text(d, (48, y), "Your tier updates automatically from your", font(28), INK3)
    text(d, (48, y + 38), "last 90 days of completed orders.", font(28), INK3)
    return screen

# ------------------------------------------------------------------------------
SCREENS = [
    ("shot-1", "Manage orders in real time", "Every new order, the moment it lands", screen_new_order),
    ("shot-2", "One tap to accept", "Accept, prep, and mark ready", screen_in_kitchen),
    ("shot-3", "Built for your kitchen", "Clear queue, sound alerts, no clutter", screen_empty),
    ("shot-4", "Sign in with your staff account", "Same login as the web dashboard", screen_signin),
    ("shot-5", "Grow with loyalty tiers", "Lower commission as you serve more", screen_tier),
]

def main():
    for name, title, sub, fn in SCREENS:
        cv = new_canvas()
        d = ImageDraw.Draw(cv)
        draw_caption(cv, d, title, sub)
        screen = fn()
        paste_phone(cv, screen)
        out = os.path.join(OUT_DIR, name + ".png")
        cv.save(out, "PNG")
        print(f"  wrote {out}  ({cv.size[0]}x{cv.size[1]})")

if __name__ == "__main__":
    main()
