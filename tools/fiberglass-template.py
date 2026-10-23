# tools/fiberglass-template.py
"""Build the Fiberglass template from Don's sheet (the TSV saved from his 2026-10-10 email).

Applies the decisions in docs/specs/2026-10-13-build-type-templates-design.md section 2, except
the Phase 7 merge, replaced 2026-10-23: phases are numbered by their place in the sheet (0 to 10),
because the sheet's own numbering stopped short after Electrical was split out of Plumbing and left
two Phase 7s. Startup and Trim Out is Phase 8, Site Restoration 9, Post Construction 10, and each
sub-phase takes its phase's number. Phase names come from the PHASE heading rows (Task Name
column); sub-phase numbers come from the Task Name column; every Task row is a task; the untyped
punch-list note row is dropped; durations are 2; trade comes from the Gunite 46 by the name table.
Writes nothing to the tenant.
"""
import csv, io, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'source' / 'Fiberglass Build Phase_Rev1_091726.tsv'
DATA = ROOT / 'D2-Build-Scheduler' / 'D2-Build-Scheduler' / 'data'
GUNITE = DATA / 'sub-phase-template.csv'

PHASE_NAMES = {
    '0': 'Pre Construction/Sales', '1': 'Preconstruction Back Office Admin',
    '2': 'Base Preparation and Shell Set', '3': 'Plumbing Rough-In', '4': 'Electrical Rough-In',
    '5': 'Backfill and Water Fill', '6': 'Coping and Decking',
    '7': 'Equipment Installation', '8': 'Startup and Trim Out',
    '9': 'Site Restoration and Final Grade', '10': 'Post Construction Completion Phase',
}
# Fiberglass sub-phase number (after renumbering) -> Gunite sub-phase number whose trade and
# assignment it takes.
GUNITE_MATCH = {
    '0.0': '0.0', '1.0': '1.0', '1.1': '1.1', '1.2': '1.2', '3.1': '3.1', '3.3': '3.3',
    '1.4': '1.3', '1.5': '1.4', '1.6': '1.5', '1.7': '1.6',
    '3.2': '3.2',
    '4.1': '3.4', '4.2': '3.5', '4.3': '3.6', '4.4': '3.7',
    '6.1': '2.3',
    '6.2': '5.4', '6.3': '5.3', '6.4': '5.5', '6.5': '5.6', '6.6': '5.7', '6.7': '5.8',
    '7.1': '6.2', '7.2': '6.1', '7.3': '6.3',
    '8.2': '6.6', '8.3': '6.7',
    '10.0': '6.8', '10.1': '7.0',
}
OFFICE_EXCEPTIONS = {'0.1', '1.3'}
ASSIGN_TO_SKILL = {'Main Office': '@office', 'Subcontractor': '@sub', 'Unassigned': '@unassigned'}

gunite = {r['SubPhaseNumber']: r for r in csv.DictReader(io.open(GUNITE, encoding='utf-8-sig'))}

def skill_for(num):
    if num in OFFICE_EXCEPTIONS:
        return '@office', '', '', 'Main Office'
    g = gunite.get(GUNITE_MATCH.get(num, ''))
    if not g:
        return '@unassigned', '', '', 'Unassigned'
    if g['TradeCode']:
        return g['TradeCode'], g['TradeCode'], g['TradeName'], g['AssignTo']
    return ASSIGN_TO_SKILL[g['AssignTo']], '', '', g['AssignTo']

phases, cur_phase, cur_sec = [], None, None
for row in csv.DictReader(io.open(SRC, encoding='utf-8'), delimiter='\t'):
    name, kind = row['Task Name'].strip(), (row['Row Type'] or '').strip()
    if kind == 'Phase':
        assert re.match(r'PHASE (\d+)\.', name), name
        pnum = str(len(phases))           # the sheet's place, not its printed number
        cur_phase = {'num': pnum, 'name': PHASE_NAMES[pnum], 'sections': []}
        phases.append(cur_phase)
    elif kind == 'Section':
        num, sname = name.split(' ', 1)
        num = cur_phase['num'] + '.' + num.split('.', 1)[1]   # the sub-phase takes its phase's number
        cur_sec = {'num': num, 'name': sname, 'skill': skill_for(num)[0], 'days': 2, 'tasks': []}
        cur_phase['sections'].append(cur_sec)
    elif kind == 'Task':
        cur_sec['tasks'].append(name)
    # untyped rows (the punch-list note) are dropped

assert [p['num'] for p in phases] == [str(i) for i in range(11)], [p['num'] for p in phases]
secs = [s for p in phases for s in p['sections']]
assert len(secs) == 45 and len({s['num'] for s in secs}) == 45, len(secs)

io.open(DATA / 'fiberglass-template.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(phases, indent=1, ensure_ascii=False) + '\n')
with io.open(DATA / 'fiberglass-sub-phase-template.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    w.writerow(['SubPhaseNumber','SubPhaseName','PhaseNumber','PhaseName','TradeCode','TradeName','AssignTo','DefaultDurationDays','Sequence','TaskCount'])
    seq = 0
    for p in phases:
        for s in p['sections']:
            seq += 1
            _, code, tname, assign = skill_for(s['num'])
            w.writerow([s['num'], s['name'], p['num'] + '.0', p['name'], code, tname, assign, s['days'], seq, len(s['tasks'])])
with io.open(DATA / 'fiberglass-task-template.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    w.writerow(['SubPhaseNumber','SubPhaseName','TaskName','Sequence'])
    for s in secs:
        for i, t in enumerate(s['tasks'], 1):
            w.writerow([s['num'], s['name'], t, i])
print('phases %d  sub-phases %d  tasks %d' % (len(phases), len(secs), sum(len(s['tasks']) for s in secs)))
