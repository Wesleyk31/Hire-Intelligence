"""Run after the large report browser test: python check_pdf_layout.py PDF_PATH.
Requires pdfplumber. The Codex bundled Python includes it.
Checks extracted glyph bounds; PNG review is still required for visual layout.
"""
import json
import sys
from pathlib import Path
import pdfplumber

path = Path(sys.argv[1])
outside = []
fleet_markers = set()
calibration_found = False
with pdfplumber.open(path) as pdf:
    for number, page in enumerate(pdf.pages, 1):
        for char in page.chars:
            if char.get("text", "").strip() and (char["x0"] < 28 or char["x1"] > page.width - 28 or char["top"] < 20 or char["bottom"] > page.height - 28):
                outside.append({"page": number, "text": char["text"], "top": round(char["top"], 1), "bottom": round(char["bottom"], 1)})
        text = page.extract_text() or ""
        for index in range(1, 16):
            if f"AUDIT-FLEET-{index}-END" in text:
                fleet_markers.add(index)
        calibration_found |= "Linked genuine reviewed outcomes: 15" in text
    result = {"pages": len(pdf.pages), "glyphs_outside_margins": len(outside), "first_outside": outside[:5], "fleet_notes_present": len(fleet_markers), "calibration_present": calibration_found}
print(json.dumps(result, indent=2))
assert len(fleet_markers) == 15, "One or more fleet recommendations disappeared from the report"
assert calibration_found, "Calibration summary disappeared from the report"
assert not outside, "Report text extends outside printable page margins"
