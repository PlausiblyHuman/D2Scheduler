#!/usr/bin/env python3
"""Watch a harness fail before trusting it.

WHY THIS EXISTS: this repo has now recorded four vacuous harnesses and one
vacuous assertion. `workcalendar.js` passed on a broken join while reporting
"0 spans checked"; `startdate.js` passed against a fully reverted fix;
`empty.js` had no assertion and no non-zero exit at all; `determinism.js`
compared 0 assignments for weeks while being cited as the gate. A mutation
sweep of `writeback.js` once found 4 of 6 mutations surviving at 29
assertions. Test count is not coverage. The only thing that establishes
coverage is breaking the production code on purpose and watching the harness
go red.

A CRASH COUNTS AS RED. The first version of this sweep only looked for a
"FAIL" line in stdout and so reported a TypeError as "still passing", which is
the same confident-wrong-answer shape it exists to catch.

Usage:
  python fixtures/planner/mutate.py <harness.js> <source.js> [--json mutations.json]

With no --json, mutations are read from a `MUTATIONS` list at the bottom of
this file keyed by source path. Each mutation is {label, find, replace};
`find` must appear in the source or the sweep reports NOT-APPLIED and fails,
because a mutation that never lands is worse than no mutation at all.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run(harness):
    node = shutil.which("node") or "node"
    return subprocess.run([node, str(harness)], capture_output=True, text=True, cwd=ROOT)


def sweep(harness, source, mutations):
    harness, source = ROOT / harness, ROOT / source
    orig = source.read_text(encoding="utf-8")

    base = run(harness)
    if base.returncode != 0:
        print("ABORT: the harness is not green before mutating. Fix that first.")
        print(base.stdout[-1500:])
        return 1

    bad = 0
    print(f"sweeping {source.name} against {harness.name}  ({len(mutations)} mutations)\n")
    for m in mutations:
        label, find, repl = m["label"], m["find"], m["replace"]
        if find not in orig:
            print(f"  NOT-APPLIED  {label}")
            print("               anchor text is not in the source, so nothing was mutated")
            bad = 1
            continue
        source.write_text(orig.replace(find, repl, 1), encoding="utf-8")
        r = run(harness)
        fails = [l for l in r.stdout.splitlines() if l.startswith("FAIL")]
        if r.returncode != 0:
            how = "assertion" if fails else "crash"
            print(f"  RED ({how:9}) {label}")
            if fails:
                print(f"                 {fails[0][:100]}")
        else:
            print(f"  SURVIVED     {label}")
            print("                 nothing asserts this. The mutation is undetected.")
            bad = 1

    source.write_text(orig, encoding="utf-8")
    after = run(harness)
    print("\n  reverted and green again" if after.returncode == 0
          else "\n  BROKEN AFTER REVERT -- check the source by hand")
    return bad or (0 if after.returncode == 0 else 1)


MUTATIONS = {
    "web/writeback-core.js": [
        {"label": "allowlist check removed",
         "find": "if (ALLOWLIST.indexOf(col) === -1 || !FIELD_DEFS[col]) {",
         "replace": "if (false) {"},
        {"label": "compare-before-write disabled",
         "find": "if (!def.eq(nowLive, d.from)) {",
         "replace": "if (false) {"},
        {"label": "titleMatches becomes a substring test",
         "find": "return toks.indexOf(String(num)) !== -1;",
         "replace": "return t.indexOf(String(num)) !== -1;"},
        {"label": "suppression stamp set behind now",
         "find": "return new Date(nowMs + minutes * 60000).toISOString();",
         "replace": "return new Date(nowMs - minutes * 60000).toISOString();"},
        {"label": "date write-normalisation removed",
         "find": ",\n      write: day\n",
         "replace": "\n"},
        {"label": "in-batch duplicate guard removed",
         "find": "      taken[jobKey(c.jobno)] = true;\n      out.push({",
         "replace": "      out.push({"},
        {"label": "row-identity check removed",
         "find": "if (!titleMatches(liveRow.Title, p.jobno, sec.num)) {",
         "replace": "if (false) {"},
        {"label": "missing live row silently skipped instead of reported",
         "find": "          errors.push(Object.assign({}, where, { reason: 'row-missing' }));",
         "replace": "          /* mutated */"},
    ],
    "web/graph-writeback.js": [
        {"label": "suppression stamp dropped from the PATCH body",
         "find": "    b.SuppressReconcileUntil = write.suppressUntil;",
         "replace": "    /* mutated */"},
        {"label": "empty-UPN guard removed from site-user resolution",
         "find": "    if (!want) return { id: null, matches: [], ambiguous: false };",
         "replace": "    /* mutated */"},
        {"label": "create proceeds with no project manager",
         "find": "    if (!projectManagerLookupId) {",
         "replace": "    if (false) {"},
        {"label": "a failed row aborts the whole batch",
         "find": "        failed.push({ id: w.id, jobno: w.jobno, num: w.num, status: r.status, detail: detail });",
         "replace": "        return { written: written, failed: failed };"},
        {"label": "EMail accepted as identity alongside the claims Name",
         "find": "      return name.lastIndexOf(suffix) === name.length - suffix.length;",
         "replace": "      return name.lastIndexOf(suffix) === name.length - suffix.length || String(f.EMail || '').trim().toLowerCase() === want;"},
        {"label": "an ambiguous match tie-breaks to the first row instead of refusing",
         "find": "      id: hits.length === 1 ? String(hits[0].id) : null,",
         "replace": "      id: hits.length ? String(hits[0].id) : null,"},
        {"label": "Title given the job number instead of the pool name",
         "find": "      Title: create.name,                    // the POOL NAME, per every live row",
         "replace": "      Title: create.jobno,"},
        {"label": "AssignDefaultCrews left to the list default",
         "find": "      AssignDefaultCrews: !!create.assignDefaultCrews",
         "replace": "      Address2: ''"},
    ],
    # Sweep these three against fixtures/planner/signin.js (the 2026-09-18
    # sign-in fix). index.html is large, so each anchor is one line.
    "web/index.html": [
        {"label": "popup lands back on the walled page",
         "find": "redirectUri:location.origin+D2_GRAPH.redirectPath},",
         "replace": "redirectUri:location.origin+location.pathname},"},
        {"label": "login hint never sent",
         "find": "  if(D2_LOGIN_HINT)req.loginHint=D2_LOGIN_HINT;",
         "replace": "  /* mutated */"},
        {"label": "wall account never fetched",
         "find": "fetchLoginHint();\n",
         "replace": "\n"},
        {"label": "Try again waits on the silent token first",
         "find": "  if(account&&!(opts&&opts.interactive)){",
         "replace": "  if(account){"},
        {"label": "file picker opens again after a failed hosted Refresh",
         "find": "  if(graphModeAvailable())refreshLive(false);",
         "replace": "  if(graphModeAvailable())refreshLive(false).then(()=>document.getElementById('d2File').click());"},
        {"label": "MSAL codes shown raw instead of explained",
         "find": "  if(byCode[code])return {text:byCode[code],code};",
         "replace": "  /* mutated */"},
        {"label": "no-access branch never taken",
         "find": "  if(e&&(e.status===401||e.status===403)){",
         "replace": "  if(false){"},
        {"label": "site lookup error loses its HTTP status",
         "find": "  if(!r.ok)throw graphHttpError('Could not reach the SharePoint site (HTTP '+r.status+').',r.status);",
         "replace": "  if(!r.ok)throw new Error('Could not reach the SharePoint site (HTTP '+r.status+').');"},
        {"label": "Activate shows the raw error (first dBody use is doActivatePool)",
         "find": "    document.getElementById('dBody').innerHTML=graphErrorHTML(e,'');",
         "replace": "    document.getElementById('dBody').innerHTML=esc(e.message);"},
        {"label": "Save shows the raw error",
         "find": "    body.innerHTML=graphErrorHTML(err,'Nothing was written.');",
         "replace": "    body.innerHTML='Nothing was written. '+esc(err&&err.message);"},
        {"label": "Try again button dropped",
         "find": "    `<button class=\"btn p\" onclick=\"refreshLive(true)\">Try again</button>",
         "replace": "    `"},
    ],
    "web/staticwebapp.config.json": [
        {"label": "redirect page put behind the wall",
         "find": "        \"anonymous\"",
         "replace": "        \"authenticated\""},
        {"label": "redirect page cannot be framed by the planner",
         "find": "\"X-Frame-Options\": \"SAMEORIGIN\"",
         "replace": "\"X-Frame-Options\": \"DENY\""},
    ],
    "web/auth-redirect.html": [
        {"label": "redirect page runs a script",
         "find": "<p>Signing you in.",
         "replace": "<script>history.replaceState(null,'',location.pathname)</script><p>Signing you in."},
    ],
}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    h, s = sys.argv[1], sys.argv[2].replace("\\", "/")
    if "--json" in sys.argv:
        muts = json.loads(Path(sys.argv[sys.argv.index("--json") + 1]).read_text(encoding="utf-8"))
    else:
        muts = MUTATIONS.get(s)
        if not muts:
            print(f"No mutations registered for {s}. Add them to MUTATIONS in this file.")
            sys.exit(2)
    sys.exit(sweep(h, s, muts))
