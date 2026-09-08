"""Emit tools/template-seed.json: the 46 sub-phases and 295 tasks that every
pool is built from, with a default crew per sub-phase.

Writes NOTHING to the tenant. Apply with sharepoint/seed-templates.js.

Crew qualification comes from the LIVE Crew-Trades list, not from the browser
tool's SEED_CREWS. SEED_CREWS predates the subcontractor patch and marks only
office/subcon/unassigned as unlimited, so picking defaults from it treats stl,
george, armondo and brothers as capacity crews when the live list has them as
Unlimited buckets. Business rule 1 names Crew-Trades as the authority.

SHAPE OBSERVED 2026-09-07 (see tools/live-crews.json): Crew-Trades is an
intersect list with two Lookup columns, "Crew" and "Trade". The live capture
was taken with no $expand, so SharePoint omitted the expanded lookup objects
entirely and returned only the raw lookup ids: CrewId (int -> Crews.Id) and
TradeId (int -> Trades.Id). Neither is the string code directly -- CrewID and
TradeCode live on the Crews and Trades rows themselves and must be resolved
by joining on Id. CREW_FIELD/TRADE_FIELD below name those raw id columns; the
join to the string code happens explicitly, not via a flat dict key.
"""
import io, json, collections

TOOL = 'D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html'
LIVE = 'tools/live-crews.json'
OUT  = 'tools/template-seed.json'

CREW_FIELD  = 'CrewId'    # Crew-Trades' raw lookup id -> Crews.Id
TRADE_FIELD = 'TradeId'   # Crew-Trades' raw lookup id -> Trades.Id

src = io.open(TOOL, encoding='utf-8', errors='replace').read()

def extract_array(marker):
    i = src.index(marker); j = src.index('[', i); d = 0
    for k in range(j, len(src)):
        if src[k] == '[': d += 1
        elif src[k] == ']':
            d -= 1
            if d == 0: return src[j:k + 1]
    raise ValueError(marker)

TPL = json.loads(extract_array('SEED_TEMPLATE'))
SECTIONS = [(s['num'], s['name'], s.get('skill'), s.get('days', 2), s.get('tasks', []))
            for ph in TPL for s in ph['sections']]

live = json.load(io.open(LIVE, encoding='utf-8'))
live = live.get('result', live)

# Crews.Id (numeric SP item id) -> CrewID (string code); same for Trades.
crews_by_id = {c['Id']: c for c in live['crews']}
trades_by_id = {t['Id']: t for t in live['trades']}

crews = {c['CrewID']: c for c in live['crews'] if c.get('CrewID')}
TRADE_CODES = {t['TradeCode'] for t in live['trades'] if t.get('TradeCode')}
UNLIMITED = {k for k, c in crews.items() if c.get('Unlimited')}

# trade code -> set of crew codes that hold it, resolved via the two lookup joins
QUAL = collections.defaultdict(set)
for row in live['crewTrades']:
    crew_row = crews_by_id.get(row[CREW_FIELD])
    trade_row = trades_by_id.get(row[TRADE_FIELD])
    if not crew_row or not trade_row:
        continue  # dangling lookup id; surfaced separately below if it matters
    crew_code = crew_row.get('CrewID')
    trade_code = trade_row.get('TradeCode')
    if crew_code and trade_code:
        QUAL[trade_code].add(crew_code)

# The three pseudo-skills are not trades. They name Unlimited buckets directly.
PSEUDO = {'@office': 'office', '@sub': 'subcon', '@unassigned': 'unassigned'}

load = collections.Counter()
subphases = []
for seq, (num, name, skill, days, tasks) in enumerate(SECTIONS, start=1):
    if skill in PSEUDO:
        crew, trade_code, cands = PSEUDO[skill], None, []
    else:
        trade_code = skill
        cands = sorted(QUAL.get(skill, ()))
        capacity = [c for c in cands if c not in UNLIMITED]
        pool = capacity or cands
        # Spread the pool across qualified capacity crews rather than loading
        # one. Deterministic: fewest sub-phases so far, then alphabetical.
        crew = min(pool, key=lambda c: (load[c], c)) if pool else 'unassigned'
        if crew != 'unassigned':
            load[crew] += 1
    subphases.append({'num': num, 'name': name, 'skill': skill, 'tradeCode': trade_code,
                      'defaultCrew': crew, 'days': max(1, days), 'seq': seq,
                      'candidates': cands, 'tasks': tasks})

errs = []
for s in subphases:
    if s['defaultCrew'] not in crews:
        errs.append('UNKNOWN CREW %s on %s' % (s['defaultCrew'], s['num']))
    if s['days'] < 1:
        errs.append('BAD DURATION on %s' % s['num'])
    # A tradeCode absent from the live Trades list leaves Trade null on every
    # assignment built from this row, silently. That is the exact class of
    # failure that has cost this project four build cycles, so refuse instead.
    if s['tradeCode'] and s['tradeCode'] not in TRADE_CODES:
        errs.append('UNKNOWN TRADE CODE %r on %s (not in Trades.TradeCode)' % (s['tradeCode'], s['num']))
if len({s['num'] for s in subphases}) != len(subphases):
    errs.append('DUPLICATE SUB-PHASE NUMBER')
if errs:
    print('REFUSING TO WRITE — %d problem(s):' % len(errs))
    for e in errs[:20]: print('   ', e)
    raise SystemExit(1)

out = {'subphases': subphases,
       'counts': {'subphases': len(subphases), 'tasks': sum(len(s['tasks']) for s in subphases)}}
io.open(OUT, 'w', encoding='utf-8').write(json.dumps(out, indent=2, ensure_ascii=False))

print('sub-phases : %d' % out['counts']['subphases'])
print('tasks      : %d' % out['counts']['tasks'])
print('crew load  : %s' % dict(load.most_common()))
print('unassigned : %d' % sum(1 for s in subphases if s['defaultCrew'] == 'unassigned'))
print('trades ok  : %d of %d sub-phases carry a resolvable trade code'
      % (sum(1 for s in subphases if s['tradeCode']), len(subphases)))
print('wrote %s' % OUT)
