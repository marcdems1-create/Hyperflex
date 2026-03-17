#!/usr/bin/env python3
"""
HYPERFLEX Sponsor Kit PDF Generator
Reads community data from stdin as JSON, writes PDF to stdout.
Usage: echo '{"community":...}' | python3 generate_sponsor_kit.py > kit.pdf
"""

import sys
import json
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

# ── Brand colours ──────────────────────────────────────────────────────────────
GOLD       = HexColor('#c9920d')
GOLD_LIGHT = HexColor('#e8b84b')
INK        = HexColor('#141412')
CREAM      = HexColor('#f7f5f0')
DIM        = HexColor('#6b6960')
BORDER     = HexColor('#e2ddd6')
WHITE      = HexColor('#ffffff')
GREEN      = HexColor('#2d9b5f')

W, H = A4  # 595 x 842 pts

def draw_page_base(c, page_num, total_pages):
    """Shared header/footer for inner pages."""
    # Top gold bar
    c.setFillColor(GOLD)
    c.rect(0, H - 6, W, 6, fill=1, stroke=0)
    # Footer
    c.setFillColor(BORDER)
    c.rect(0, 0, W, 28, fill=1, stroke=0)
    c.setFillColor(DIM)
    c.setFont('Helvetica', 8)
    c.drawString(30, 10, 'HYPERFLEX · hyperflex.network · Confidential')
    c.drawRightString(W - 30, 10, f'Page {page_num} of {total_pages}')


def generate(data: dict) -> bytes:
    community  = data.get('community', {})
    stats      = data.get('stats', {})
    categories = data.get('categories', [])

    name       = community.get('name', 'Your Community')
    slug       = community.get('slug', '')
    url        = f"hyperflex.network/{slug}"
    pts_name   = community.get('pts_name', 'Flex Points')

    members        = stats.get('member_count', 0)
    weekly_traders = stats.get('weekly_traders', 0)
    total_preds    = stats.get('total_predictions', 0)
    markets_run    = stats.get('markets_run', 0)
    engagement     = stats.get('engagement_rate', 0)
    avg_bet        = stats.get('avg_bet_size', 0)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f'{name} — Sponsor Kit')
    c.setAuthor('HYPERFLEX')

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 1 — COVER
    # ══════════════════════════════════════════════════════════════════════════
    # Background
    c.setFillColor(INK)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Gold top stripe
    c.setFillColor(GOLD)
    c.rect(0, H - 8, W, 8, fill=1, stroke=0)

    # Diagonal gold accent block
    p = c.beginPath()
    p.moveTo(0, H * 0.52)
    p.lineTo(W * 0.55, H * 0.52)
    p.lineTo(W * 0.55, H * 0.50)
    p.lineTo(0, H * 0.50)
    p.close()
    c.setFillColor(HexColor('#1e1e1b'))
    c.drawPath(p, fill=1, stroke=0)

    # HYPERFLEX wordmark
    c.setFillColor(GOLD)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(36, H - 36, 'HYPERFLEX')
    c.setFillColor(DIM)
    c.setFont('Helvetica', 9)
    c.drawString(36, H - 50, 'PREDICTION MARKETS')

    # Community name — big
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 42)
    # Wrap long names
    name_display = name if len(name) <= 22 else name[:22] + '…'
    c.drawString(36, H * 0.62, name_display)

    # Subtitle
    c.setFillColor(GOLD)
    c.setFont('Helvetica-Bold', 14)
    c.drawString(36, H * 0.56, 'SPONSOR MEDIA KIT')

    c.setFillColor(DIM)
    c.setFont('Helvetica', 10)
    c.drawString(36, H * 0.52, url)

    # Hero stat strip
    strip_y = H * 0.32
    strip_h = 90
    c.setFillColor(HexColor('#1c1c19'))
    c.roundRect(24, strip_y - strip_h + 10, W - 48, strip_h, 8, fill=1, stroke=0)
    c.setStrokeColor(HexColor('#2a2a26'))
    c.setLineWidth(1)
    c.roundRect(24, strip_y - strip_h + 10, W - 48, strip_h, 8, fill=0, stroke=1)

    hero_stats = [
        (f"{members:,}", "COMMUNITY MEMBERS"),
        (f"{weekly_traders:,}", "WEEKLY ACTIVE TRADERS"),
        (f"{total_preds:,}", "TOTAL PREDICTIONS"),
        (f"{engagement}%", "ENGAGEMENT RATE"),
    ]
    col_w = (W - 48) / len(hero_stats)
    for i, (val, label) in enumerate(hero_stats):
        x = 24 + i * col_w + col_w / 2
        c.setFillColor(GOLD)
        c.setFont('Helvetica-Bold', 22)
        c.drawCentredString(x, strip_y - 20, val)
        c.setFillColor(DIM)
        c.setFont('Helvetica', 7)
        c.drawCentredString(x, strip_y - 34, label)
        if i < len(hero_stats) - 1:
            c.setStrokeColor(HexColor('#2a2a26'))
            c.setLineWidth(0.5)
            c.line(24 + (i + 1) * col_w, strip_y - strip_h + 18, 24 + (i + 1) * col_w, strip_y - 8)

    # Tagline
    c.setFillColor(DIM)
    c.setFont('Helvetica', 9)
    c.drawCentredString(W / 2, H * 0.24, 'A branded prediction market where fans put their conviction on the line.')

    # Bottom note
    c.setFillColor(HexColor('#3a3a36'))
    c.setFont('Helvetica', 8)
    c.drawCentredString(W / 2, 20, 'All predictions are play-money only (Flex Points). No financial regulation applies.')

    c.showPage()

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 2 — AUDIENCE OVERVIEW
    # ══════════════════════════════════════════════════════════════════════════
    c.setFillColor(CREAM)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    draw_page_base(c, 2, 3)

    # Section header
    c.setFillColor(GOLD)
    c.rect(30, H - 70, 4, 46, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(42, H - 52, 'Audience Overview')
    c.setFillColor(DIM)
    c.setFont('Helvetica', 10)
    c.drawString(42, H - 68, f'Real engagement data from the {name} prediction community')

    # ── Big stat boxes ──────────────────────────────────────────────────────
    def stat_box(x, y, bw, bh, value, label, sub=None, accent=False):
        fill = HexColor('#fffdf8') if not accent else HexColor('#fdf6e8')
        c.setFillColor(fill)
        c.roundRect(x, y, bw, bh, 6, fill=1, stroke=0)
        c.setStrokeColor(GOLD if accent else BORDER)
        c.setLineWidth(1 if not accent else 1.5)
        c.roundRect(x, y, bw, bh, 6, fill=0, stroke=1)
        if accent:
            c.setFillColor(GOLD)
            c.rect(x, y + bh - 4, bw, 4, fill=1, stroke=0)
        c.setFillColor(GOLD if accent else INK)
        c.setFont('Helvetica-Bold', 28)
        c.drawCentredString(x + bw / 2, y + bh - 46, value)
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 9)
        c.drawCentredString(x + bw / 2, y + bh - 60, label)
        if sub:
            c.setFillColor(DIM)
            c.setFont('Helvetica', 8)
            c.drawCentredString(x + bw / 2, y + 10, sub)

    box_y   = H - 200
    box_h   = 95
    box_gap = 10
    box_w   = (W - 60 - box_gap * 3) / 4
    stat_box(30,               box_y, box_w, box_h, f"{members:,}",        'COMMUNITY MEMBERS',       'joined the prediction market', accent=True)
    stat_box(30 + box_w + box_gap,   box_y, box_w, box_h, f"{weekly_traders:,}", 'WEEKLY ACTIVE TRADERS',   'placed a bet this week')
    stat_box(30 + (box_w + box_gap)*2, box_y, box_w, box_h, f"{total_preds:,}",   'TOTAL PREDICTIONS MADE',  'across all markets')
    stat_box(30 + (box_w + box_gap)*3, box_y, box_w, box_h, f"{markets_run:,}",   'MARKETS PUBLISHED',       'questions put to the crowd')

    # ── Engagement metrics ──────────────────────────────────────────────────
    metrics_y = box_y - 130
    c.setFillColor(WHITE)
    c.roundRect(30, metrics_y, W - 60, 108, 6, fill=1, stroke=0)
    c.setStrokeColor(BORDER)
    c.roundRect(30, metrics_y, W - 60, 108, 6, fill=0, stroke=1)

    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(48, metrics_y + 84, 'Engagement Metrics')

    eng_items = [
        (f"{engagement}%",   "Audience Engagement Rate",  "% of members who have placed at least one bet"),
        (f"{avg_bet:,} pts", f"Avg Bet Size ({pts_name})", "Average amount wagered per prediction"),
        (f"{markets_run}",   "Active Markets This Month",  "Live questions the community is predicting on"),
    ]
    col_w3 = (W - 60 - 36) / 3
    for i, (val, lbl, sub) in enumerate(eng_items):
        x = 48 + i * (col_w3 + 12)
        c.setFillColor(GOLD)
        c.setFont('Helvetica-Bold', 18)
        c.drawString(x, metrics_y + 58, val)
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 8)
        c.drawString(x, metrics_y + 44, lbl)
        c.setFillColor(DIM)
        c.setFont('Helvetica', 7)
        c.drawString(x, metrics_y + 32, sub)
        if i < 2:
            c.setStrokeColor(BORDER)
            c.line(x + col_w3 + 4, metrics_y + 20, x + col_w3 + 4, metrics_y + 88)

    # ── Category breakdown ──────────────────────────────────────────────────
    if categories:
        cat_y = metrics_y - 160
        c.setFillColor(WHITE)
        c.roundRect(30, cat_y, W - 60, 140, 6, fill=1, stroke=0)
        c.setStrokeColor(BORDER)
        c.roundRect(30, cat_y, W - 60, 140, 6, fill=0, stroke=1)

        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 11)
        c.drawString(48, cat_y + 118, "What This Community Bets On")
        c.setFillColor(DIM)
        c.setFont('Helvetica', 8)
        c.drawString(48, cat_y + 104, "Top prediction categories by volume (shows what topics your audience cares about most)"  )

        max_bets = max((cat.get('bets', 1) for cat in categories[:5]), default=1)
        bar_x = 48
        bar_y_start = cat_y + 90
        bar_gap = 18
        bar_total_w = W - 60 - 150

        cat_colors = ['#3b82f6','#ec4899','#f59e0b','#10b981','#8b5cf6']
        for i, cat in enumerate(categories[:5]):
            by = bar_y_start - i * bar_gap
            pct = cat.get('bets', 0) / max_bets
            label = cat.get('category', 'other').title()
            bets  = cat.get('bets', 0)

            c.setFillColor(HexColor('#f0ede8'))
            c.roundRect(bar_x + 80, by - 8, bar_total_w, 12, 2, fill=1, stroke=0)
            c.setFillColor(HexColor(cat_colors[i % len(cat_colors)]))
            c.roundRect(bar_x + 80, by - 8, max(bar_total_w * pct, 4), 12, 2, fill=1, stroke=0)

            c.setFillColor(INK)
            c.setFont('Helvetica-Bold', 8)
            c.drawString(bar_x, by, label)
            c.setFillColor(DIM)
            c.setFont('Helvetica', 7)
            c.drawRightString(bar_x + 80 + bar_total_w + 30, by, f"{bets:,} bets")

    c.showPage()

    # ══════════════════════════════════════════════════════════════════════════
    # PAGE 3 — SPONSORSHIP OPTIONS
    # ══════════════════════════════════════════════════════════════════════════
    c.setFillColor(CREAM)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    draw_page_base(c, 3, 3)

    # Section header
    c.setFillColor(GOLD)
    c.rect(30, H - 70, 4, 46, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(42, H - 52, 'Sponsorship Options')
    c.setFillColor(DIM)
    c.setFont('Helvetica', 10)
    c.drawString(42, H - 68, 'Put your brand in front of a highly engaged, opinion-driven audience')

    # ── What is a sponsored market ─────────────────────────────────────────
    explain_y = H - 150
    c.setFillColor(WHITE)
    c.roundRect(30, explain_y - 70, W - 60, 66, 6, fill=1, stroke=0)
    c.setStrokeColor(BORDER)
    c.roundRect(30, explain_y - 70, W - 60, 66, 6, fill=0, stroke=1)
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(48, explain_y - 18, 'What is a prediction market?')
    c.setFillColor(DIM)
    c.setFont('Helvetica', 8.5)
    lines = [
        f'A prediction market is a live yes/no question the community bets on using {pts_name} (play-money, no real money involved).',
        'Members stake points on their conviction — odds shift in real time as more people bet, making it far more engaging than a poll.',
        'When a creator sponsors a market, your brand name appears on the card every time a member views, bets on, or shares that question.',
    ]
    for i, line in enumerate(lines):
        c.drawString(48, explain_y - 32 - i * 13, line)

    # ── Mock sponsored market card ─────────────────────────────────────────
    card_y = explain_y - 200
    card_h = 110
    c.setFillColor(HexColor('#1c1c19'))
    c.roundRect(30, card_y, W - 60, card_h, 8, fill=1, stroke=0)
    c.setStrokeColor(HexColor('#2a2a26'))
    c.roundRect(30, card_y, W - 60, card_h, 8, fill=0, stroke=1)
    # Gold top accent
    c.setFillColor(GOLD)
    c.roundRect(30, card_y + card_h - 4, W - 60, 4, 2, fill=1, stroke=0)
    # Category pill
    c.setFillColor(HexColor('#1a3a5c'))
    c.roundRect(46, card_y + card_h - 28, 52, 16, 4, fill=1, stroke=0)
    c.setFillColor(HexColor('#60a5fa'))
    c.setFont('Helvetica-Bold', 7)
    c.drawString(50, card_y + card_h - 22, '⚡  SPORTS')
    # Sponsor badge
    c.setFillColor(HexColor('#2a2210'))
    c.roundRect(108, card_y + card_h - 28, 80, 16, 4, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont('Helvetica-Bold', 7)
    c.drawString(112, card_y + card_h - 22, f'✦  Sponsored by {name[:12]}')
    # Question
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(46, card_y + 70, 'Will [Team] win the championship this season?')
    # Odds bar
    c.setFillColor(HexColor('#2a2a26'))
    c.roundRect(46, card_y + 52, W - 92, 8, 2, fill=1, stroke=0)
    c.setFillColor(HexColor('#22c55e'))
    c.roundRect(46, card_y + 52, int((W - 92) * 0.68), 8, 2, fill=1, stroke=0)
    c.setFillColor(HexColor('#4ade80'))
    c.setFont('Helvetica-Bold', 8)
    c.drawString(46, card_y + 40, 'YES  68%')
    c.setFillColor(HexColor('#f87171'))
    c.drawString(120, card_y + 40, 'NO  32%')
    c.setFillColor(HexColor('#6b6960'))
    c.setFont('Helvetica', 7)
    c.drawString(46, card_y + 12, f'👥 {weekly_traders} traders  ·  ⏱ Closes in 6 days  ·  📊 {int(total_preds * 0.08):,} pts wagered')
    # Mock label
    c.setFillColor(DIM)
    c.setFont('Helvetica-Oblique', 7)
    c.drawRightString(W - 36, card_y + 12, '← Example sponsored market card')

    # ── Sponsorship tiers ──────────────────────────────────────────────────
    tiers_y = card_y - 30
    c.setFillColor(INK)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(30, tiers_y, 'Sponsorship Opportunities')

    tier_data = [
        ('Sponsored Market',    'Your brand badge on a single prediction market for its full duration.',    'Most flexible — sponsor any topic relevant to your brand'),
        ('Category Sponsor',    f'Your brand on all [{name[:10]} category] markets for one month.',           'Great for product launches or event tie-ins'),
        ('Community Partner',   'Brand presence across the entire community page + all markets.',           'Maximum visibility with a highly engaged audience'),
    ]

    tier_y2 = tiers_y - 22
    tier_h   = 64
    tier_gap = 10
    for i, (title, desc, note) in enumerate(tier_data):
        ty = tier_y2 - i * (tier_h + tier_gap)
        c.setFillColor(WHITE)
        c.roundRect(30, ty - tier_h + 10, W - 60, tier_h, 6, fill=1, stroke=0)
        c.setStrokeColor(BORDER)
        c.roundRect(30, ty - tier_h + 10, W - 60, tier_h, 6, fill=0, stroke=1)
        # Number
        c.setFillColor(GOLD)
        c.setFont('Helvetica-Bold', 18)
        c.drawString(46, ty - 14, str(i + 1))
        # Title
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 10)
        c.drawString(70, ty - 12, title)
        # Desc
        c.setFillColor(DIM)
        c.setFont('Helvetica', 8)
        c.drawString(70, ty - 26, desc)
        c.setFont('Helvetica-Oblique', 7.5)
        c.drawString(70, ty - 38, note)
        # Pricing note
        c.setFillColor(GOLD)
        c.setFont('Helvetica-Bold', 8)
        c.drawRightString(W - 46, ty - 20, 'Pricing set by creator →')

    # ── CTA ────────────────────────────────────────────────────────────────
    cta_y = tier_y2 - 3 * (tier_h + tier_gap) - 28
    c.setFillColor(INK)
    c.roundRect(30, cta_y - 42, W - 60, 50, 6, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(46, cta_y + 2, f'Interested in sponsoring a {name} prediction market?')
    c.setFillColor(DIM)
    c.setFont('Helvetica', 8.5)
    c.drawString(46, cta_y - 12, f'Visit  hyperflex.network/{slug}  to explore the community, then reach out directly to the creator.')
    c.setFillColor(GOLD)
    c.setFont('Helvetica-Bold', 8)
    c.drawString(46, cta_y - 26, f'hyperflex.network/{slug}')

    c.showPage()
    c.save()

    buf.seek(0)
    return buf.read()


if __name__ == '__main__':
    raw = sys.stdin.read()
    data = json.loads(raw)
    sys.stdout.buffer.write(generate(data))
