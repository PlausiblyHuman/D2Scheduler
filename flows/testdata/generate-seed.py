"""Generate TEST-9001/TEST-9002 seed assignments for exercising Flows 4 and 5.

Reads the real 46 sub-phase template out of the browser tool so the seeded data
mirrors production shape (skills, durations, task counts).

Emits a plan JSON only -- writes nothing to SharePoint. Review the plan, then
feed it to the browser REST seeder.

Rules honoured:
  - Mon-Sat are work days, Sunday is not (business rule 4)
  - Sub-phases run in order; N+1 starts after N ends (business rule 3)
  - A capacity crew is never on two pools the same day (business rule 2)
  - Crews only take sub-phases whose trade they hold (business rule 1)
"""
import io, json, re, datetime as dt

TOOL = 'D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html'
TODAY = dt.date(2026, 9, 3)
WINDOW_BACK, WINDOW_FWD = 14, 28

src = io.open(TOOL, encoding='utf-8', errors='replace').read()


def extract_array(marker):
    i = src.index(marker)
    j = src.index('[', i)
    d = 0
    for k in range(j, len(src)):
        if src[k] == '[':
            d += 1
        elif src[k] == ']':
            d -= 1
            if d == 0:
                return src[j:k + 1]
    raise ValueError(marker)


TPL = json.loads(extract_array('SEED_TEMPLATE'))

# SEED_CREWS is JS-literal, not JSON -- pull the fields we need with a regex.
crew_src = extract_array('SEED_CREWS = ')
CREWS = []
for m in re.finditer(r"\{id:'([a-z]+)'.*?skills:\[([^\]]*)\]", crew_src, re.S):
    cid, sk = m.group(1), m.group(2)
    skills = re.findall(r"'([^']+)'", sk)
    unlimited = bool(re.search(r"id:'%s'.*?unlimited:true" % cid, crew_src, re.S))
    CREWS.append({'id': cid, 'skills': skills, 'unlimited': unlimited})

FIXED = {'@office': 'office', '@sub': 'subcon', '@unassigned': 'unassigned'}
UNLIMITED = {'office', 'subcon', 'unassigned', 'george', 'armondo', 'stl', 'brothers'}


def qualified(skill):
    if skill in FIXED:
        return [FIXED[skill]]
    out = [c['id'] for c in CREWS if skill in c['skills']]
    return out or ['unassigned']


def is_work(d):
    return d.weekday() != 6            # 6 == Sunday


def next_work(d):
    while not is_work(d):
        d += dt.timedelta(days=1)
    return d


def span(start, ndays):
    """ndays work days starting at (or after) start."""
    out, d = [], next_work(start)
    while len(out) < ndays:
        if is_work(d):
            out.append(d)
        d += dt.timedelta(days=1)
    return out


SECTIONS = [(s['num'], s['name'], s.get('skill'), s.get('days', 2), len(s.get('tasks', [])))
            for ph in TPL for s in ph['sections']]

busy = {}          # (crewid, isodate) -> job, for capacity crews only
load = {}          # crewid -> days assigned so far, for balancing
plan = []

# Pre-load the 5 real Harrison D2-1001 rows so seeded work never collides with them.
EXISTING = [('devon', '2026-08-31', '2026-09-01'), ('devon', '2026-09-02', '2026-09-05'),
            ('antonio', '2026-09-04', '2026-09-05'), ('stl', '2026-09-06', '2026-09-07'),
            ('harrison', '2026-09-09', '2026-09-10')]
for c, s, f in EXISTING:
    if c in UNLIMITED:
        continue
    d, end = dt.date.fromisoformat(s), dt.date.fromisoformat(f)
    while d <= end:
        busy[(c, d.isoformat())] = 'D2-1001'
        d += dt.timedelta(days=1)

JOBS = [
    {'num': 'TEST-9001', 'title': 'Sandbox Ridge',
     'addr': '1400 Sandbox Ridge Dr', 'city': 'Frisco', 'start': TODAY - dt.timedelta(days=38)},
    {'num': 'TEST-9002', 'title': 'Sandbox Vista',
     'addr': '2200 Vista Sandbox Ln', 'city': 'Plano', 'start': TODAY - dt.timedelta(days=16)},
]

for job in JOBS:
    cursor = next_work(job['start'])
    for num, name, skill, days, ntasks in SECTIONS:
        days_list = span(cursor, days)
        s, f = days_list[0], days_list[-1]
        cands = qualified(skill)
        if skill in FIXED:
            pick = FIXED[skill]                # only @-codes are pinned to a bucket
        else:
            # Unlimited subcontractors (stl, george, armondo, brothers) compete
            # normally -- they just never block on capacity.
            free = [c for c in cands
                    if c in UNLIMITED
                    or all((c, d.isoformat()) not in busy for d in days_list)]
            # least-loaded qualified crew, ties broken by name for determinism
            pick = min(free, key=lambda c: (load.get(c, 0), c)) if free else 'unassigned'
        if pick not in UNLIMITED:
            for d in days_list:
                busy[(pick, d.isoformat())] = job['num']
        # count load for every crew so work spreads, unlimited included
        load[pick] = load.get(pick, 0) + len(days_list)
        plan.append({'job': job['num'], 'num': num, 'name': name, 'crew': pick,
                     'start': s.isoformat(), 'finish': f.isoformat(),
                     'days': days, 'tasksTotal': ntasks})
        cursor = f + dt.timedelta(days=1)

# keep only what the daily/weekly summaries can actually see
lo = (TODAY - dt.timedelta(days=WINDOW_BACK)).isoformat()
hi = (TODAY + dt.timedelta(days=WINDOW_FWD)).isoformat()
plan = [p for p in plan if p['finish'] >= lo and p['start'] <= hi]

# sign-off state: past work mostly signed, in-flight partial, future untouched
for p in plan:
    if p['finish'] < TODAY.isoformat():
        signed = (hash(p['job'] + p['num']) % 10) < 7        # ~70% compliance
        p['installerSignOff'] = signed
        p['tasksComplete'] = p['tasksTotal'] if signed else max(1, p['tasksTotal'] - 2)
    elif p['start'] <= TODAY.isoformat() <= p['finish']:
        p['installerSignOff'] = False
        p['tasksComplete'] = p['tasksTotal'] // 2
    else:
        p['installerSignOff'] = False
        p['tasksComplete'] = 0

# ---- verify business rules before anything is written ----
errs = []
seen = {}
for p in plan:
    if p['crew'] in UNLIMITED:
        continue
    d = dt.date.fromisoformat(p['start'])
    end = dt.date.fromisoformat(p['finish'])
    while d <= end:
        k = (p['crew'], d.isoformat())
        if k in seen:
            errs.append('DOUBLE-BOOK %s on %s: %s vs %s' % (p['crew'], d, seen[k], p['num']))
        seen[k] = p['job'] + ' ' + p['num']
        d += dt.timedelta(days=1)
    if not is_work(dt.date.fromisoformat(p['start'])):
        errs.append('SUNDAY START %s %s' % (p['job'], p['num']))

out = {'generatedFor': TODAY.isoformat(), 'jobs': JOBS, 'assignments': plan}
for j in out['jobs']:
    j['start'] = j['start'].isoformat()
io.open('flows/testdata/seed-plan.json', 'w', encoding='utf-8').write(
    json.dumps(out, indent=2))

print('template sub-phases : %d' % len(SECTIONS))
print('assignments in window: %d  (%s .. %s)' % (len(plan), lo, hi))
print('rule violations      : %d' % len(errs))
for e in errs[:10]:
    print('   ', e)
past = [p for p in plan if p['finish'] < TODAY.isoformat()]
sign = [p for p in past if p['installerSignOff']]
print('finished             : %d, signed %d -> compliance %d%%'
      % (len(past), len(sign), (100 * len(sign) // len(past)) if past else 100))
print('crews used           : %s' % sorted({p['crew'] for p in plan}))
print()
for p in plan[:8]:
    print('  %-10s %-5s %-42s %-11s %s..%s' % (p['job'], p['num'], p['name'][:42], p['crew'],
                                               p['start'], p['finish']))
