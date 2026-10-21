r"""Offline half of the 2026-10-21 flow changes (projects own their structure, step 3).

This machine has no Azure CLI, so the Dataverse reads and writes go through the signed-in browser
(the Dataverse Web API accepts the session cookie on org4ed2f722.crm.dynamics.com). This script does
everything else:

  build  <live-dir>   reads live-<flow>.txt (the workflows row's clientdata, as saved from the
                      browser), checks live equals the newest export before the change, writes a
                      backup to flows/exports/backups/, applies the builder and writes
                      new-<flow>.json (clientdata, ASCII-escaped) beside the input.
  verify <live-dir>   reads after-<flow>.txt (clientdata read back after PATCH + PublishXml) and
                      checks the published actions equal what the builder produced.
"""
import json, pathlib, sys
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import new_pool_features, reschedule_skip_na, counter_recon_chunk

EXPORTS = HERE.parent / 'exports'
FLOWS = {
    'newpool':    ('D2-New-Pool', new_pool_features.apply, 'Compose_is_na', 'features'),
    'reschedule': ('D2-Reschedule-Pool', reschedule_skip_na.apply, '(not applicable)', 'skip-na'),
    'counter':    ('D2-Counter-Reconciliation', counter_recon_chunk.apply, 'Init_job_tasks', 'chunk'),
}
STRIP = '"authentication": "@parameters(\'$authentication\')", '


def read_clientdata(p):
    text = p.read_text(encoding='utf-8').strip()
    obj = json.loads(text)
    return json.loads(obj) if isinstance(obj, str) else obj      # saved as a JSON string or as the object


def norm(actions):
    return json.loads(json.dumps(actions).replace(STRIP, ''))


def build(d):
    for key, (prefix, apply, marker, tag) in FLOWS.items():
        cd = read_clientdata(d / f'live-{key}.txt')
        live = cd['properties']['definition']['actions']
        exports = sorted(EXPORTS.glob(prefix + '-*.json'))
        base = [p for p in exports if marker not in json.dumps(json.loads(p.read_text(encoding='utf-8'))['definition']['actions'])][-1]
        exp = json.loads(base.read_text(encoding='utf-8'))['definition']['actions']
        assert norm(live) == norm(exp), f'{key}: live differs from {base.name}; rebuild against live before pushing'
        bak = EXPORTS / 'backups' / f'{prefix}-pre-{tag}.json'
        bak.write_text(json.dumps(cd, indent=1, ensure_ascii=False), encoding='utf-8')
        cd['properties']['definition']['actions'] = apply(live)
        (d / f'new-{key}.json').write_text(json.dumps(cd, ensure_ascii=True), encoding='ascii')
        print(f'{key}: live == {base.name}; backup {bak.name}; new-{key}.json written')


def verify(d):
    bad = 0
    for key in FLOWS:
        want = json.loads((d / f'new-{key}.json').read_text(encoding='ascii'))['properties']['definition']['actions']
        got = read_clientdata(d / f'after-{key}.txt')['properties']['definition']['actions']
        same = norm(got) == norm(want)
        bad += not same
        print(f'{key}: published {"EQUALS" if same else "DIFFERS FROM"} the built definition')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    {'build': build, 'verify': verify}[sys.argv[1]](pathlib.Path(sys.argv[2]))
