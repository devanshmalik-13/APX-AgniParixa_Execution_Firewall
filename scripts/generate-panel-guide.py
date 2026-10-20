"""Generate the short panel guide from its editable Markdown source."""
from pathlib import Path
import re
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/pdf/APX_PANEL_QUICK_GUIDE.pdf"
FONT_DIR = Path("C:/Windows/Fonts")
for name, filename in [("Panel", "segoeui.ttf"), ("PanelBold", "segoeuib.ttf")]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
pdfmetrics.registerFontFamily("Panel", normal="Panel", bold="PanelBold")

STYLES = {
    "title": ParagraphStyle("Title", fontName="PanelBold", fontSize=23, leading=28, spaceAfter=12),
    "heading": ParagraphStyle("Heading", fontName="PanelBold", fontSize=12, leading=16, spaceBefore=10, spaceAfter=7, keepWithNext=True),
    "body": ParagraphStyle("Body", fontName="Panel", fontSize=10.1, leading=14.2, spaceAfter=8),
    "item": ParagraphStyle("Item", fontName="Panel", fontSize=10.1, leading=14.2, spaceAfter=8),
}

def inline(value):
    return re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", escape(value))

def footer(canvas, doc):
    canvas.saveState()
    width, _ = A4
    canvas.setStrokeColor(colors.HexColor("#D6DADF"))
    canvas.line(43, 39, width - 43, 39)
    canvas.setFont("Panel", 8)
    canvas.setFillColor(colors.HexColor("#59616A"))
    canvas.drawString(43, 25, "APX  /  Panel quick guide  /  Local demo")
    canvas.drawRightString(width - 43, 25, str(doc.page))
    canvas.restoreState()

story = []
source = (ROOT / "docs/APX_PANEL_QUICK_GUIDE.md").read_text(encoding="utf-8")
for block in re.split(r"\n\s*\n", source.strip()):
    if block == "<!-- pagebreak -->":
        story.append(PageBreak())
    elif block.startswith("# "):
        story.append(Paragraph(inline(block[2:]), STYLES["title"]))
    elif block.startswith("## "):
        story.append(Paragraph(inline(block[3:]), STYLES["heading"]))
    elif block.startswith("- "):
        for line in block.splitlines():
            story.append(Paragraph(inline(line[2:]), STYLES["item"]))
    elif re.match(r"1\. ", block):
        for line in block.splitlines():
            story.append(Paragraph(inline(line), STYLES["item"]))
    else:
        story.append(Paragraph(inline(block.replace("\n", " ")), STYLES["body"]))

OUT.parent.mkdir(parents=True, exist_ok=True)
SimpleDocTemplate(
    str(OUT), pagesize=A4, rightMargin=43, leftMargin=43,
    topMargin=40, bottomMargin=52,
    title="APX: Panel Quick Guide", author="APX",
).build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
