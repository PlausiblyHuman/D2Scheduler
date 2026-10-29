r"""Push the 2026-10-29 rating change to D2 - Crew Trade Check.

  python flows/scripts/2026-10-29-crew-trade-check-preferences.py check   # read live, compare, build; writes nothing
  python flows/scripts/2026-10-29-crew-trade-check-preferences.py push    # same, then back up, PATCH, PublishXml, verify, export

Reads and writes the Dataverse workflows row with a token from `az` (the caller pins az to the D2
tenant first); never through `az rest`, whose output loses non-cp1252 characters. The definition is
sent ASCII-escaped, so no glyph can be lost on the way.
"""
import json, pathlib, subprocess, sys, urllib.request, urllib.error
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import crew_trade_check_preferences

ORG = 'https://org4ed2f722.crm.dynamics.com'
WF = 'a5f50628-eead-f111-aaac-6045bd0195dd'          # D2 - Crew Trade Check, Dataverse workflowid
EXPORTS = HERE.parent / 'exports'
STRIP = '"authentication": "@parameters(\'$authentication\')", '


def token():
    out = subprocess.run(['az', 'account', 'get-access-token', '--resource', ORG + '/', '--query', 'accessToken', '-o', 'tsv'],
                         capture_output=True, text=True, shell=(sys.platform == 'win32'))
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit('could not get a Dataverse token: ' + out.stderr[-400:])
    return out.stdout.strip()


TOKEN = None


def call(method, url, body=None):
    global TOKEN
    TOKEN = TOKEN or token()
    data = None if body is None else json.dumps(body, ensure_ascii=True).encode('ascii')
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/json',
        'Content-Type': 'application/json', 'OData-Version': '4.0'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            text = r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        raise SystemExit(method + ' ' + url + ' -> ' + str(e.code) + ' ' + e.read().decode('utf-8', 'replace')[:800])
    return json.loads(text) if text.strip() else None


def norm(actions):
    return json.loads(json.dumps(actions).replace(STRIP, ''))


def read_live():
    row = call('GET', f'{ORG}/api/data/v9.2/workflows({WF})?$select=clientdata,statecode')
    return json.loads(row['clientdata'])


def main(mode):
    cd = read_live()
    live = cd['properties']['definition']['actions']
    base = EXPORTS / 'D2-Crew-Trade-Check-2026-10-01.json'
    exp = json.loads(base.read_text(encoding='utf-8'))['definition']['actions']
    if norm(live) != norm(exp):
        diff = sorted(k for k in set(live) | set(exp) if norm({k: live.get(k)}) != norm({k: exp.get(k)}))
        raise SystemExit('live differs from ' + base.name + ' in: ' + ', '.join(diff) + '; rebuild against live before pushing')
    want = crew_trade_check_preferences.apply(json.loads(json.dumps(live)))
    added = sorted(set(want) - set(live))
    print('live == ' + base.name + '; builder adds top-level: ' + ', '.join(added)
          + '; Init_never present: ' + str('Init_never' in want))
    if mode != 'push':
        return
    bak = EXPORTS / 'backups' / 'D2-Crew-Trade-Check-pre-preferences.json'
    bak.write_text(json.dumps(cd, indent=1, ensure_ascii=False), encoding='utf-8')
    cd['properties']['definition']['actions'] = want
    call('PATCH', f'{ORG}/api/data/v9.2/workflows({WF})',
         body={'clientdata': json.dumps(cd, ensure_ascii=True)})
    call('POST', f'{ORG}/api/data/v9.2/PublishXml',
         body={'ParameterXml': '<importexportxml><workflows><workflow>{' + WF + '}</workflow></workflows></importexportxml>'})
    after = read_live()
    same = norm(after['properties']['definition']['actions']) == norm(want)
    print('published definition ' + ('EQUALS' if same else 'DIFFERS FROM') + ' the built one')
    if not same:
        raise SystemExit(1)
    out = json.loads(base.read_text(encoding='utf-8'))
    out['definition'] = after['properties']['definition']
    (EXPORTS / 'D2-Crew-Trade-Check-2026-10-29.json').write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding='utf-8')
    print('export D2-Crew-Trade-Check-2026-10-29.json written; backup ' + bak.name)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'check')
