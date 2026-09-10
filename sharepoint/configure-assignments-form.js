/* Declutter the Assignments New/Edit forms.
 *
 * WHY: a PM opening a sub-phase to change a crew and two dates got ~25 fields
 * in one flat list, including InstallerSignOffOn, TasksComplete and
 * SuppressReconcileUntil -- fields written by flows and the canvas app that a
 * human should never touch. Shane's request, after using the site with six
 * pools loaded.
 *
 * WHAT THIS DOES:
 *   1. Hides 11 flow/app-owned fields from New and Edit (Sequence, TasksTotal,
 *      TasksComplete, WeekMonday, SuppressReconcileUntil, InstallerSignOff,
 *      InstallerSignOffBy, InstallerSignOffOn, PMSignOff, PMSignOffBy,
 *      PMSignOffOn).
 *   2. Orders the 13 fields that remain the way the job reads: Title, Job,
 *      SubPhaseNumber, SubPhaseName, Crew, Trade, ScheduledStart,
 *      ScheduledFinish, DurationDays, WorkDate, Locked, NotApplicable,
 *      SignOffNotes.
 *   3. Drops Required on Locked, NotApplicable and PMSignOff (all booleans
 *      with a false default already set from the 2026-09-03 fix). DurationDays
 *      stays Required. See CLAUDE.md: these three being Required-but-null once
 *      made the whole list form refuse to save any hand-edit. Nothing creates
 *      Assignments by hand any more (D2 - New Pool does it), so Required here
 *      buys nothing and is a live trap the moment a field is hidden.
 *   4. Applies JSON form FORMATTING (added 2026-09-10, Shane: the form was
 *      "still kinda messy"): a navy header carrying the title, a crew chip, a
 *      sign-off chip and the read-only sub-phase identity; the 13 fields
 *      grouped into four named sections in the order the job runs; and a
 *      footer stating the crew-code rule. SubPhaseNumber and SubPhaseName are
 *      marked readonly, since D2 - New Pool owns them and a PM retyping one is
 *      never a correct action. See the long note at step 5 for the undocumented
 *      wrapper key names and how they were captured -- do not re-guess them.
 *
 * TWO DIFFERENT REST MECHANISMS ARE IN PLAY, discovered by testing against the
 * live list rather than assumed -- do not simplify this to one:
 *
 *   - Field.SetShowInEditForm(false) / SetShowInNewForm(false) -- a per-FIELD
 *     flag (SchemaXml ShowInEditForm/ShowInNewForm). This alone correctly
 *     hides 10 of the 11 fields from New/Edit.
 *   - WeekMonday (the one Calculated field in the list) ignores that flag --
 *     it still rendered on Edit, read-only, even with ShowInEditForm=FALSE.
 *     The only thing that actually suppressed it was excluding it from a
 *     ContentType.ReorderFields() call, which sets the ContentType FieldLink's
 *     Hidden=true for anything NOT named in the call. Confirmed by isolated
 *     A/B testing (see session notes): Field-level flags alone did not hide a
 *     Calculated field from Edit; FieldLink.Hidden did.
 *
 * ReorderFields() is also how ORDER is set -- it takes the full ordered list
 * of field internal names and lays out the content type's FieldLinks to
 * match. It is NOT documented on Microsoft Learn as a discoverable REST verb;
 * it was captured off a real payload fired by SharePoint's own "Edit form >
 * Edit columns" UI dialog (DevTools Network tab, POST to
 * `.../contenttypes('<ctid>')/ReorderFields()` with body
 * `{"fieldNames": [...]}`), per CLAUDE.md's "capture platform payloads, never
 * hand-author them" rule. An earlier guess at a `fieldlinks/reorder` action
 * with an `internalNames` parameter returned 200 and did nothing -- a
 * different, real CSOM method (`FieldLinkCollection.Reorder`) that exists but
 * is evidently not what actually drives this list's rendering.
 *
 * KNOWN LIMITATION, not fixed by this script -- READ BEFORE RE-STATING THE
 * GOAL AS "also fix Display":
 *
 * The ask was to hide these 11 fields from New/Edit while KEEPING them on the
 * read-only Display form (DispForm.aspx), since reading TasksComplete,
 * InstallerSignOffBy etc. there is legitimately useful. That half could NOT
 * be achieved. On this list (ContentTypesEnabled=false), the modern
 * NewForm/EditForm/DispForm panels all render off the SAME combined
 * field-visibility set. Two configurations were isolated and tested and BOTH
 * failed to keep a field on Display while hiding it from Edit:
 *
 *   A. FieldLink.Hidden=false + Field.ShowInEditForm=false/ShowInNewForm=false
 *      + Field.ShowInDisplayForm=true (explicitly set) -- field vanished from
 *      Display anyway.
 *   B. FieldLink.Hidden=true + Field.ShowInEditForm/ShowInNewForm reset to
 *      true -- field STILL did not appear on Display, despite Hidden being
 *      the one thing FieldLink.Hidden's own documentation says only affects
 *      New/Edit.
 *
 * WeekMonday is the one field that reliably shows on Display regardless --
 * but that is a Calculated-type special case (SharePoint always renders
 * Calculated columns as read-only info wherever it renders anything), not a
 * lever anything else in this list can use. Ordinary Number/Boolean/User
 * fields hidden from Edit are hidden from Display too, full stop, on this
 * list. This was tested exhaustively (isolated per-field, cache-busted
 * reloads, a fresh page navigation between tests) before being accepted as a
 * platform constraint rather than a bug in this script.
 *
 * Consequence accepted deliberately: TasksComplete/TasksTotal, sign-off
 * timestamps etc. are no longer visible from an item's Display panel. They
 * remain visible everywhere else that matters -- the card-formatted list
 * views (All Assignments, This Week by Job, etc. all show a TasksComplete /
 * TasksTotal progress bar and a sign-off pill) and via REST/Power Apps. If a
 * literal per-form split is ever required, the two known paths are (a)
 * ContentTypesEnabled=true, which is a bigger structural change with its own
 * risk, or (b) a Power Apps customized list form, which is real effort. Ask
 * before spending either.
 *
 * VERIFY BY OPENING THE FORM, per CLAUDE.md -- a 200/204 proves nothing on
 * this platform. This script does that itself only for the write calls it can
 * check headlessly (SchemaXml round-trip, FieldLink.Hidden read-back); the
 * REAL check is opening NewForm.aspx / EditForm.aspx?ID=<n> in a browser and
 * confirming order + absence, and saving once to prove the Required-drop
 * didn't strand anything. Do that after running this.
 *
 * Run in the browser console on
 * https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler while signed
 * in as stratirus@d2pools.com. Idempotent: re-running re-asserts the same
 * flags and re-issues the same ReorderFields() call.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const get = async u => (await fetch(u, { headers: H, credentials: 'include' })).json();
  const base = `${site}/_api/web/lists/GetByTitle('Assignments')`;

  // The field order the New/Edit forms should read in.
  const VISIBLE_ORDER = [
    'Title', 'Job', 'SubPhaseNumber', 'SubPhaseName', 'Crew', 'Trade',
    'ScheduledStart', 'ScheduledFinish', 'DurationDays', 'WorkDate',
    'Locked', 'NotApplicable', 'SignOffNotes'
  ];

  // Flow- and canvas-app-owned fields: hidden from New/Edit, still readable
  // from views and REST. JobAddress/JobCity are the read-only lookup-projected
  // fields, included here (unchanged, already New/Edit-excluded by their own
  // ReadOnlyField=true) purely so ReorderFields() sees every real field and
  // does not accidentally mark something Hidden that was never meant to be.
  const HIDE_FROM_EDIT = [
    'Sequence', 'TasksTotal', 'TasksComplete', 'WeekMonday', 'SuppressReconcileUntil',
    'InstallerSignOff', 'InstallerSignOffBy', 'InstallerSignOffOn',
    'PMSignOff', 'PMSignOffBy', 'PMSignOffOn',
    'JobAddress', 'JobCity'
  ];

  const results = { hide: [], required: [], reorder: null, weekMondayExtraPass: null, formFormatter: null };

  // 1. Field-level ShowInEditForm/ShowInNewForm=false for every field that
  //    should disappear from New/Edit. Works on its own for 10 of 11; the
  //    11th (WeekMonday, Calculated) needs the ReorderFields exclusion below
  //    as well.
  for (const n of HIDE_FROM_EDIT) {
    if (n === 'JobAddress' || n === 'JobCity') continue; // already ReadOnly-excluded, leave alone
    const fbase = base + `/fields/getbyinternalnameortitle('${n}')`;
    const r1 = await fetch(fbase + '/setShowInEditForm(value=@v)?@v=false', { method: 'POST', credentials: 'include', headers: HD });
    const r2 = await fetch(fbase + '/setShowInNewForm(value=@v)?@v=false', { method: 'POST', credentials: 'include', headers: HD });
    results.hide.push({ field: n, editStatus: r1.status, newStatus: r2.status });
  }

  // 2. Drop Required on the three booleans; confirm DefaultValue='0' (false)
  //    so existing/future rows stay valid. DurationDays is NOT touched here --
  //    it stays Required by design.
  for (const n of ['Locked', 'NotApplicable', 'PMSignOff']) {
    const fbase = base + `/fields/getbyinternalnameortitle('${n}')`;
    const r = await fetch(fbase, {
      method: 'POST', credentials: 'include',
      headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
      body: JSON.stringify({ __metadata: { type: 'SP.Field' }, Required: false, DefaultValue: '0' })
    });
    const after = await get(fbase + '?$select=Required,DefaultValue');
    results.required.push({ field: n, mergeStatus: r.status, Required: after.d.Required, DefaultValue: after.d.DefaultValue });
  }

  // 3. Order the visible 13, and set FieldLink.Hidden=FALSE for the hidden 11
  //    plus JobAddress/JobCity/-- everything is included in this ONE call, in
  //    visible-order-first then hidden-fields order, so FieldLink.Hidden ends
  //    up false for all of them. Field-level ShowInEditForm/ShowInNewForm
  //    (step 1) is what actually keeps them off New/Edit; FieldLink.Hidden
  //    only needs to stay false because Hidden=true was found (see header) to
  //    ALSO suppress Display, and true here would be pure downside.
  {
    const cts = await get(base + "/contenttypes?$select=Name,Id/StringValue");
    const ctId = cts.d.results[0].Id.StringValue;
    const fieldNames = [...VISIBLE_ORDER, ...HIDE_FROM_EDIT];
    const ro = await fetch(`${base}/contenttypes('${ctId}')/ReorderFields()`, {
      method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({ fieldNames })
    });
    results.reorder = { status: ro.status, fieldCount: fieldNames.length };

    // 4. Second pass: WeekMonday specifically needs FieldLink.Hidden=TRUE to
    //    actually leave New/Edit (its Calculated type ignores the field-level
    //    flag -- see header). Exclude it alone in a follow-up ReorderFields()
    //    call. Everything else stays in the same order from step 3.
    const withoutWeekMonday = fieldNames.filter(n => n !== 'WeekMonday');
    const ro2 = await fetch(`${base}/contenttypes('${ctId}')/ReorderFields()`, {
      method: 'POST', credentials: 'include', headers: HD,
      body: JSON.stringify({ fieldNames: withoutWeekMonday })
    });
    const flCheck = await get(base + `/contenttypes('${ctId}')/fieldlinks?$select=Name,Hidden&$filter=Name eq 'WeekMonday'`);
    results.weekMondayExtraPass = { status: ro2.status, hiddenNow: flCheck.d.results[0]?.Hidden };
  }

  // 5. Form FORMATTING: navy header, four sections in job order, footer
  //    carrying the crew-code rule. Written to the content type's
  //    ClientFormCustomFormatter.
  //
  //    THE KEY NAMES ARE `headerJSONFormatter` / `bodyJSONFormatter` /
  //    `footerJSONFormatter`. This is NOT documented anywhere on Microsoft
  //    Learn -- the docs describe the Header/Body/Footer regions and give the
  //    JSON for each region's *contents*, but never the wrapper that holds all
  //    three. Three plausible wrappers were tried first and ALL THREE returned
  //    204, round-tripped byte-for-byte, and rendered absolutely nothing:
  //        {"Header": "<stringified json>", ...}   // regions as JSON strings
  //        {"Header": {...}, ...}                  // regions as objects
  //        {"header": {...}, ...}                  // lowercase keys
  //    The real shape was CAPTURED, per CLAUDE.md's standing rule, by opening
  //    the item panel > Edit form > Configure layout, pasting a header
  //    formatter into SharePoint's own Format pane, saving, and then reading
  //    ClientFormCustomFormatter back over REST to see what it had written.
  //    Do not "tidy" these key names.
  //
  //    Reaching that pane is itself fiddly and worth writing down: the command
  //    does NOT exist on the full-page DispForm.aspx/EditForm.aspx, nor on
  //    DispForm with env=WebViewList. It only appears on the item panel opened
  //    from a list VIEW, and the row has to be opened with a real CDP click --
  //    synthetic MouseEvents dispatched at the title cell only select the row,
  //    because Fluent ignores untrusted events.
  //
  //    `fieldsettings: [{name, readonly:true}]` is what makes SubPhaseNumber /
  //    SubPhaseName non-editable. Microsoft's own page still calls this
  //    "proposed", so it was verified by opening the form rather than trusted:
  //    on this tenant the two fields are omitted from the Edit form entirely
  //    rather than rendered as read-only text. That is why the header repeats
  //    the sub-phase number and name -- they are machine-owned by D2 - New
  //    Pool and tied to Sequence, so a PM should see them but never type them.
  //
  //    No raw '<' or '&' appears anywhere in this JSON, deliberately. A VIEW
  //    formatter containing either fails with HTTP 500 because it is persisted
  //    inside the view's XML (see CLAUDE.md). Content types are XML-backed
  //    too, so the same discipline is applied here as cheap insurance; it has
  //    not been proven to bite on this property.
  {
    const NAVY = '#082544', GREEN = '#0b594b', CREAM = '#f6f3ed';
    const chip = { padding: '2px 9px', 'border-radius': '10px', 'font-size': '11px',
                   'font-weight': '600', 'margin-right': '8px', display: 'inline-block' };

    const headerJSONFormatter = {
      elmType: 'div',
      style: { 'background-color': NAVY, padding: '14px 18px', 'border-radius': '4px',
               width: '100%', 'box-sizing': 'border-box' },
      children: [
        { elmType: 'div',
          style: { 'font-size': '17px', 'font-weight': '600', color: '#ffffff', 'padding-bottom': '9px' },
          txtContent: '[$Title]' },
        { elmType: 'div', style: { 'font-size': '12px', 'padding-bottom': '6px' }, children: [
          { elmType: 'span', style: { ...chip, 'background-color': '#1d3a57', color: '#dbe6f0' },
            txtContent: "=if([$Crew] == '', 'No crew assigned', 'Crew ' + [$Crew])" },
          { elmType: 'span',
            style: { ...chip, color: '#ffffff',
                     'background-color': "=if([$InstallerSignOff] == true, '#0b594b', '#8a3b18')" },
            txtContent: "=if([$InstallerSignOff] == true, 'Signed off', 'Not signed off')" }
        ]},
        { elmType: 'div', style: { color: '#9fb2c4', 'font-size': '11px' },
          txtContent: "='Sub-phase ' + [$SubPhaseNumber] + ' of 46   ' + [$SubPhaseName]" }
      ]
    };

    // Sections render in this order. A column named in NO section lands in the
    // LAST one, which is why 'Other' exists and is empty: it catches
    // Attachments, Content Type, and anything added to the list later, instead
    // of them silently appending to 'Sign-off and conflicts'.
    const bodyJSONFormatter = {
      sections: [
        { displayname: 'Pool and sub-phase',     fields: ['Title', 'Job', 'SubPhaseNumber', 'SubPhaseName', 'Trade'] },
        { displayname: 'Schedule',               fields: ['ScheduledStart', 'ScheduledFinish', 'DurationDays', 'WorkDate'] },
        { displayname: 'Crew and status',        fields: ['Crew', 'Locked', 'NotApplicable'] },
        { displayname: 'Sign-off and conflicts', fields: ['SignOffNotes', 'ConflictWith'] },
        { displayname: 'Other',                  fields: [] }
      ],
      fieldsettings: [
        { name: 'SubPhaseNumber', readonly: true },
        { name: 'SubPhaseName',   readonly: true }
      ]
    };

    // The footer puts the crew-code rule where the mistake actually happens.
    // Crew is free text guarded by a column validation formula (see
    // guard-crew-values.js); this is the human-readable half of that guard.
    const footerJSONFormatter = {
      elmType: 'div',
      style: { padding: '10px 12px', 'background-color': CREAM, 'border-left': '3px solid ' + GREEN,
               'font-size': '12px', color: '#3a4a42', width: '100%', 'box-sizing': 'border-box' },
      txtContent: 'Crew must be a short code in lower case: devon, saul, guillermo, harrison, antonio, cirilo, campos, stl, george, armondo, brothers, subcon, office, unassigned. Never the display name. A code that is not on this list matches nothing, so the row is skipped by dispatch and by conflict detection.'
    };

    const cts2 = await get(base + "/contenttypes?$select=Name,Id/StringValue");
    const ctId2 = cts2.d.results[0].Id.StringValue;
    const value = JSON.stringify({ headerJSONFormatter, bodyJSONFormatter, footerJSONFormatter });
    const fr = await fetch(`${base}/contenttypes('${ctId2}')`, {
      method: 'POST', credentials: 'include',
      headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
      body: JSON.stringify({ __metadata: { type: 'SP.ContentType' }, ClientFormCustomFormatter: value })
    });
    const back = await get(base + `/contenttypes('${ctId2}')?$select=ClientFormCustomFormatter`);
    const stored = back.d.ClientFormCustomFormatter || '';
    results.formFormatter = {
      status: fr.status,
      storedLen: stored.length,
      roundTrips: stored === value,
      keys: stored ? Object.keys(JSON.parse(stored)) : []
    };
  }

  console.table(results.hide);
  console.table(results.required);
  console.log('ReorderFields:', results.reorder, '| WeekMonday follow-up:', results.weekMondayExtraPass);
  console.log('Form formatter:', results.formFormatter);
  console.log('Now VERIFY BY OPENING THE FORM -- see the header comment. This script cannot check what a browser renders.');
  return results;
})();
