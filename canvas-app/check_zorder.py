"""Z-order gate for the authored canvas screens.

    python canvas-app/check_zorder.py

In a .pa.yaml screen, DECLARATION ORDER IS Z-ORDER and later means on top.
_EditorState.pa.yaml carries no z-index, so the file order is the only thing
deciding what paints over what.

That makes modal overlays positional, and getting it wrong is silent: the app
opens fine in Studio, the formulas are all correct, and the defect only shows
when a human plays the app and taps the thing. Since every play costs a manual
Studio save + publish, the feedback loop is far too slow to find it by eye.

The real defect this was written against (2026-09-07, commit dd4d882): the
PM-proxy crew picker was inserted into Screen1 ABOVE galToday, so the today's
work gallery painted straight over the scrim, the picker card and the crew
list. scr_Tasks had it right all along -- its confirm and N/A overlays are
declared after galTasks -- so the two screens disagreed and only one was wrong.

The rule enforced here:

    A full-screen scrim opens an overlay group. Every control declared after
    it, up to the next scrim, must be gated by the same global the scrim is
    gated by -- otherwise that control paints on top of the modal.

A scrim is any control sized Height: =Parent.Height and Width: =Parent.Width
that carries a Visible. Stacked modals are fine: the next scrim starts a new
group, which is why scr_Tasks' gblConfirmOpen and gblNAOpen overlays both pass.
"""
import glob, os, re, sys

try:
    import yaml
except ImportError:
    sys.exit('pyyaml is required: python -m pip install pyyaml')

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src', 'Src')
GLOBAL = re.compile(r'\bgbl\w+')


def children_of(screen):
    """Top-level children in declaration order, as (name, properties) pairs."""
    out = []
    for entry in screen.get('Children') or []:
        for name, body in entry.items():
            out.append((name, (body or {}).get('Properties') or {}))
    return out


def is_scrim(props):
    return (str(props.get('Height', '')).strip() == '=Parent.Height'
            and str(props.get('Width', '')).strip() == '=Parent.Width'
            and 'Visible' in props)


def check(path):
    doc = yaml.safe_load(open(path, encoding='utf-8')) or {}
    problems = []
    for screen_name, screen in (doc.get('Screens') or {}).items():
        controls = children_of(screen)
        scrims = [i for i, (_, p) in enumerate(controls) if is_scrim(p)]
        for n, start in enumerate(scrims):
            end = scrims[n + 1] if n + 1 < len(scrims) else len(controls)
            scrim_name, scrim_props = controls[start]
            gates = set(GLOBAL.findall(str(scrim_props.get('Visible', ''))))
            if not gates:
                continue
            for name, props in controls[start + 1:end]:
                seen = set(GLOBAL.findall(str(props.get('Visible', ''))))
                if not (seen & gates):
                    problems.append(
                        '%s / %s: "%s" is declared after the scrim "%s" but is not '
                        'gated by %s, so it paints on top of that overlay. Move it '
                        'above the scrim.'
                        % (os.path.basename(path), screen_name, name, scrim_name,
                           ' or '.join(sorted(gates))))
    return problems


def gate():
    """Returns a list of problem strings; empty means the screens are sound."""
    problems = []
    for f in sorted(glob.glob(os.path.join(SRC, '*.pa.yaml'))):
        problems += check(f)
    return problems


def main():
    problems = gate()
    if problems:
        print('Z-ORDER FAIL')
        for p in problems:
            print('  ' + p)
        return 1
    print('Z-order gate passed (%d screen files).'
          % len(glob.glob(os.path.join(SRC, '*.pa.yaml'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
