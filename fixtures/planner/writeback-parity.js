/* The write allowlist lives in THREE files and cannot be shared with all of
 * them, so agreement is asserted instead.
 *
 *   web/index.html                       WRITEBACK_FIELDS  (builds the change-set)
 *   web/writeback-core.js                ALLOWLIST         (plans the writes)
 *   sharepoint/apply-planner-changes.js  FIELD_DEFS        (the console fallback)
 *
 * The applier is pasted into a browser console on the SharePoint origin and
 * cannot `require` anything, so sharing code with it would need a build step
 * that inlines the core. That was deliberately not done: it would put the one
 * verified write path under the knife on the day the planner goes primary.
 *
 * This is the drift that actually matters. A field added to one copy and not
 * another means the same push is safe from one surface and not the other, and
 * nothing would say so. This repo has recorded that exact shape three times
 * already with flows/definitions/, the phantom patched-tool/ directory, and a
 * stale New Pool export that was missing an entire failure path.
 */
const fs = require('fs');
const path = require('path');
const C = require(path.resolve(__dirname, '../../web/writeback-core.js'));

let fail = 0;
const ok = (l, c, d = '') => { console.log((c ? 'PASS' : 'FAIL') + ' · ' + l + (d ? '  [' + d + ']' : '')); if (!c) fail = 1; };
const read = p => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

// ---- the planner's own WRITEBACK_FIELDS ----
const planner = read('web/index.html');
const wbStart = planner.indexOf('const WRITEBACK_FIELDS=');
const wbBlock = wbStart === -1 ? '' : planner.slice(wbStart, planner.indexOf('];', wbStart));
const plannerCols = (wbBlock.match(/col:\s*'([^']+)'/g) || []).map(s => s.replace(/.*'([^']+)'.*/, '$1'));

// ---- the console applier's FIELD_DEFS ----
const applier = read('sharepoint/apply-planner-changes.js');
const fdStart = applier.indexOf('const FIELD_DEFS = {');
const fdBlock = fdStart === -1 ? '' : applier.slice(fdStart, applier.indexOf('\n  };', fdStart));
const applierCols = (fdBlock.match(/^\s{4}(\w+):\s*\{/gm) || []).map(s => s.trim().replace(/:.*/, ''));

/* Guard the PARSE before comparing anything. Two empty lists compare equal,
   which would make every assertion below pass while checking nothing -- the
   precise failure this file exists to prevent elsewhere. */
ok('the planner\'s WRITEBACK_FIELDS block was found and parsed',
   plannerCols.length > 0, 'parsed: ' + plannerCols.join(','));
ok('the applier\'s FIELD_DEFS block was found and parsed',
   applierCols.length > 0, 'parsed: ' + applierCols.join(','));

const sorted = a => a.slice().sort().join(',');

ok('the planner names exactly five write-back columns',
   plannerCols.length === 5, plannerCols.join(','));
ok('the applier names exactly five write-back columns',
   applierCols.length === 5, applierCols.join(','));
ok('the core names exactly five write-back columns',
   C.ALLOWLIST.length === 5, C.ALLOWLIST.join(','));

ok('planner and core agree on the allowlist',
   sorted(plannerCols) === sorted(C.ALLOWLIST),
   plannerCols.join(',') + '  vs  ' + C.ALLOWLIST.join(','));
ok('applier and core agree on the allowlist',
   sorted(applierCols) === sorted(C.ALLOWLIST),
   applierCols.join(',') + '  vs  ' + C.ALLOWLIST.join(','));

const everywhere = [].concat(plannerCols, applierCols, C.ALLOWLIST);
ok('no sign-off, notes or task-completion column appears in ANY copy',
   !everywhere.some(c => /SignOff|Notes|Complete|Tasks/i.test(c)),
   everywhere.filter(c => /SignOff|Notes|Complete|Tasks/i.test(c)).join(',') || 'none');
ok('ScheduledFinish appears in NO copy -- it is derived from start + duration',
   everywhere.indexOf('ScheduledFinish') === -1);

/* Every column the core will write must have a FIELD_DEFS entry, or planEdits
   refuses it at runtime rather than crashing. Asserted here so the two halves
   of the core cannot drift apart either. */
ok('every allowlisted column has a FIELD_DEFS entry in the core',
   C.ALLOWLIST.every(c => !!C.FIELD_DEFS[c]),
   C.ALLOWLIST.filter(c => !C.FIELD_DEFS[c]).join(',') || 'all present');
ok('FIELD_DEFS carries no entry that is not on the allowlist',
   Object.keys(C.FIELD_DEFS).every(c => C.ALLOWLIST.indexOf(c) !== -1),
   Object.keys(C.FIELD_DEFS).filter(c => C.ALLOWLIST.indexOf(c) === -1).join(',') || 'none');

console.log(fail ? '\nFAILED'
  : '\nAllowlist parity holds across the planner, the core and the frozen console applier.');
process.exit(fail);
