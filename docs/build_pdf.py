# Builds HRMS-Blueprint.pdf from the 12 markdown docs.
# Steps: markdown -> styled HTML (print CSS) -> Chrome headless --print-to-pdf.
import re, sys, html
from pathlib import Path

try:
    import markdown
except ImportError:
    sys.exit("NEED_PIP_INSTALL_MARKDOWN")

DOCS = Path(__file__).parent
ORDER = [
    ("README.md", "Index & Quick Reference"),
    ("00-overview-and-roles.md", "Product Overview, Requirements & Role Model"),
    ("01-modules-core.md", "Core Modules (1-8)"),
    ("02-modules-talent.md", "Talent & Money Modules (9-16)"),
    ("03-modules-platform-and-reports.md", "Platform Modules (17-23) & Reports"),
    ("04-database.md", "Database Schema & Multi-Tenant Model"),
    ("05-architecture.md", "Application Architecture"),
    ("06-ui-ux.md", "UI/UX Screen Specifications"),
    ("07-workflows-and-automation.md", "Workflows, Notifications & Automation"),
    ("08-api.md", "API Specification"),
    ("09-security.md", "Security, Privacy & Data Protection"),
    ("10-roadmap-testing-deployment.md", "Roadmap, Testing, Deployment & Build Order"),
]

MD = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"])

def preprocess(text: str) -> str:
    # strip cross-doc .md links -> bold text (links are meaningless inside one PDF)
    text = re.sub(r"\[([^\]]+)\]\((?:[0-9]{2}-[a-z\-]+|README)\.md(?:[^)]*)?\)", r"**\1**", text)
    # glyphs with shaky font coverage
    text = text.replace("⚑", "(SD)")  # black flag
    text = text.replace("⚿", "[secret]")  # squared key
    return text

sections = []
for fname, subtitle in ORDER:
    raw = (DOCS / fname).read_text(encoding="utf-8")
    MD.reset()
    body = MD.convert(preprocess(raw))
    sections.append(f'<section class="doc"><div class="doctag">{html.escape(fname)}</div>{body}</section>')

toc_rows = "".join(
    f'<tr><td class="tocnum">{i:02d}</td><td>{html.escape(sub)}</td><td class="tocfile">{html.escape(f)}</td></tr>'
    for i, (f, sub) in enumerate(ORDER)
)

page = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 16mm 14mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: 'Segoe UI', Arial, sans-serif; font-size: 9.5pt; color: #1a202c; line-height: 1.45; margin: 0; }}
.cover {{ height: 250mm; display: flex; flex-direction: column; justify-content: center; }}
.cover h1 {{ font-size: 30pt; color: #1e3a8a; border: none; margin: 0 0 4mm; }}
.cover .sub {{ font-size: 13pt; color: #475569; margin-bottom: 14mm; }}
.cover table {{ font-size: 9.5pt; }}
.meta {{ color: #64748b; font-size: 9pt; margin-top: 12mm; }}
section.doc {{ page-break-before: always; }}
.doctag {{ font-size: 8pt; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2mm; }}
h1 {{ font-size: 17pt; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 2mm; margin: 0 0 4mm; }}
h2 {{ font-size: 13pt; color: #1e40af; margin: 6mm 0 2.5mm; border-bottom: 1px solid #cbd5e1; padding-bottom: 1mm; }}
h3 {{ font-size: 11pt; color: #334155; margin: 4mm 0 2mm; }}
h4 {{ font-size: 10pt; color: #334155; margin: 3mm 0 1.5mm; }}
p {{ margin: 0 0 2.2mm; }}
ul, ol {{ margin: 0 0 2.5mm; padding-left: 5.5mm; }}
li {{ margin-bottom: 0.8mm; }}
blockquote {{ margin: 0 0 3mm; padding: 2mm 4mm; background: #f1f5f9; border-left: 3px solid #1e40af; color: #475569; font-size: 9pt; }}
code {{ font-family: Consolas, 'Courier New', monospace; font-size: 8.5pt; background: #f1f5f9; padding: 0 1.2mm; border-radius: 2px; }}
pre {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; padding: 2.5mm 3mm; overflow: hidden; white-space: pre-wrap; word-wrap: break-word; margin: 0 0 3mm; }}
pre code {{ background: none; padding: 0; font-size: 7.8pt; line-height: 1.35; }}
table {{ border-collapse: collapse; width: 100%; margin: 0 0 3.5mm; font-size: 8.3pt; page-break-inside: auto; }}
th {{ background: #1e3a8a; color: #fff; text-align: left; padding: 1.4mm 2mm; font-weight: 600; }}
td {{ border: 1px solid #cbd5e1; padding: 1.2mm 2mm; vertical-align: top; }}
tr {{ page-break-inside: avoid; }}
tbody tr:nth-child(even) {{ background: #f8fafc; }}
hr {{ border: none; border-top: 1px solid #e2e8f0; margin: 4mm 0; }}
strong {{ color: #0f172a; }}
.tocnum {{ color: #1e3a8a; font-weight: 700; width: 10mm; }}
.tocfile {{ color: #64748b; font-family: Consolas, monospace; font-size: 8pt; }}
</style></head><body>
<div class="cover">
  <h1>HRMS &mdash; Technical Blueprint</h1>
  <div class="sub">Production-ready plan for a multi-tenant HR Management System<br>
  Employees &middot; Attendance &middot; Leave &middot; Payroll &middot; Documents &middot; Recruitment &middot; Performance &middot; Training &middot; Expenses &middot; Reports</div>
  <table><tr><th style="width:10mm">#</th><th>Document</th><th>File</th></tr>{toc_rows}</table>
  <div class="meta">Generated 22 Aug 2026 &middot; 12 documents &middot; Single source of truth for implementation</div>
</div>
{''.join(sections)}
</body></html>"""

out = DOCS / "blueprint.html"
out.write_text(page, encoding="utf-8")
print(f"OK {out}")
