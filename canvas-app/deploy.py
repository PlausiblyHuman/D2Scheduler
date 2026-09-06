"""Deploy the YAML-authored canvas app to D2 Automation, with no Studio in the chain.

    python canvas-app/deploy.py

Steps: pack Src/*.pa.yaml into an .msapp, export the D2BuildScheduler solution,
swap the packed .msapp in, re-import the solution, then download and diff to prove
what actually landed.

Why the swap works: customizations.xml references the app by path
(<DocumentUri>/CanvasApps/..._DocumentUri.msapp</DocumentUri>) with no hash or
checksum, so substituting the file is accepted.

Why the connections survive: they live in the .msapr residual
(References/DataSources.json and Properties.json's LocalConnectionReferences),
which `pac canvas unpack` writes alongside Src/ and `pack` folds back in. Never
delete the .msapr, and never rebuild sources from a blank app.

AFTER DEPLOY: open the app in Studio once and Publish. Studio validates the YAML
and reports precise errors (file, line, column, e.g. PA2109 for a bad control
variant). `pac canvas download` reads the PUBLISHED version, so a Studio Save
alone is invisible to this script.
"""
import os, subprocess, sys, zipfile

ENV      = '2710a01b-6cfa-e820-b338-2286f2649300'
SOLUTION = 'D2BuildScheduler'
APP      = 'D2 Sign-off'
TARGET   = 'CanvasApps/d2s_d2signoff_4f928_DocumentUri.msapp'

ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC    = os.path.join(ROOT, 'canvas-app', 'src')
PACKED = os.path.join(ROOT, 'canvas-app', 'msapp', 'D2-Sign-off-authored.msapp')
EXPORT = os.path.join(ROOT, 'canvas-app', 'solution-export')
ZIP    = os.path.join(EXPORT, SOLUTION + '.zip')
PATCH  = os.path.join(EXPORT, SOLUTION + '-patched.zip')


def run(*args):
    print('$ ' + ' '.join(args))
    r = subprocess.run(args, capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    print('\n'.join(l for l in out.splitlines() if l.strip())[-1200:])
    if r.returncode != 0:
        sys.exit('FAILED: %s' % args[0])
    return out


os.makedirs(EXPORT, exist_ok=True)

run('pac', 'canvas', 'pack', '--sources', SRC, '--msapp', PACKED,
    '--layout', 'SourceCode', '--overwrite')

run('pac', 'solution', 'export', '--path', ZIP, '--name', SOLUTION,
    '--managed', 'false', '--overwrite')

new = open(PACKED, 'rb').read()
zin = zipfile.ZipFile(ZIP)
if TARGET not in zin.namelist():
    sys.exit('target missing from solution zip: %s\nfound: %s' % (TARGET, zin.namelist()))
zout = zipfile.ZipFile(PATCH, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename == TARGET:
        print('swapping %s: %d -> %d bytes' % (item.filename, len(data), len(new)))
        data = new
    zout.writestr(item, data)
zout.close()

run('pac', 'solution', 'import', '--path', PATCH,
    '--publish-changes', '--force-overwrite')

print('\nDeployed. Now open "%s" in Power Apps Studio and Publish, so that Studio '
      'validates the YAML and the change becomes the published version.' % APP)
