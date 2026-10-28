"""Build the bundled regular font from an operator-supplied licensed NotoSansJP font.
Usage: python scripts/subset-report-font.py SOURCE_FONT OUTPUT_FONT
Requires fonttools; production PDF rendering only needs the bundled output and OFL.
"""
import pathlib
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

font = TTFont(sys.argv[1])
if 'fvar' in font:
    font = instantiateVariableFont(font, {'wght': 400}, inplace=True)
text = ''.join(p.read_text(encoding='utf-8') for p in pathlib.Path('src').rglob('*.ts'))
characters = set(text) | {chr(i) for i in range(32, 127)}
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes={ord(c) for c in characters})
subsetter.subset(font)
font.save(sys.argv[2])
print({'characters': len(characters), 'bytes': pathlib.Path(sys.argv[2]).stat().st_size})
