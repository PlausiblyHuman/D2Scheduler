"""Build the D2 Build Scheduler site logo from D2's own brand mark.

    python sharepoint/make-site-logo.py

D2's logo as published on d2pools.com is WHITE ON TRANSPARENT
(assets/d2-logo-source-white.png, 190x190). SharePoint renders the site logo
against a white header, so the source file used directly is invisible. This
composites it onto D2's navy so the mark actually reads.

Colours are measured, not guessed. Reading computed styles off d2pools.com gave
#082544 navy as the dominant brand colour and #0B594B as the accent; the same
two drive the SharePoint theme in brand-site.js.

IMAGERY LICENSING -- this is why there is no header photo. The hero images on
d2pools.com are licensed Getty stock (GettyImages-134108091, -1364656744,
-521154563). D2 holds a licence for their marketing site; that almost certainly
does not extend to copying them into their SharePoint tenant, so none were used.
The logo is different: it is D2's own mark on D2's own site, going onto D2's own
intranet. If a real header photo is wanted later it needs to come from D2's own
project photography, which someone has to supply.

Output is quantised to 12 colours because the image is effectively two flat
tones plus antialiasing: 42KB -> 3.2KB with no visible loss, which matters
because it has to be inlined as base64 to upload through the browser.
"""
import os
from PIL import Image

NAVY = (8, 37, 68, 255)          # #082544
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'assets', 'd2-logo-source-white.png')
OUT = os.path.join(HERE, 'assets', 'd2-logo-160.png')

mark = Image.open(SRC).convert('RGBA')

# Trim the source file's own transparent margin so the padding below is ours.
mark = mark.crop(mark.split()[-1].getbbox())

SIZE, PAD = 160, 0.14
canvas = Image.new('RGBA', (SIZE, SIZE), NAVY)
inner = int(SIZE * (1 - 2 * PAD))
w, h = mark.size
scale = inner / max(w, h)
m = mark.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
canvas.paste(m, ((SIZE - m.size[0]) // 2, (SIZE - m.size[1]) // 2), m)

canvas.convert('RGB').quantize(colors=12, method=Image.MEDIANCUT).save(OUT, optimize=True)
print('wrote %s (%d bytes)' % (OUT, os.path.getsize(OUT)))
