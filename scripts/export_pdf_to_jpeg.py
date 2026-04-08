#!/usr/bin/env python3
"""Export each PDF page to a JPEG in the same folder: `<base> — slide NN.jpg`."""
import os
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF missing. Install: pip install pymupdf", file=sys.stderr)
    sys.exit(2)

if len(sys.argv) < 2:
    sys.exit(1)

pdf_path = os.path.abspath(sys.argv[1])
if not os.path.isfile(pdf_path):
    sys.exit(1)

d = os.path.dirname(pdf_path)
base = os.path.splitext(os.path.basename(pdf_path))[0]
mat = fitz.Matrix(2, 2)
doc = fitz.open(pdf_path)
try:
    for i in range(doc.page_count):
        pix = doc.load_page(i).get_pixmap(matrix=mat, alpha=False)
        out = os.path.join(d, f"{base} — slide {i + 1:02d}.jpg")
        pix.save(out, jpg_quality=92)
finally:
    doc.close()
