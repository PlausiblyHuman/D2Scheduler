"""Plan a new pool: one Job, its 46 sub-phase Assignments, and their ~295 Tasks.

    python tools/add_pool.py --job TEST-9003 --name "Sandbox Bluff" \
        --address "88 Bluff Rd" --city Frisco --percent-done 85

Emits tools/pool-plan.json and writes NOTHING. Review the plan, then apply it
with tools/write-pool.js in an authenticated browser.

THIS IS NOT TEST SCAFFOLDING. Adding a pool is a permanent operation — there is
no browser-tool -> Lists sync (Phase G), so this is how every pool, real or
test, gets into SharePoint. The --job/--name/--address arguments are the only
difference between a sandbox pool and a real one.

How "percent done" works
------------------------
Rather than randomly ticking tasks, the pool is SCHEDULED so that the requested
fraction of its work days falls before today. Then:

  finished before today  -> every task complete, InstallerSignOff = true
  spanning today         -> partially ticked, not signed off
  starting after today   -> untouched

That produces a pool that behaves like a real one part-way through: the daily
summary's compliance figure, the "Sign-off Overdue" view and the app's Today
screen all see something realistic instead of a uniform smear.

Business rules enforced (see CLAUDE.md):
  1. a crew only takes a sub-phase whose trade it holds
  2. a capacity crew is never on two pools the same day  (Unlimited crews exempt)
  3. sub-phases run in order; N+1 starts after N ends
  4. Mon-Sat are work days, Sunday is not

Rule 4 applies to ENDPOINTS only. A span that contains a Sunday is legitimate —
a 2-work-day sub-phase starting Saturday runs Sat + Mon. 'days' in the template
is WORK days, never the inclusive calendar span.
"""
import argparse, io, json, re, datetime as dt, os

TOOL = 'web/index.html'
LIVE = 'tools/live-state.json'
OUT = 'tools/pool-plan.json'

ap = argparse.ArgumentParser()
ap.add_argument('--job', required=True, help='JobNumber, e.g. TEST-9003 or D2-1002')
ap.add_argument('--name', required=True, help='Job title, e.g. "Sandbox Bluff"')
ap.add_argument('--address', default='')
ap.add_argument('--city', default='')
ap.add_argument('--percent-done', type=int, default=85)
ap.add_argument('--today', default=None, help='override today (yyyy-mm-dd), for reproducible plans')
args = ap.parse_args()

TODAY = dt.date.fromisoformat(args.today) if args.today else dt.date.today()

# ---------------------------------------------------------------- template
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
SECTIONS = [(s['num'], s['name'], s.get('skill'), s.get('days', 2), s.get('tasks', []))
            for ph in TPL for s in ph['sections']]

crew_src = extract_array('SEED_CREWS = ')
SKILLS = {}
for m in re.finditer(r"\{id:'([a-z]+)'.*?skills:\[([^\]]*)\]", crew_src, re.S):
    SKILLS[m.group(1)] = re.findall(r"'([^']+)'", m.group(2))

# ---------------------------------------------------------------- live state
live = json.load(io.open(LIVE, encoding='utf-8'))
live = live.get('result', live)
UNLIMITED = {c['crewId'] for c in live['crews'] if c['unlimited']}
CAPACITY = [c['crewId'] for c in live['crews'] if not c['unlimited'] and c['active']]

if args.job in {j['jobNumber'] for j in live['jobs']}:
    raise SystemExit('job %s already exists in the tenant — pick another JobNumber' % args.job)

# Busy map from the LIVE tenant, not a hardcoded list. This is what stops a new
# pool double-booking a crew that is already working (business rule 2).
busy = {}
for a in live['assignments']:
    if a['crew'] in UNLIMITED or not a['start'] or not a['finish']:
        continue
    d, end = dt.date.fromisoformat(a['start']), dt.date.fromisoformat(a['finish'])
    while d <= end:
        busy[(a['crew'], d.isoformat())] = a['title']
        d += dt.timedelta(days=1)

# ---------------------------------------------------------------- date helpers
def is_work(d):
    return d.weekday() != 6                      # 6 == Sunday


def next_work(d):
    while not is_work(d):
        d += dt.timedelta(days=1)
    return d


def span(start, ndays):
    """ndays WORK days starting at or after start. Returns the day list."""
    out, d = [], next_work(start)
    while len(out) < ndays:
        if is_work(d):
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def work_days_between(a, b):
    n, d = 0, a
    while d <= b:
        if is_work(d):
            n += 1
        d += dt.timedelta(days=1)
    return n


# ---------------------------------------------------------------- start date
# Back-date the pool so that --percent-done of its work days are already past.
total_work_days = sum(max(1, s[3]) for s in SECTIONS)
done_days = int(round(total_work_days * args.percent_done / 100.0))
start = TODAY
for _ in range(done_days):
    start -= dt.timedelta(days=1)
    while not is_work(start):
        start -= dt.timedelta(days=1)
start = next_work(start)

# ---------------------------------------------------------------- assign
def pick_crew(skill, days):
    """Cheapest qualified crew that is free for the whole span (rule 1 + 2)."""
    cands = [c for c in CAPACITY if skill in SKILLS.get(c, [])]
    if not cands:
        # Unlimited buckets are capacity-exempt and never double-booked.
        for c in UNLIMITED:
            if skill in SKILLS.get(c, []):
                return c
        return 'unassigned'
    return cands


plan, cursor = [], start
for num, name, skill, days, tasks in SECTIONS:
    days = max(1, days)
    chosen, dayspan = None, None
    probe = cursor
    for _attempt in range(60):                    # walk forward until someone is free
        dayspan = span(probe, days)
        cands = pick_crew(skill, days)
        if isinstance(cands, str):                # unlimited or unassigned
            chosen = cands
            break
        free = [c for c in cands
                if all((c, d.isoformat()) not in busy for d in dayspan)]
        if free:
            # balance by current load so one crew doesn't take the whole pool
            chosen = min(free, key=lambda c: sum(1 for k in busy if k[0] == c))
            break
        probe = dayspan[-1] + dt.timedelta(days=1)
    if chosen is None:
        chosen, dayspan = 'unassigned', span(cursor, days)

    if chosen not in UNLIMITED and chosen != 'unassigned':
        for d in dayspan:
            busy[(chosen, d.isoformat())] = args.job + ' ' + num

    s, f = dayspan[0], dayspan[-1]
    finished = f < TODAY
    running = s <= TODAY <= f
    ntasks = len(tasks)
    if finished:
        complete = ntasks
    elif running:
        complete = max(0, int(ntasks * 0.5))
    else:
        complete = 0

    plan.append({
        'num': num, 'name': name, 'skill': skill, 'crew': chosen,
        'start': s.isoformat(), 'finish': f.isoformat(), 'days': days,
        'tasks': tasks, 'tasksTotal': ntasks, 'tasksComplete': complete,
        'installerSignOff': finished,
        'state': 'finished' if finished else ('running' if running else 'future'),
    })
    cursor = f + dt.timedelta(days=1)

# ---------------------------------------------------------------- verify
errs, seen = [], {}
for p in plan:
    s, f = dt.date.fromisoformat(p['start']), dt.date.fromisoformat(p['finish'])
    if not is_work(s):
        errs.append('SUNDAY START %s' % p['num'])
    if not is_work(f):
        errs.append('SUNDAY FINISH %s' % p['num'])
    if p['skill'] and p['crew'] not in ('unassigned',) and p['skill'] not in SKILLS.get(p['crew'], []):
        errs.append('UNQUALIFIED %s: %s lacks %s' % (p['num'], p['crew'], p['skill']))
    if p['crew'] in UNLIMITED or p['crew'] == 'unassigned':
        continue
    d = s
    while d <= f:
        k = (p['crew'], d.isoformat())
        if k in seen:
            errs.append('DOUBLE-BOOK %s on %s: %s vs %s' % (p['crew'], d, seen[k], p['num']))
        seen[k] = p['num']
        d += dt.timedelta(days=1)
for a, b in zip(plan, plan[1:]):
    if b['start'] <= a['finish']:
        errs.append('OUT OF ORDER %s starts before %s ends' % (b['num'], a['num']))

job = {'jobNumber': args.job, 'title': args.name, 'address': args.address,
       'city': args.city, 'startDate': plan[0]['start'], 'status': 'Active'}
out = {'generatedFor': TODAY.isoformat(), 'percentDoneRequested': args.percent_done,
       'job': job, 'assignments': plan}

if errs:
    print('REFUSING TO WRITE PLAN — %d rule violation(s):' % len(errs))
    for e in errs[:15]:
        print('   ', e)
    raise SystemExit(1)

os.makedirs('tools', exist_ok=True)
io.open(OUT, 'w', encoding='utf-8').write(json.dumps(out, indent=2))

tt = sum(p['tasksTotal'] for p in plan)
tc = sum(p['tasksComplete'] for p in plan)
fin = [p for p in plan if p['state'] == 'finished']
print('job              : %s  %s' % (args.job, args.name))
print('sub-phases       : %d   %s .. %s' % (len(plan), plan[0]['start'], plan[-1]['finish']))
print('tasks            : %d total, %d complete (%d%%)' % (tt, tc, 100 * tc // tt))
print('sub-phases done  : %d finished and signed, %d running, %d future'
      % (len(fin), sum(1 for p in plan if p['state'] == 'running'),
         sum(1 for p in plan if p['state'] == 'future')))
print('crews used       : %s' % sorted({p['crew'] for p in plan}))
print('rule violations  : 0')
print('\nwrote %s — review it, then apply with tools/write-pool.js' % OUT)
