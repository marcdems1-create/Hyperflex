#!/usr/bin/env python3
"""Generate PDF versions of HYPERFLEX strategy and architecture docs."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import re
import os

GOLD = HexColor('#c9920d')
DARK = HexColor('#1a1a2e')
DIM = HexColor('#555566')
WHITE = HexColor('#ffffff')
LIGHT_BG = HexColor('#f5f5fa')

def make_styles():
    ss = getSampleStyleSheet()
    styles = {}
    styles['title'] = ParagraphStyle(
        'DocTitle', parent=ss['Title'],
        fontSize=28, leading=34, textColor=DARK,
        spaceAfter=6, fontName='Helvetica-Bold'
    )
    styles['subtitle'] = ParagraphStyle(
        'DocSubtitle', parent=ss['Normal'],
        fontSize=13, leading=18, textColor=DIM,
        spaceAfter=24, fontName='Helvetica'
    )
    styles['h1'] = ParagraphStyle(
        'H1', parent=ss['Heading1'],
        fontSize=20, leading=26, textColor=DARK,
        spaceBefore=24, spaceAfter=10, fontName='Helvetica-Bold'
    )
    styles['h2'] = ParagraphStyle(
        'H2', parent=ss['Heading2'],
        fontSize=15, leading=20, textColor=DARK,
        spaceBefore=18, spaceAfter=8, fontName='Helvetica-Bold'
    )
    styles['h3'] = ParagraphStyle(
        'H3', parent=ss['Heading3'],
        fontSize=12, leading=16, textColor=DARK,
        spaceBefore=14, spaceAfter=6, fontName='Helvetica-Bold'
    )
    styles['body'] = ParagraphStyle(
        'Body', parent=ss['Normal'],
        fontSize=10, leading=15, textColor=DARK,
        spaceAfter=8, fontName='Helvetica'
    )
    styles['bullet'] = ParagraphStyle(
        'Bullet', parent=styles['body'],
        leftIndent=20, bulletIndent=8,
        spaceAfter=4
    )
    styles['bold_body'] = ParagraphStyle(
        'BoldBody', parent=styles['body'],
        fontName='Helvetica-Bold'
    )
    return styles

def clean_md(text):
    """Strip markdown formatting for PDF."""
    text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # Italic
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    # Inline code
    text = re.sub(r'`(.+?)`', r'<font face="Courier" size="9">\1</font>', text)
    return text

def parse_table(lines):
    """Parse markdown table lines into a list of rows."""
    rows = []
    for line in lines:
        line = line.strip()
        if not line.startswith('|'):
            continue
        cells = [c.strip() for c in line.split('|')[1:-1]]
        # Skip separator rows
        if cells and all(re.match(r'^[-:]+$', c) for c in cells):
            continue
        rows.append(cells)
    return rows

def md_to_flowables(md_text, styles):
    """Convert markdown text to reportlab flowables."""
    flowables = []
    lines = md_text.split('\n')
    i = 0
    first_h1 = True

    while i < len(lines):
        line = lines[i].rstrip()

        # Skip empty lines
        if not line:
            i += 1
            continue

        # Horizontal rule
        if line.strip() == '---':
            flowables.append(Spacer(1, 6))
            flowables.append(HRFlowable(width="100%", thickness=1, color=HexColor('#ddddee')))
            flowables.append(Spacer(1, 6))
            i += 1
            continue

        # H1
        if line.startswith('# '):
            title_text = clean_md(line[2:].strip())
            if first_h1:
                flowables.append(Paragraph(title_text, styles['title']))
                first_h1 = False
            else:
                flowables.append(Paragraph(title_text, styles['h1']))
            i += 1
            continue

        # H2
        if line.startswith('## '):
            flowables.append(Paragraph(clean_md(line[3:].strip()), styles['h1']))
            i += 1
            continue

        # H3
        if line.startswith('### '):
            flowables.append(Paragraph(clean_md(line[4:].strip()), styles['h2']))
            i += 1
            continue

        # H4
        if line.startswith('#### '):
            flowables.append(Paragraph(clean_md(line[5:].strip()), styles['h3']))
            i += 1
            continue

        # Table
        if line.startswith('|'):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                table_lines.append(lines[i])
                i += 1
            rows = parse_table(table_lines)
            if rows:
                # Clean markdown in cells
                cleaned = []
                for row in rows:
                    cleaned.append([Paragraph(clean_md(c), styles['body']) for c in row])

                col_count = len(rows[0])
                avail = 6.5 * inch
                col_widths = [avail / col_count] * col_count

                t = Table(cleaned, colWidths=col_widths, repeatRows=1)
                t_style = [
                    ('BACKGROUND', (0, 0), (-1, 0), HexColor('#eeeef5')),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, -1), 9),
                    ('TEXTCOLOR', (0, 0), (-1, -1), DARK),
                    ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#ccccdd')),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ]
                t.setStyle(TableStyle(t_style))
                flowables.append(Spacer(1, 4))
                flowables.append(t)
                flowables.append(Spacer(1, 8))
            continue

        # Code block — skip
        if line.startswith('```'):
            i += 1
            code_lines = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```
            # Render as monospace block
            code_text = '<br/>'.join(
                l.replace(' ', '&nbsp;').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                for l in code_lines[:40]  # cap at 40 lines
            )
            if code_text:
                code_style = ParagraphStyle(
                    'Code', fontName='Courier', fontSize=7, leading=10,
                    textColor=DARK, backColor=HexColor('#f0f0f8'),
                    leftIndent=10, rightIndent=10,
                    spaceBefore=4, spaceAfter=8,
                    borderPadding=6
                )
                flowables.append(Paragraph(code_text, code_style))
            continue

        # Bullet
        if line.startswith('- '):
            text = clean_md(line[2:].strip())
            flowables.append(Paragraph(text, styles['bullet'], bulletText='\u2022'))
            i += 1
            continue

        # Numbered list
        m = re.match(r'^(\d+)\.\s+', line)
        if m:
            text = clean_md(line[m.end():].strip())
            flowables.append(Paragraph(text, styles['bullet'], bulletText=f"{m.group(1)}."))
            i += 1
            continue

        # Regular paragraph
        flowables.append(Paragraph(clean_md(line), styles['body']))
        i += 1

    return flowables

def build_pdf(md_path, pdf_path, subtitle=""):
    styles = make_styles()

    with open(md_path, 'r') as f:
        md_text = f.read()

    doc = SimpleDocTemplate(
        pdf_path, pagesize=letter,
        leftMargin=0.75*inch, rightMargin=0.75*inch,
        topMargin=0.75*inch, bottomMargin=0.75*inch
    )

    flowables = []
    if subtitle:
        flowables.append(Spacer(1, 12))

    flowables.extend(md_to_flowables(md_text, styles))

    doc.build(flowables)
    print(f"Created: {pdf_path} ({os.path.getsize(pdf_path):,} bytes)")

if __name__ == '__main__':
    docs_dir = os.path.dirname(os.path.abspath(__file__))

    build_pdf(
        os.path.join(docs_dir, 'STRATEGY.md'),
        os.path.join(docs_dir, 'HYPERFLEX_Strategy.pdf'),
    )
    build_pdf(
        os.path.join(docs_dir, 'TECHNICAL_ARCHITECTURE.md'),
        os.path.join(docs_dir, 'HYPERFLEX_Technical_Architecture.pdf'),
    )
