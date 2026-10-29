/* Gate the two template lists: only Don and David edit them (decided 2026-09-21, applied 2026-10-28).
 *
 *   Sub-phase Template and Task Template stop inheriting the site's permissions and get:
 *     D2 Build Scheduler Owners    Full Control   (kept, so Stratirus and D2 - New Pool, which runs
 *                                                   as D2 Bot, still read and maintain them)
 *     D2 Build Scheduler Members   Read           (was Edit through the site)
 *     D2 Build Scheduler Visitors  Read           (unchanged)
 *     Don Borgeson, David Taylor   Edit           (added as named users)
 *   Nothing else on the lists changes. Every other list keeps inheriting from the site.
 *
 * HOW TO RUN
 *   Open the site in a browser signed in as a site Owner (stratirus@d2pools.com). DevTools > Sources
 *   > Snippets (no paste guard there), paste this file, run it. It reads everything, prints the plan
 *   and writes NOTHING. Read the plan. To apply it run
 *       window.D2_GATE_WRITE = true
 *   and run the file again. It applies the plan, then reads the lists back and checks what Don,
 *   David, a plain member and the signed-in account can actually do on each list.
 *   tools/sp-proxy.js runs this same file under Node through a throwaway proxy flow (see CLAUDE.md,
 *   "A REQUEST-TRIGGERED FLOW IS A GENERIC SHAREPOINT REST PROXY").
 *
 * SAFETY
 *   - Role ids, group ids and user ids are read from the site, never typed in. Don is matched on the
 *     claim for don@d2pools.com and David on david@d2pools.com; contact@d2pools.com (Don's enabled
 *     duplicate) and David's #ext# guest never match. A user that does not resolve to exactly one
 *     account stops the whole run before any write.
 *   - Inheritance is broken COPYING the site's assignments, so nothing loses access by the break
 *     itself; the Members group is then stepped down and the two editors added.
 *   - Only Edit, Contribute, Design and Full Control are ever removed, and only from the Members
 *     group. Limited Access and any other principal's bindings are reported and left alone.
 *   - The run refuses to continue if the Owners group would not hold Full Control afterwards.
 *   - Idempotent: a second run plans nothing and reports the lists as already gated.
 */
(async () => {
  const WRITE = typeof window !== 'undefined' && window.D2_GATE_WRITE === true;
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const LISTS = ['Sub-phase Template', 'Task Template'];
  const EDITORS = ['don@d2pools.com', 'david@d2pools.com'];
  const PROBE_MEMBER = 'cody@d2pools.com';          // a plain member: must end with Read, not Edit
  const claim = upn => 'i:0#.f|membership|' + upn;
  const NM = { Accept: 'application/json;odata=nometadata' };
  const J = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
  const list = l => site + "/_api/web/lists/GetByTitle('" + encodeURIComponent(l) + "')";
  const report = { write: WRITE, roles: {}, groups: {}, users: {}, lists: {}, writes: [], verify: {}, refused: null };

  async function get(u) {
    const r = await fetch(u, { headers: NM, credentials: 'include' });
    const t = await r.text();
    if (!r.ok) throw new Error('GET ' + u.replace(site, '') + ' -> ' + r.status + ' ' + t.slice(0, 300));
    return t ? JSON.parse(t) : {};
  }
  let digest = null;
  async function post(u) {
    report.writes.push((WRITE ? '' : '(dry) ') + u.replace(site, ''));
    if (!WRITE) return null;
    if (!digest) {
      const d = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: J, credentials: 'include' })).json();
      digest = d.FormDigestValue;
    }
    const r = await fetch(u, { method: 'POST', headers: { ...J, 'X-RequestDigest': digest }, credentials: 'include' });
    const t = await r.text();
    if (!r.ok) throw new Error('POST ' + u.replace(site, '') + ' -> ' + r.status + ' ' + t.slice(0, 300));
    return t ? JSON.parse(t) : {};
  }
  const refuse = why => { report.refused = why; console.error('REFUSED: ' + why); return report; };

  // ---- role definitions, by RoleTypeKind (Reader 2, Contributor 3, Designer 4, Administrator 5, Editor 6)
  const roles = (await get(site + '/_api/web/roledefinitions?$select=Id,Name,RoleTypeKind')).value || [];
  const roleByKind = k => roles.find(r => r.RoleTypeKind === k);
  const FULL = roleByKind(5), EDIT = roleByKind(6), READ = roleByKind(2), CONTRIB = roleByKind(3), DESIGN = roleByKind(4);
  if (!FULL || !EDIT || !READ) return refuse('could not find the Full Control, Edit and Read role definitions on this site');
  report.roles = { fullControl: FULL, edit: EDIT, read: READ };
  const REMOVABLE = new Set([EDIT.Id, CONTRIB && CONTRIB.Id, DESIGN && DESIGN.Id, FULL.Id].filter(x => x != null));

  // ---- the three associated groups
  const grp = async kind => get(site + '/_api/web/associated' + kind + 'group?$select=Id,Title');
  const owners = await grp('owner'), members = await grp('member'), visitors = await grp('visitor');
  report.groups = { owners, members, visitors };

  // ---- the two editors, each exactly one account by claim
  const users = {};
  for (const upn of EDITORS.concat([PROBE_MEMBER])) {
    const q = site + "/_api/web/siteusers?$select=Id,Title,LoginName,Email&$filter=LoginName eq '" + encodeURIComponent(claim(upn).replace(/'/g, "''")) + "'";
    const hits = (await get(q)).value || [];
    if (hits.length !== 1) return refuse(upn + ' resolved to ' + hits.length + ' site users; expected exactly one');
    if (String(hits[0].LoginName).toLowerCase() !== claim(upn)) return refuse(upn + ' resolved to a different claim: ' + hits[0].LoginName);
    users[upn] = hits[0];
  }
  report.users = users;

  // ---- current state and plan, per list
  const readAssignments = async l => (await get(list(l) + '/roleassignments?$expand=Member,RoleDefinitionBindings'
    + '&$select=PrincipalId,Member/Id,Member/Title,Member/LoginName,Member/PrincipalType,RoleDefinitionBindings/Id,RoleDefinitionBindings/Name')).value || [];
  const describe = ras => ras.map(a => ({ id: a.PrincipalId, who: a.Member && a.Member.Title, type: a.Member && a.Member.PrincipalType,
    levels: (a.RoleDefinitionBindings || []).map(b => b.Name) }));
  const want = [
    { who: 'owners', id: owners.Id, ensure: [FULL.Id], remove: [] },
    { who: 'members', id: members.Id, ensure: [READ.Id], remove: [...REMOVABLE] },
    { who: 'visitors', id: visitors.Id, ensure: [READ.Id], remove: [] }
  ].concat(EDITORS.map(u => ({ who: u, id: users[u].Id, ensure: [EDIT.Id], remove: [] })));

  for (const l of LISTS) {
    const meta = await get(list(l) + '?$select=Title,HasUniqueRoleAssignments');
    const before = await readAssignments(l);
    const have = new Map(before.map(a => [a.PrincipalId, new Set((a.RoleDefinitionBindings || []).map(b => b.Id))]));
    const plan = [];
    if (!meta.HasUniqueRoleAssignments) plan.push({ op: 'break', url: list(l) + '/breakroleinheritance(copyroleassignments=true,clearsubscopes=true)' });
    for (const w of want) {
      const cur = have.get(w.id) || new Set();
      w.remove.filter(rid => cur.has(rid)).forEach(rid => plan.push({ op: 'remove', who: w.who, role: roles.find(r => r.Id === rid).Name,
        url: list(l) + '/roleassignments/removeroleassignment(principalid=' + w.id + ',roledefid=' + rid + ')' }));
      w.ensure.filter(rid => !cur.has(rid)).forEach(rid => plan.push({ op: 'add', who: w.who, role: roles.find(r => r.Id === rid).Name,
        url: list(l) + '/roleassignments/addroleassignment(principalid=' + w.id + ',roledefid=' + rid + ')' }));
    }
    // The owners group must end with Full Control, whatever else happens.
    const ownersAfter = new Set([...(have.get(owners.Id) || [])]);
    plan.filter(p => p.who === 'owners').forEach(p => p.op === 'add' ? ownersAfter.add(FULL.Id) : null);
    if (!ownersAfter.has(FULL.Id) && !plan.some(p => p.op === 'add' && p.who === 'owners')) return refuse(l + ': the Owners group would not hold Full Control');
    report.lists[l] = { unique: !!meta.HasUniqueRoleAssignments, before: describe(before), plan: plan.map(p => p.op + (p.who ? ' ' + p.who + ' ' + p.role : '')) };

    for (const p of plan) await post(p.url);

    if (WRITE) {
      const after = await readAssignments(l);
      report.lists[l].after = describe(after);
      // What each account can actually do, from SharePoint's own answer, not from the bindings.
      const perm = async upn => {
        const p = await get(list(l) + "/getusereffectivepermissions(@u)?@u='" + encodeURIComponent(claim(upn).replace(/'/g, "''")) + "'");
        const low = Number(p.Low || 0);
        return { view: !!(low & 0x1), edit: !!(low & 0x4), manageLists: !!(low & 0x800) };
      };
      const me = await get(list(l) + '/effectivebasepermissions');
      report.verify[l] = { don: await perm(EDITORS[0]), david: await perm(EDITORS[1]), member: await perm(PROBE_MEMBER),
        signedIn: { edit: !!(Number(me.Low || 0) & 0x4), manageLists: !!(Number(me.Low || 0) & 0x800) } };
      const v = report.verify[l];
      v.ok = v.don.edit && v.david.edit && v.member.view && !v.member.edit && v.signedIn.manageLists;
    }
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
})();
