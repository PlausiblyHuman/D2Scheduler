"""Deploy the YAML-authored canvas app to D2 Automation.

    python canvas-app/deploy.py

This gets the YAML into the tenant. It does NOT finish the job on its own -- a
manual Studio save is required afterwards, for the reason set out below.

Steps: parse every *.pa.yaml as a syntax gate, pack Src/*.pa.yaml into an
.msapp, export the D2BuildScheduler solution, swap the packed .msapp in, and
re-import the solution.

Why the swap works: customizations.xml references the app by path
(<DocumentUri>/CanvasApps/..._DocumentUri.msapp</DocumentUri>) with no hash or
checksum, so substituting the file is accepted.

Why the connections survive: they live in the .msapr residual
(References/DataSources.json and Properties.json's LocalConnectionReferences),
which `pac canvas unpack` writes alongside Src/ and `pack` folds back in. Never
delete the .msapr, and never rebuild sources from a blank app.

AFTER DEPLOY -- MANDATORY, and not merely a validation step:

    1. Open the app in Power Apps Studio (Edit).
    2. Select any control, press Down arrow then Up arrow. That is a 1px move
       and back: no net change, but it marks the document dirty.
    3. Ctrl+S and wait for "Saved".
    4. Publish -> Publish this version.

Step 2 is the whole point. Studio renders from Src/*.pa.yaml, but the PLAYER
renders from the compiled control model in Controls/*.json -- and `pac canvas
pack` never compiles anything, it copies Controls/*.json verbatim out of the
.msapr residual. So without a dirty save the app looks correct in Studio and
serves the OLD screens in the player, silently, with no error anywhere. Studio
only writes a new published version when the document actually changed, so
Publish on its own re-publishes the previous version forever.

Verifying, and the distinction matters -- both halves were learned the hard way:

  * BEFORE a Studio save, `pac canvas download` just hands back the artifact
    this script imported. It will happily "confirm" a change the player is not
    serving. Believing it is how this loop was first recorded as working when
    it was not.
  * AFTER a Studio save it is trustworthy, and it is the ONLY way to see which
    formulas Studio actually kept. A downloaded msapp with no packed.json was
    re-serialized by Studio; read Src/*.pa.yaml out of it and grep for the
    formula you deployed. That check caught a deploy silently reverted by a
    stale Studio tab, which nothing else would have shown.

  So: PLAY the app to prove runtime behaviour, and download-then-grep to prove
  the formula survived. A flow that records zero runs is the classic symptom of
  a change that never made it in.

First play after a rebuild prompts for connection consent (SharePoint +
Office 365 Users). Until Allow is clicked the galleries are empty.
"""
import glob, os, subprocess, sys, zipfile

try:
    import yaml
except ImportError:
    sys.exit('pyyaml is required for the pre-pack syntax gate: python -m pip install pyyaml')

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

# Syntax gate. `pac canvas pack` does NOT parse the YAML -- it packs invalid
# files without complaint, so the first sign of a syntax error is Studio
# refusing to open the app, which costs a manual round-trip to discover.
# Parsing locally catches that class outright. Proven against the real defect:
# a plain scalar containing ": " (e.g. ="Sign off: " & x) reads as a mapping,
# and Studio reports it as PA1001 YamlInvalidSyntax at the same line/column
# this gate does. Use a block scalar for any formula containing ": ".
failed = False
for f in sorted(glob.glob(os.path.join(SRC, 'Src', '*.pa.yaml'))):
    try:
        yaml.safe_load(open(f, encoding='utf-8'))
    except yaml.YAMLError as e:
        failed = True
        mark = getattr(e, 'problem_mark', None)
        where = '(%d,%d)' % (mark.line + 1, mark.column + 1) if mark else ''
        print('YAML FAIL %s%s : %s' % (os.path.basename(f), where, getattr(e, 'problem', e)))
if failed:
    sys.exit('Fix the YAML above before deploying.')
print('YAML syntax gate passed.')

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

print("""
Imported -- but the player is still serving the OLD screens until you do this:

  0. CLOSE any open Studio tab for this app FIRST, then open it fresh.
     Studio holds the app in memory from when the tab was opened. If a tab
     was already open when this script ran, its stale copy silently
     OVERWRITES this deploy on save. Observed 2026-09-07: a wiring change
     was reverted exactly this way, with no warning anywhere.
  1. Open "%s" in Power Apps Studio (Edit).
  2. Select any control, press Down arrow then Up arrow (1px move and back).
     Without this the document is not dirty and Publish is a no-op.
  3. Ctrl+S, wait for "Saved".
  4. Publish -> Publish this version.
  5. Verify by PLAYING the app. Never verify with `pac canvas download`.
""" % APP)
