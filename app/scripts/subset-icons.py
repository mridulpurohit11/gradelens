"""
Builds a small Material Symbols font that only contains the icons used in src/.
Usage (from the app folder):  python scripts/subset-icons.py
Needs: pip install fonttools brotli
Run it again whenever you use a new icon name.
"""
import pathlib, re, sys
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
FULL = ROOT / "node_modules" / "material-symbols" / "material-symbols-outlined.woff2"
OUT = SRC / "assets" / "material-symbols-subset.woff2"

names = set()
for f in SRC.rglob("*.tsx"):
    names.update(re.findall(r"['\"]([a-z][a-z0-9_]{1,40})['\"]", f.read_text(encoding="utf-8")))

font = TTFont(str(FULL))
cmap = font.getBestCmap()
glyph_to_char = {g: chr(c) for c, g in cmap.items()}
kept = 0
for lookup in font["GSUB"].table.LookupList.Lookup:
    for st in lookup.SubTable:
        if st.LookupType == 7:
            st = st.ExtSubTable
        if getattr(st, "LookupType", None) != 4:
            continue
        for first, ligs in list(st.ligatures.items()):
            keep = []
            for lig in ligs:
                word = glyph_to_char.get(first, "") + "".join(glyph_to_char.get(c, "?") for c in lig.Component)
                if word in names:
                    keep.append(lig)
            kept += len(keep)
            if keep:
                st.ligatures[first] = keep
            else:
                del st.ligatures[first]

opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["liga", "rlig", "calt", "ccmp"]
opts.notdef_outline = True
opts.name_IDs = ["*"]
sub = subset.Subsetter(opts)
sub.populate(unicodes=[ord(c) for c in "abcdefghijklmnopqrstuvwxyz0123456789_"])
sub.subset(font)
# Keep the variable axes (FILL, wght) so icon-fill works.
font.flavor = "woff2"
font.save(str(OUT))
print(f"{kept} icons kept from {len(names)} candidate names -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
