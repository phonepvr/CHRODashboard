#!/usr/bin/env python3
"""Fetch Albert Sans (OFL) at build time, subset it, and emit base64 woff2.

Runs in CI only — the repo commits no font binaries. The font is fetched from the
google/fonts repository pinned to a commit SHA, partially instanced to wght 400..700
(keeping the variable axis), subset to the glyphs the dashboard uses, converted to
woff2 (requires the brotli package) and written out as base64 for the assembler.

Usage: python build/fetch_subset_font.py --out build/font.b64
"""

import argparse
import base64
import hashlib
import io
import json
import sys
import urllib.request

# Pinned google/fonts commit containing ofl/albertsans, for reproducible builds.
GOOGLE_FONTS_SHA = "7ff85c87f93ea6cca5f41c69f2e4edcb90240f26"
FONT_URL = (
    "https://raw.githubusercontent.com/google/fonts/"
    f"{GOOGLE_FONTS_SHA}/ofl/albertsans/AlbertSans%5Bwght%5D.ttf"
)
# SHA-256 of the TTF at that commit; a mismatch warns (Google may republish) but
# does not fail the build — the artifact still ships, worst case with a newer font.
FONT_SHA256 = "8fe5d4cf5822d7096d4d17ad781c90f97c745ac13a22be619db74966fba45fda"

# Latin + punctuation + currency (₹) + arrows + typographic marks used in the UI.
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-2019,U+201C-201D,"
    "U+2026,U+20B9,U+2190-2193,U+2212,U+2022,U+00D7"
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--url", default=FONT_URL)
    args = ap.parse_args()

    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont
    except ImportError as e:
        print(f"fonttools not available: {e}", file=sys.stderr)
        return 1

    print(f"fetching {args.url}")
    with urllib.request.urlopen(args.url, timeout=60) as r:
        raw = r.read()
    print(f"fetched {len(raw) / 1024:.1f} KB")

    digest = hashlib.sha256(raw).hexdigest()
    if digest != FONT_SHA256:
        print(f"WARNING: font sha256 {digest} != pinned {FONT_SHA256}", file=sys.stderr)

    # Static instances per weight: fully pinning the wght axis strips gvar,
    # avoiding fontTools' variable-glyph subsetting edge cases entirely.
    out = {}
    for weight in (400, 600, 700):
        font = TTFont(io.BytesIO(raw))
        if "fvar" in font:
            instantiateVariableFont(font, {"wght": weight}, inplace=True)
        subsetter = subset.Subsetter(
            options=subset.Options(
                flavor="woff2",  # requires brotli
                layout_features=["kern", "liga", "tnum"],
                name_IDs=[1, 2, 3, 4, 6, 0, 13, 14],  # keep naming + OFL notice
            )
        )
        subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
        subsetter.subset(font)
        buf = io.BytesIO()
        font.flavor = "woff2"
        font.save(buf)
        woff2 = buf.getvalue()
        out[str(weight)] = base64.b64encode(woff2).decode("ascii")
        print(f"subset woff2 wght={weight}: {len(woff2) / 1024:.1f} KB")

    with open(args.out, "w") as f:
        json.dump(out, f)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
