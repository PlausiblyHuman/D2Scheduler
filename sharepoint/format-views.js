/* Card formatting for the office SharePoint views.
 *
 * WHY: a SharePoint list view renders as a grey table by default. JSON
 * formatting is the native lever for both the row and the item panel, and it
 * needs no premium licensing.
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

  // ------------------------------------------------------------- timeline lane
  // A Gantt-style lane of one cell per day across a fixed window centred on
  // today. Every row renders the same 28 cells at the same widths, so bars line
  // up across rows WITHOUT position:absolute -- which matters, because
  // SharePoint sanitises style attributes against an allowlist and `position`
  // is not something to bet a render on.
  //
  // The only platform primitive this relies on is Number() returning epoch
  // milliseconds for a date field. Everything else is comparison arithmetic --
  // no floor(), no ceiling(), no addDays(), none of which are safe to assume
  // are in SharePoint's expression language.
  //
  // Cell d (days from today) paints when the row's span covers that day:
  //     start  day index <= d    <=>   d       * 864e5 >= Number(start)  - Number(@now)
  //     finish day index >= d    <=>   Number(finish) - Number(@now) > (d - 1) * 864e5
  //
  // NEVER WRITE `<` OR `&` IN A VIEW FORMATTER -- so no `<`, no `<=`, no `&&`.
  // A view's CustomFormatter is persisted inside the view's XML schema and is
  // NOT escaped on the way in, so the server hands the raw text to an XML parser
  // and any character that is special in XML fails the whole MERGE with HTTP 500.
  // Both were hit in turn on 2026-09-08, and neither message names the character
  // actually at fault:
  //
  //   `<=`  ->  Name cannot begin with the '=' character, hexadecimal value
  //             0x3D. Line 1, position 280.
  //             (the parser sees `<` open a tag; it is complaining about the `=`
  //             that follows, so this reads like a broken expression)
  //   `&&`  ->  An error occurred while parsing EntityName. Line 1, position 3503.
  //             (the parser sees `&` open an entity reference)
  //
  // The `<` case was confirmed by A/B: two formatters identical but for `<= 0`
  // versus `0 >=`, the first 500s and the second 204s. The workarounds cost
  // nothing -- flip the operands to use `>` / `>=`, and express AND as a nested
  // `if` rather than `&&`. `>` is legal as raw text in XML content and is fine.
  //
  // The rest of this file predates the finding only because it happened never to
  // need either character.
  //
  // Those hold at ANY time of day. Date-only fields are stored at local
  // midnight (see CLAUDE.md's DateTime storage convention), so for today's date
  // Number(date) - Number(@now) sits in (-864e5, 0] and both comparisons are
  // unaffected by how far into the day it is. The one imprecision is the DST
  // changeover, where local midnight shifts by an hour: a row viewed within an
  // hour of midnight on the changeover date could paint one cell out. Two days
  // a year, at midnight, on a decorative bar -- not worth complicating for.
  const DAY = 86400000;
  const BEFORE = 7, AFTER = 21, CELLS = BEFORE + AFTER;
  const TRACK = '#eef1f5', GRID = '#d1d5db';

  // reuses the card's own status logic so the bar cannot disagree with the
  // left border and the pill
  const barColour =
    `if(${T('InstallerSignOff')}, '${GREEN}', if([$TasksComplete] > 0, '${AMBER}', '${GREY}'))`;

  const dayCell = i => {
    const d = i - BEFORE;
    const afterStart = `${d * DAY} >= (Number([$ScheduledStart]) - Number(@now))`;
    const beforeEnd = `(Number([$ScheduledFinish]) - Number(@now)) > ${(d - 1) * DAY}`;
    const style = {
      'width': (100 / CELLS).toFixed(4) + '%',
      'height': '10px',
      'flex-shrink': '0',
      'box-sizing': 'border-box',
      // nested if, not `&&` -- see the XML note above
      'background-color':
        `=if(${afterStart}, if(${beforeEnd}, ${barColour}, '${TRACK}'), '${TRACK}')`
    };
    // today gets a navy rule; every seventh cell a faint week gridline
    if (d === 0) style['border-left'] = `2px solid ${NAVY}`;
    else if (i % 7 === 0 && i !== 0) style['border-left'] = `1px solid ${GRID}`;
    return { elmType: 'div', style };
  };

  const timelineLane = () => ({
    elmType: 'div',
    style: { 'display': 'flex', 'width': '100%', 'margin-top': '6px',
             'border-radius': '2px', 'overflow': 'hidden' },
    children: Array.from({ length: CELLS }, (_, i) => dayCell(i))
  });

  // ---------------------------------------------------------------- Assignments
  // `timeline` is opt-in per view: the lane earns its place on the whole-job
  // views, where a month of sub-phases marching across the window is the point.
  // On Today by Crew and This Week by Crew a 28-day window is mostly empty
  // space around a short bar, so those keep the plain card.
  const makeAssignmentCard = (timeline, conflict) => ({
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
          ] },
        // ADDED 2026-09-09, `conflict` param: the Conflicts view's whole reason
        // to exist is surfacing what `D2 - Conflict Flag` wrote overnight, so
        // that text needs to read as a warning, not a footnote. Guarded on
        // [$ConflictWith] == '' anyway (not just view-filter reliance) so this
        // card stays correct if ever reused on an unfiltered view.
        ...(conflict ? [{
          elmType: 'div',
          style: {
            'display': "=if([$ConflictWith] == '', 'none', 'flex')",
            'align-items': 'center', 'gap': '6px', 'margin-top': '2px',
            'padding': '4px 8px', 'border-radius': '3px',
            'background-color': '#fff7ed', 'color': AMBER,
            'font-size': '12px', 'font-weight': '600'
          },
          txtContent: "='⚠ ' + [$ConflictWith]"
        }] : []),
        ...(timeline ? [timelineLane()] : [])
      ]
    }
  });

  // ----------------------------------------------------------------------- Jobs
  // `Planned Pools` (filter `Status eq 'Planned'`) was the only one of the nine
  // built views with no formatter, found in the 2026-09-09 whole-branch review --
  // PMs are told to use it (Phase F step 5, confirm a commit) and it rendered as
  // a plain grey table beside eight formatted ones. Same card shape as
  // Assignments (left border, title line, detail lines) but sized to Jobs'
  // fields: JobNumber/Title, Address/City, ProjectManager/StartDate, and a
  // Status pill instead of the sign-off/progress pill, since Jobs has no
  // InstallerSignOff or TasksComplete to key off.
  const jobCard = {
    $schema: 'https://developer.microsoft.com/json-schemas/sp/v2/row-formatting.schema.json',
    hideColumnHeader: true,
    hideSelection: true,
    rowFormatter: {
      elmType: 'div',
      style: {
        'display': 'flex', 'flex-direction': 'column', 'gap': '4px',
        'width': '100%', 'box-sizing': 'border-box', 'align-items': 'flex-start',
        'text-align': 'left',
        'padding': '10px 14px', 'margin': '4px 0', 'border-radius': '4px',
        'background-color': '#ffffff', 'box-shadow': '0 1px 2px rgba(8,37,68,.12)',
        'border-left': '4px solid',
        // Active/Complete read as done-ish (green), Planned as awaiting
        // commit (amber), On Hold as parked (grey) -- nested if, not a
        // lookup table, so this stays one expression with no `&&`/`<=`.
        'border-left-color':
          `=if([$Status] == 'Active', '${GREEN}', if([$Status] == 'Planned', '${AMBER}', if([$Status] == 'On Hold', '${GREY}', '${GREEN}')))`
      },
      children: [
        { // job number + name + status pill
          elmType: 'div',
          style: { 'display': 'flex', 'align-items': 'center', 'flex-wrap': 'wrap' },
          children: [
            { elmType: 'span',
              style: { 'font-size': '15px', 'font-weight': '600', 'color': NAVY },
              txtContent: "=[$JobNumber] + '  ' + [$Title]" },
            { elmType: 'span',
              style: {
                'padding': '2px 8px', 'border-radius': '10px', 'font-size': '11px',
                'font-weight': '600', 'white-space': 'nowrap', 'color': '#ffffff',
                'margin-left': '8px',
                'background-color':
                  `=if([$Status] == 'Active', '${GREEN}', if([$Status] == 'Planned', '${AMBER}', if([$Status] == 'On Hold', '${GREY}', '${GREEN}')))`
              },
              txtContent: '=[$Status]' }
          ]
        },
        { // address
          elmType: 'div',
          style: { 'font-size': '12px', 'color': '#4b5563' },
          txtContent: "=[$Address] + ', ' + [$City]"
        },
        { // PM and start date
          elmType: 'div',
          style: { 'font-size': '12px', 'color': GREY },
          txtContent: "=[$ProjectManager.title] + '   ·   starts ' + [$StartDate.displayValue]"
        }
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

  const plainCard = makeAssignmentCard(false);
  const timelineCard = makeAssignmentCard(true);
  // conflict banner, no timeline lane -- a one-day-or-two overlap window is not
  // the multi-week span the lane earns its place on, and the warning line is
  // the thing this view exists to show.
  const conflictCard = makeAssignmentCard(false, true);

  const TARGETS = [
    ['Assignments', 'All Assignments', timelineCard],
    ['Assignments', 'This Week by Crew', plainCard],
    // ADDED 2026-09-09: same card as its sibling "This Week by Crew" -- a
    // Mon-Sun window is short enough that the plain card reads fine, and the
    // whole point is that the two views feel like siblings, not that one
    // looks like a different product because it groups by Job instead of Crew.
    ['Assignments', 'This Week by Job', plainCard],
    ['Assignments', 'Unassigned', plainCard],
    ['Assignments', 'Sign-off Overdue', plainCard],
    ['Assignments', 'Late-Starting Jobs', timelineCard],
    ['Assignments', 'Today by Crew', plainCard],
    ['Assignments', 'Conflicts', conflictCard],
    ['Tasks', 'All Tasks (by Assignment)', taskRow],
    ['Tasks', 'Incomplete Tasks', taskRow],
    ['Jobs', 'Planned Pools', jobCard]
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
