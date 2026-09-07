/* Card formatting for the office SharePoint views.
 *
 * WHY: Shane's feedback on the launchpad was "seems plain overall. The cards
 * that open out are fairly plain too." He was right, and the first diagnosis
 * (reach for a header photo) was wrong. A SharePoint list view renders as a
 * grey table by default; the real lever is JSON formatting, which SharePoint
 * supports natively on both the row and the item panel. No premium anything.
 *
 * Palette is D2's, measured from d2pools.com computed styles and matching both
 * the site theme and the canvas app:
 *     #082544  navy    headings, primary text
 *     #0B594B  green   done / signed off
 *     #B45309  amber   in progress
 *     #6B7280  grey    not started
 *
 * FIELD NAMES were read off the live list, not assumed. In particular
 * JobAddress and JobCity are LOOKUP-PROJECTED fields on Assignments, projected
 * through the Job lookup, and are read-only -- which is why a schema query
 * filtered on ReadOnlyField eq false does not show them at all.
 *
 * Booleans are compared defensively. SharePoint JSON formatting has returned
 * Yes/No fields as boolean true, as the string 'Yes', and as '1' depending on
 * context and schema version, so every check accepts all three rather than
 * betting on one.
 *
 * TasksTotal is guarded against zero before dividing -- Counter Reconciliation
 * found four Harrison rows with NULL counters, so a zero or missing total is a
 * state that really occurs.
 *
 * A view can be given invalid formatter JSON and fail only when a human opens
 * it, exactly like invalid CAML. Applying it returns 204 regardless. VERIFY BY
 * OPENING THE VIEW, not by the status code.
 *
 * Run in the browser console on the site, signed in as stratirus@d2pools.com.
 * Idempotent: re-running overwrites the formatter with the same value.
 */
(async () => {
  const site = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
  const H = { Accept: 'application/json;odata=verbose', 'Content-Type': 'application/json;odata=verbose' };
  const dg = await (await fetch(site + '/_api/contextinfo', { method: 'POST', headers: H, credentials: 'include' })).json();
  const HD = { ...H, 'X-RequestDigest': dg.d.GetContextWebInformation.FormDigestValue };
  const get = async u => (await fetch(u, { headers: H, credentials: 'include' })).json();
  const q = s => s.replace(/'/g, "''");

  const NAVY = '#082544', GREEN = '#0b594b', AMBER = '#b45309', GREY = '#6b7280';

  // truthy across every shape SharePoint has been observed to return for Yes/No
  const T = f => `(([$${f}] == true) || ([$${f}] == 'Yes') || ([$${f}] == '1'))`;

  const pill = (text, colour, bg) => ({
    elmType: 'span',
    style: { 'padding': '2px 8px', 'border-radius': '10px', 'font-size': '11px',
             'font-weight': '600', 'white-space': 'nowrap', 'color': colour,
             'background-color': bg, 'margin-left': '8px' },
    txtContent: text
  });

  // ---------------------------------------------------------------- Assignments
  const assignmentCard = {
    $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/row-formatting.schema.json',
    hideColumnHeader: true,
    hideSelection: true,
    rowFormatter: {
      elmType: 'div',
      style: {
        // width/box-sizing/align-items are load-bearing: without them SharePoint's
        // row container shrink-wraps the card and centres it, so it renders as a
        // narrow block floating mid-row instead of a full-width card.
        'display': 'flex', 'flex-direction': 'column', 'gap': '4px',
        'width': '100%', 'box-sizing': 'border-box', 'align-items': 'flex-start',
        'text-align': 'left',
        'padding': '10px 14px', 'margin': '4px 0', 'border-radius': '4px',
        'background-color': '#ffffff', 'box-shadow': '0 1px 2px rgba(8,37,68,.12)',
        'border-left': '4px solid',
        'border-left-color': `=if(${T('InstallerSignOff')}, '${GREEN}', if([$TasksComplete] > 0, '${AMBER}', '${GREY}'))`
      },
      children: [
        { // title line + status pill
          elmType: 'div',
          style: { 'display': 'flex', 'align-items': 'center', 'flex-wrap': 'wrap' },
          children: [
            { elmType: 'span',
              style: { 'font-size': '15px', 'font-weight': '600', 'color': NAVY },
              txtContent: "=[$SubPhaseNumber] + '  ' + [$SubPhaseName]" },
            { elmType: 'span',
              style: { 'display': `=if(${T('InstallerSignOff')}, 'inline', 'none')` },
              children: [pill('SIGNED OFF', '#ffffff', GREEN)] },
            { elmType: 'span',
              style: { 'display': `=if(${T('InstallerSignOff')}, 'none', if([$TasksComplete] > 0, 'inline', 'none'))` },
              children: [pill('IN PROGRESS', '#ffffff', AMBER)] },
            { elmType: 'span',
              style: { 'display': `=if(${T('InstallerSignOff')}, 'none', if([$TasksComplete] > 0, 'none', 'inline'))` },
              children: [pill('NOT STARTED', '#ffffff', GREY)] }
          ]
        },
        { // job + address
          elmType: 'div',
          style: { 'font-size': '12px', 'color': '#4b5563' },
          txtContent: "=[$Title]"
        },
        { // crew and dates
          elmType: 'div',
          style: { 'font-size': '12px', 'color': GREY },
          txtContent: "=[$Crew] + '   ·   ' + [$ScheduledStart.displayValue] + '  to  ' + [$ScheduledFinish.displayValue]"
        },
        { // progress bar + count
          elmType: 'div',
          style: { 'display': 'flex', 'align-items': 'center', 'gap': '8px', 'margin-top': '2px' },
          children: [
            { elmType: 'div',
              style: { 'width': '140px', 'height': '6px', 'border-radius': '3px',
                       'background-color': '#e5e7eb', 'overflow': 'hidden' },
              children: [
                { elmType: 'div',
                  style: {
                    'height': '6px', 'border-radius': '3px',
                    'background-color': `=if(${T('InstallerSignOff')}, '${GREEN}', '${AMBER}')`,
                    // guard against a zero or missing total before dividing
                    'width': "=if([$TasksTotal] > 0, ((Number([$TasksComplete]) / Number([$TasksTotal])) * 100) + '%', '0%')"
                  } }
              ] },
            { elmType: 'span',
              style: { 'font-size': '11px', 'color': GREY },
              txtContent: "=[$TasksComplete] + ' / ' + [$TasksTotal] + ' tasks'" }
          ] }
      ]
    }
  };

  // ---------------------------------------------------------------------- Tasks
  const taskRow = {
    $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/row-formatting.schema.json',
    hideColumnHeader: true,
    hideSelection: true,
    rowFormatter: {
      elmType: 'div',
      style: { 'display': 'flex', 'align-items': 'center', 'gap': '10px',
               'width': '100%', 'box-sizing': 'border-box', 'text-align': 'left',
               'padding': '6px 14px', 'border-bottom': '1px solid #eef1f5' },
      children: [
        { elmType: 'span',
          style: { 'width': '18px', 'height': '18px', 'border-radius': '3px', 'flex-shrink': '0',
                   'display': 'flex', 'align-items': 'center', 'justify-content': 'center',
                   'font-size': '12px', 'font-weight': '700', 'color': '#ffffff',
                   'background-color': `=if(${T('Complete')}, '${GREEN}', if(${T('NotApplicable')}, '${GREY}', '#d1d5db'))` },
          txtContent: `=if(${T('Complete')}, '✓', if(${T('NotApplicable')}, '–', ''))` },
        { elmType: 'span',
          style: { 'font-size': '13px',
                   'color': `=if(${T('Complete')}, '${GREY}', '${NAVY}')`,
                   'text-decoration': `=if(${T('NotApplicable')}, 'line-through', 'none')` },
          txtContent: '=[$Title]' },
        { elmType: 'span',
          style: { 'font-size': '11px', 'color': GREY, 'margin-left': 'auto' },
          txtContent: "=if([$CompletedOn] == '', '', [$CompletedOn.displayValue])" }
      ]
    }
  };

  const TARGETS = [
    ['Assignments', 'All Assignments', assignmentCard],
    ['Assignments', 'This Week by Crew', assignmentCard],
    ['Assignments', 'Unassigned', assignmentCard],
    ['Assignments', 'Sign-off Overdue', assignmentCard],
    ['Assignments', 'Late-Starting Jobs', assignmentCard],
    ['Assignments', 'Today by Crew', assignmentCard],
    ['Tasks', 'All Tasks (by Assignment)', taskRow],
    ['Tasks', 'Incomplete Tasks', taskRow]
  ];

  const results = [];
  for (const [list, viewTitle, fmt] of TARGETS) {
    const base = `${site}/_api/web/lists/GetByTitle('${q(list)}')`;
    const views = await get(base + '/views?$select=Title,Id');
    const v = (views.d.results || []).find(x => x.Title === viewTitle);
    if (!v) { results.push({ list, view: viewTitle, action: 'VIEW NOT FOUND' }); continue; }
    const r = await fetch(`${base}/views('${v.Id}')`, {
      method: 'POST', credentials: 'include',
      headers: { ...HD, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
      body: JSON.stringify({ __metadata: { type: 'SP.View' },
                             CustomFormatter: JSON.stringify(fmt) }) });
    results.push({ list, view: viewTitle, status: r.status,
                   err: r.ok ? '' : (await r.text()).slice(0, 200) });
  }
  console.table(results);
  return results;
})();
