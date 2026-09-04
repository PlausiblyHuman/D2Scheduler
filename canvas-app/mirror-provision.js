/*
 * D2 Build Scheduler — canvas-app dev-environment mirror
 * ------------------------------------------------------
 *
 * STATUS 2026-09-04: NOT REQUIRED FOR THE CURRENT HANDOFF. Ryan builds
 * directly in D2 Automation against the real lists, so no mirror is needed.
 * Retained as the authoritative live-schema capture (the field list below is
 * read from production and is more accurate than D2-Provision-Lists.ps1),
 * and for standing up any future dev/test environment.
 *
 * Recreates the four SharePoint lists the canvas app binds to, with internal
 * names matching D2 production CHARACTER-FOR-CHARACTER. Power Fx binds to
 * internal names, so a mismatch rebinds silently and wrongly on import.
 *
 * Schema captured live from D2 production on 2026-09-04 via
 * /_api/web/lists/GetByTitle('X')/fields — NOT from D2-Provision-Lists.ps1,
 * which is obsolete and incomplete.
 *
 * HOW TO RUN  (this is the pattern that provisioned D2 itself — no PnP, no
 * m365 CLI, no BYO Entra app, all of which are blocked on a fresh box):
 *   1. Create a SharePoint site in YOUR tenant.
 *   2. Open it in a browser tab and sign in normally.
 *   3. F12 → Console → paste this whole file → Enter.
 *   4. Set SITE below first if your site path differs.
 *
 * Field creates are deliberately SEQUENTIAL. Parallel creates against one list
 * contend on the schema lock and fail with "requires a newer version".
 */

const SITE = '/sites/D2BuildScheduler';   // <-- change to your site's server-relative path

// ---------------------------------------------------------------- helpers

async function digest() {
  const r = await fetch(`${SITE}/_api/contextinfo`, {
    method: 'POST',
    headers: { Accept: 'application/json;odata=nometadata' },
    credentials: 'include'
  });
  return (await r.json()).FormDigestValue;
}

async function sp(url, opts = {}) {
  const d = await digest();
  const r = await fetch(SITE + url, {
    credentials: 'include',
    ...opts,
    headers: {
      Accept: 'application/json;odata=nometadata',
      'Content-Type': 'application/json;odata=nometadata',
      'X-RequestDigest': d,
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url}\n${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function ensureList(title) {
  try {
    const l = await sp(`/_api/web/lists/GetByTitle('${title}')?$select=Id,ListItemEntityTypeFullName`);
    console.log(`  list '${title}' already exists`);
    return l;
  } catch {
    const l = await sp('/_api/web/lists', {
      method: 'POST',
      body: JSON.stringify({ BaseTemplate: 100, Title: title, AllowContentTypes: false, ContentTypesEnabled: false })
    });
    console.log(`  created list '${title}'`);
    return sp(`/_api/web/lists/GetByTitle('${title}')?$select=Id,ListItemEntityTypeFullName`);
  }
}

/* Field XML per type. `r` = Required. Lookup needs the target list's GUID,
 * so Jobs must be created before Assignments, and Assignments before Tasks. */
function fieldXml(f, lookupTargets) {
  const req = f.r ? 'TRUE' : 'FALSE';
  const base = `Name='${f.i}' DisplayName='${f.d || f.i}' Required='${req}'`;
  switch (f.t) {
    case 'Text':     return `<Field Type='Text' ${base} MaxLength='255' />`;
    case 'Note':     return `<Field Type='Note' ${base} NumLines='6' RichText='FALSE' />`;
    case 'Number':   return `<Field Type='Number' ${base} />`;
    case 'Boolean':  return `<Field Type='Boolean' ${base}><Default>0</Default></Field>`;
    // df 0 = DateOnly, 1 = DateTime. Getting this wrong is how the whole
    // work-week got inverted in Week 1 — see the handoff contract §0.3.
    case 'DateTime': return `<Field Type='DateTime' ${base} Format='${f.df === 0 ? 'DateOnly' : 'DateTime'}' />`;
    case 'User':     return `<Field Type='User' ${base} UserSelectionMode='PeopleOnly' UserSelectionScope='0' />`;
    case 'Choice':   return `<Field Type='Choice' ${base} Format='Dropdown'><CHOICES>${
                        f.c.map(c => `<CHOICE>${c}</CHOICE>`).join('')}</CHOICES></Field>`;
    case 'Lookup':   return `<Field Type='Lookup' ${base} List='{${lookupTargets[f.lt]}}' ShowField='${f.lf}' />`;
    default: throw new Error('unhandled field type ' + f.t);
  }
}

async function addFields(listTitle, fields, lookupTargets) {
  const existing = (await sp(`/_api/web/lists/GetByTitle('${listTitle}')/fields?$select=InternalName`))
    .value.map(x => x.InternalName);
  for (const f of fields) {                       // SEQUENTIAL — do not parallelise
    if (existing.includes(f.i)) { console.log(`    · ${f.i} exists`); continue; }
    await sp(`/_api/web/lists/GetByTitle('${listTitle}')/fields/CreateFieldAsXml`, {
      method: 'POST',
      body: JSON.stringify({ parameters: { SchemaXml: fieldXml(f, lookupTargets), Options: 8 } })
    });
    console.log(`    + ${f.i} (${f.t}${f.r ? ', required' : ''})`);
  }
}

// ---------------------------------------------------------------- schema
// Captured from D2 production 2026-09-04. i=InternalName, d=DisplayName,
// t=type, r=Required, lf=lookup ShowField, lt=lookup target, df=date format,
// c=choices. Title is created with every list, so it is omitted below except
// where its Required flag differs from default.

const SCHEMA = {
  Jobs: [
    { i: 'JobNumber',      t: 'Text',     r: true  },
    { i: 'Address',        t: 'Text',     r: false },
    { i: 'City',           t: 'Text',     r: false },
    { i: 'StartDate',      t: 'DateTime', r: true, df: 0 },
    { i: 'Status',         t: 'Choice',   r: true, c: ['Planned', 'Active', 'On Hold', 'Complete'] },
    { i: 'ProjectManager', d: 'Project Manager', t: 'User', r: false }
    // NOTE: there is NO State and NO ZIP column. The Week 3 spec's address
    // formula references both — it is wrong. Do not add them to make the
    // formula work; fix the formula.
  ],
  Assignments: [
    { i: 'Job',                t: 'Lookup',   r: true,  lt: 'Jobs', lf: 'Title' },
    { i: 'SubPhaseNumber',     t: 'Text',     r: true  },
    { i: 'SubPhaseName',       t: 'Text',     r: true  },
    { i: 'Crew',               t: 'Text',     r: false },   // TEXT. Never .Value. Holds CrewID.
    { i: 'Sequence',           t: 'Number',   r: false },
    { i: 'ScheduledStart',     t: 'DateTime', r: false, df: 0 },
    { i: 'ScheduledFinish',    t: 'DateTime', r: false, df: 0 },
    { i: 'WorkDate',           t: 'DateTime', r: false, df: 0 },
    { i: 'InstallerSignOff',   t: 'Boolean',  r: false },
    { i: 'InstallerSignOffBy', t: 'User',     r: false },
    { i: 'InstallerSignOffOn', t: 'DateTime', r: false, df: 1 },
    { i: 'Locked',             t: 'Boolean',  r: true  },   // required-but-null in prod
    { i: 'NotApplicable',      t: 'Boolean',  r: true  },   // required-but-null in prod
    { i: 'PMSignOff',          t: 'Boolean',  r: true  },   // required-but-null in prod
    { i: 'TasksComplete',      t: 'Number',   r: false },
    { i: 'TasksTotal',         t: 'Number',   r: false },
    { i: 'DurationDays',       t: 'Number',   r: true  },   // required-but-null in prod
    { i: 'PMSignOffBy',        t: 'User',     r: false },
    { i: 'PMSignOffOn',        t: 'DateTime', r: false, df: 1 },
    { i: 'SignOffNotes',       t: 'Note',     r: false },
    { i: 'Trade',              t: 'Lookup',   r: false, lt: 'Trades', lf: 'Title' }
  ],
  Tasks: [
    { i: 'Assignment',  t: 'Lookup',   r: true, lt: 'Assignments', lf: 'Title' },  // genuinely a Lookup
    { i: 'Sequence',    t: 'Number',   r: false },
    { i: 'Complete',    t: 'Boolean',  r: false },
    { i: 'CompletedBy', t: 'User',     r: false },
    { i: 'CompletedOn', t: 'DateTime', r: false, df: 1 }
  ],
  Crews: [
    { i: 'CrewID',    t: 'Text',    r: true  },   // THE join key
    { i: 'Size',      t: 'Number',  r: false },
    { i: 'Unlimited', t: 'Boolean', r: false },
    { i: 'Active',    t: 'Boolean', r: true  },
    { i: 'LeadEmail', t: 'Text',    r: false },   // seed with UPN, not mail
    { i: 'Notes',     t: 'Note',    r: false }
  ],
  // Minimal stub so the Assignments.Trade lookup resolves. The real list has 26 rows.
  Trades: []
};

// ---------------------------------------------------------------- seed data
// Enough to build against: one job, the 7 real field crews + the unlimited
// buckets, one assignment for today, and its 6 tasks.

const YOUR_UPN = 'REPLACE_ME@yourtenant.com';   // <-- your sign-in UPN

const CREWS = [
  // CrewID, Title, Size, Unlimited, LeadEmail
  ['devon',      'Devon Crew +3', 3, false, YOUR_UPN],
  ['saul',       'Saul +2',       2, false, ''],
  ['guillermo',  'Guillermo +2',  2, false, ''],
  ['harrison',   'Harrison +2',   2, false, ''],
  ['antonio',    'Antonio +1',    1, false, ''],
  ['cirilo',     'Cirilo +2',     2, false, ''],
  ['campos',     'Campos +2',     2, false, ''],
  ['stl',        'STL Shotcrete', 0, true,  ''],
  ['george',     'George Crew',   0, true,  ''],
  ['armondo',    'Armondo Crew',  0, true,  ''],
  ['brothers',   'Brothers Crew', 0, true,  ''],
  ['subcon',     'Subcontractor', 0, true,  ''],
  ['unassigned', 'Unassigned',    0, true,  ''],
  ['office',     'Main Office',   0, true,  '']
];

const TASKS_FOR_ASSIGNMENT = [
  'Verify rebar delivery against takeoff',
  'Set perimeter steel',
  'Tie floor mat',
  'Install bond beam steel',
  'Set light niche and penetrations',
  'Inspection walk with PM'
];

/* DateOnly values are written as a BARE 'yyyy-MM-dd' string. SharePoint stores
 * site-local midnight. Never send '...T00:00:00Z' — that is what Week 1 did and
 * every date came back a day early. */
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------- run

async function provision() {
  console.log('=== D2 canvas-app mirror ===');
  const ids = {};

  // Order matters: lookup targets must exist first.
  for (const name of ['Jobs', 'Trades', 'Assignments', 'Tasks', 'Crews']) {
    console.log(`\n[list] ${name}`);
    const l = await ensureList(name);
    ids[name] = l.Id;
  }
  for (const name of ['Jobs', 'Trades', 'Assignments', 'Tasks', 'Crews']) {
    if (!SCHEMA[name] || !SCHEMA[name].length) continue;
    console.log(`\n[fields] ${name}`);
    await addFields(name, SCHEMA[name], ids);
  }

  console.log('\n[seed]');
  const ent = async (t) => (await sp(`/_api/web/lists/GetByTitle('${t}')?$select=ListItemEntityTypeFullName`)).ListItemEntityTypeFullName;
  const add = async (t, body) => sp(`/_api/web/lists/GetByTitle('${t}')/items`, {
    method: 'POST',
    body: JSON.stringify({ '@odata.type': await ent(t), ...body })
  });

  const existingCrews = (await sp(`/_api/web/lists/GetByTitle('Crews')/items?$select=CrewID&$top=50`)).value.map(c => c.CrewID);
  for (const [id, title, size, unl, mail] of CREWS) {
    if (existingCrews.includes(id)) continue;
    await add('Crews', { Title: title, CrewID: id, Size: size, Unlimited: unl, Active: true, LeadEmail: mail });
    console.log(`  crew ${id}`);
  }

  const jobs = (await sp(`/_api/web/lists/GetByTitle('Jobs')/items?$select=Id,JobNumber`)).value;
  let job = jobs.find(j => j.JobNumber === 'DEV-0001');
  if (!job) {
    job = await add('Jobs', {
      Title: 'Dev Sandbox Pool', JobNumber: 'DEV-0001',
      Address: '1 Test Way', City: 'Frisco',
      StartDate: isoDate(new Date()), Status: 'Active'
    });
    console.log('  job DEV-0001');
  }

  const today = new Date();
  const finish = new Date(); finish.setDate(finish.getDate() + 2);
  const asgs = (await sp(`/_api/web/lists/GetByTitle('Assignments')/items?$select=Id,Title`)).value;
  let asg = asgs.find(a => a.Title === 'DEV-0001 · 2.2 Steel Installation');
  if (!asg) {
    asg = await add('Assignments', {
      Title: 'DEV-0001 · 2.2 Steel Installation',
      JobId: job.Id,
      SubPhaseNumber: '2.2', SubPhaseName: 'Steel Installation',
      Crew: 'devon',                       // CrewID, not Title
      Sequence: 22,
      ScheduledStart: isoDate(today), ScheduledFinish: isoDate(finish),
      DurationDays: 3,
      Locked: false, NotApplicable: false, PMSignOff: false,
      InstallerSignOff: false, TasksTotal: TASKS_FOR_ASSIGNMENT.length, TasksComplete: 0
    });
    console.log('  assignment 2.2');
    for (let i = 0; i < TASKS_FOR_ASSIGNMENT.length; i++) {
      await add('Tasks', { Title: TASKS_FOR_ASSIGNMENT[i], AssignmentId: asg.Id, Sequence: i + 1, Complete: false });
    }
    console.log(`  ${TASKS_FOR_ASSIGNMENT.length} tasks`);
  }

  console.log('\n=== done ===');
  console.log('Set YOUR_UPN before running, or OnStart will not resolve a crew.');
}

provision().catch(e => console.error('FAILED:', e));
