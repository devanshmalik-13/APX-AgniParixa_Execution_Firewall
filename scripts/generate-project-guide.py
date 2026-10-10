"""Render the editable project manual with the bundled artifact Python runtime."""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, PageBreak, PageTemplate, Paragraph,
    Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
PAGE_W, PAGE_H = A4
MARGIN = 49
WIDTH = PAGE_W - 2 * MARGIN


def register_fonts():
    font_dir = Path('C:/Windows/Fonts')
    if (font_dir / 'segoeui.ttf').exists():
        for name, file in [('Guide', 'segoeui.ttf'), ('GuideBold', 'segoeuib.ttf'), ('GuideItalic', 'segoeuii.ttf')]:
            pdfmetrics.registerFont(TTFont(name, str(font_dir / file)))
        pdfmetrics.registerFontFamily('Guide', normal='Guide', bold='GuideBold', italic='GuideItalic', boldItalic='GuideBold')
        return 'Guide', 'GuideBold'
    return 'Helvetica', 'Helvetica-Bold'


FONT, BOLD = register_fonts()
styles = getSampleStyleSheet()
styles.add(ParagraphStyle('GuideBody', fontName=FONT, fontSize=10.3, leading=14.8, spaceAfter=8.5, textColor=colors.black))
styles.add(ParagraphStyle('GuideChapter', fontName=BOLD, fontSize=21, leading=25.5, spaceAfter=18, keepWithNext=True, textColor=colors.black))
styles.add(ParagraphStyle('GuideTable', fontName=FONT, fontSize=8.4, leading=11.5, spaceAfter=0, textColor=colors.black))
styles.add(ParagraphStyle('GuideTableHead', parent=styles['GuideTable'], fontName=BOLD))
styles.add(ParagraphStyle('GuideCode', fontName='Courier', fontSize=7.7, leading=11, spaceAfter=0, textColor=colors.black))
styles.add(ParagraphStyle('GuideTOC', fontName=FONT, fontSize=10, leading=15, spaceAfter=5, leftIndent=0, firstLineIndent=0, rightIndent=15))
styles.add(ParagraphStyle('GuideTitle', fontName=BOLD, fontSize=58, leading=65, textColor=colors.black))
styles.add(ParagraphStyle('GuideSubtitle', fontName=FONT, fontSize=23, leading=31, spaceAfter=20, textColor=colors.black))


def inline(text):
    links = []
    def stash(match):
        idx = len(links)
        links.append((match.group(1), match.group(2)))
        return f'LINKTOKEN{idx}END'
    text = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', stash, text)
    value = escape(text)
    value = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', value)
    for idx, (label, url) in enumerate(links):
        value = value.replace(f'LINKTOKEN{idx}END', f'<a href="{escape(url, {chr(34): "&quot;"})}" color="#222222"><u>{escape(label)}</u></a>')
    return value


class Pipeline(Flowable):
    def __init__(self, lines):
        super().__init__()
        self.labels = [line.strip() for line in lines if line.strip() and line.strip() != '|']
        self.width = WIDTH
        self.height = len(self.labels) * 28 + 10

    def draw(self):
        canvas = self.canv
        box_w = min(WIDTH - 12, 415)
        x = (WIDTH - box_w) / 2
        for i, label in enumerate(self.labels):
            y = self.height - (i + 1) * 28
            canvas.setStrokeColor(colors.HexColor('#D9D9D9'))
            canvas.setFillColor(colors.white)
            canvas.roundRect(x, y, box_w, 21, 3, stroke=1, fill=1)
            canvas.setFillColor(colors.black)
            canvas.setFont(BOLD if 'policy' in label.lower() or 'transaction' in label.lower() else FONT, 8.1)
            canvas.drawCentredString(WIDTH / 2, y + 7, label)
            if i + 1 < len(self.labels):
                middle = WIDTH / 2
                canvas.setStrokeColor(colors.HexColor('#6A6A6A'))
                canvas.line(middle, y - 1, middle, y - 6)
                canvas.line(middle, y - 6, middle - 2, y - 4)
                canvas.line(middle, y - 6, middle + 2, y - 4)


class Manual(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == 'GuideChapter':
            title = flowable.getPlainText()
            if title == 'Contents':
                return
            key = 'chapter-' + re.match(r'\d+', title).group(0)
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=0)
            self.notify('TOCEntry', (0, title, self.page, key))


def page_frame(canvas, doc):
    if doc.page == 1:
        return
    canvas.saveState()
    canvas.setFillColor(colors.HexColor('#444444'))
    canvas.setFont(FONT, 8)
    canvas.drawString(MARGIN, PAGE_H - 29, 'APX  |  Project guide')
    canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 29, '11 October 2026')
    canvas.setStrokeColor(colors.HexColor('#D9D9D9'))
    canvas.line(MARGIN, 38, PAGE_W - MARGIN, 38)
    canvas.drawString(MARGIN, 25, 'Local prototype  |  Evidence and limitations included')
    canvas.drawRightString(PAGE_W - MARGIN, 25, str(doc.page))
    canvas.restoreState()


def rows_to_table(rows):
    count = len(rows[0])
    if count == 5:
        proportions = [0.30, 0.18, 0.18, 0.18, 0.16]
    elif count == 4:
        proportions = [0.22, 0.28, 0.20, 0.30]
    elif count == 3:
        proportions = [0.23, 0.36, 0.41]
    else:
        proportions = [0.34, 0.66]
    cells = [[Paragraph(inline(cell), styles['GuideTableHead' if i == 0 else 'GuideTable']) for cell in row] for i, row in enumerate(rows)]
    table = Table(cells, colWidths=[WIDTH * p for p in proportions], repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LINEABOVE', (0, 0), (-1, 0), 0.6, colors.HexColor('#D9D9D9')),
        ('LINEBELOW', (0, 0), (-1, 0), 0.6, colors.HexColor('#D9D9D9')),
        ('LINEBELOW', (0, 1), (-1, -1), 0.35, colors.HexColor('#D9D9D9')),
    ]))
    return [table, Spacer(1, 12)]


def parse_blocks(lines):
    result = []
    i = 0
    while i < len(lines):
        text = lines[i].strip()
        if not text:
            i += 1
            continue
        if text.startswith('~~~'):
            language = text[3:]
            block = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('~~~'):
                block.append(lines[i])
                i += 1
            if language == 'diagram':
                result.extend([Pipeline(block), Spacer(1, 12)])
            else:
                for line in block:
                    # Wrap long commands at spaces, preserving an explicit visual continuation.
                    pieces = []
                    while len(line) > 101:
                        split = line.rfind(' ', 0, 99)
                        if split < 20:
                            split = 99
                        pieces.append(line[:split] + ' \\')
                        line = '    ' + line[split:].lstrip()
                    pieces.append(line)
                    for piece in pieces:
                        result.append(Paragraph(escape(piece).replace(' ', '&#160;'), styles['GuideCode']))
                result.append(Spacer(1, 13))
            i += 1
            continue
        if text.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
                if not all(re.match(r'^:?-+:?$', cell) for cell in cells):
                    rows.append(cells)
                i += 1
            result.extend(rows_to_table(rows))
            continue
        if re.match(r'^\d+\. ', text):
            result.append(Paragraph(inline(text), styles['GuideBody']))
            i += 1
            continue
        paragraph = [text]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(('~~~', '|')) and not re.match(r'^\d+\. ', lines[i].strip()):
            paragraph.append(lines[i].strip())
            i += 1
        result.append(Paragraph(inline(' '.join(paragraph)), styles['GuideBody']))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / 'docs/APX_PROJECT_GUIDE.md')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/pdf/APX_PROJECT_GUIDE.pdf')
    args = parser.parse_args()
    text = args.source.read_text(encoding='utf-8')
    sections = re.split(r'^## ', text, flags=re.MULTILINE)[1:]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    doc = Manual(str(args.output), pagesize=A4, title='APX project guide', author='APX project', leftMargin=MARGIN, rightMargin=MARGIN, topMargin=53, bottomMargin=52)
    frame = Frame(MARGIN, 52, WIDTH, PAGE_H - 105, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id='Manual', frames=[frame], onPage=page_frame))
    story = [Spacer(1, 105), Paragraph('APX', styles['GuideTitle']), Spacer(1, 20), Paragraph('Project guide', styles['GuideSubtitle']), Paragraph('Transactional execution and recovery<br/>for AI support agents', styles['GuideSubtitle']), Spacer(1, 42)]
    story.append(Paragraph('Architecture, workflows, verified evidence and a learning roadmap', styles['GuideBody']))
    story.append(Paragraph('Prepared 11 October 2026<br/>Implementation baseline 004c934<br/>Local demo first', styles['GuideBody']))
    story.extend([Spacer(1, 32), Paragraph('Includes the support workspace, external proposal gateway, pretrained observer, comparison workspace and historical attack laboratory. Live-provider verification and hosted observer publication are explicitly pending.', styles['GuideBody']), PageBreak(), Paragraph('Contents', styles['GuideChapter'])])
    toc = TableOfContents()
    toc.levelStyles = [styles['GuideTOC']]
    story.extend([toc, PageBreak()])
    for i, section in enumerate(sections):
        lines = section.splitlines()
        story.append(Paragraph(inline(lines[0]), styles['GuideChapter']))
        story.extend(parse_blocks(lines[1:]))
        if i + 1 < len(sections):
            story.append(PageBreak())
    doc.multiBuild(story)
    print(f'Created project guide: {args.output}')


if __name__ == '__main__':
    main()
