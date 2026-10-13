/* Runs the real sharepoint/export-to-planner.js against captured payloads.
 *
 * The export script is browser code: it calls fetch, builds a Blob and clicks an
 * anchor to download. A `vm` sandbox supplying just those four globals is enough,
 * and is cheaper than a full DOM. Shared by live-export.js and workcalendar.js so
 * there is one fetch stub to keep in step with the script's list reads, not two.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = path.resolve(__dirname, '../../sharepoint/export-to-planner.js');

function runExport(live) {
  return new Promise((resolve, reject) => {
    let captured = null;
    const pick = url =>
      /GetByTitle\('Jobs'\)/.test(url) ? live.jobs :
      /GetByTitle\('Assignments'\)/.test(url) ? live.asg :
      /GetByTitle\('Tasks'\)/.test(url) ? live.tasks :
      // NEW: the export reads the Work Calendar as of Task 2. The list title has a
      // space, so it may arrive percent-encoded depending on how the URL was built.
      /GetByTitle\('Work(%20| )Calendar'\)/.test(url) ? (live.cal || []) :
      /GetByTitle\('Sub-phase(%20| )Template'\)/.test(url) ? (live.spt || []) :
      /GetByTitle\('Task(%20| )Template'\)/.test(url) ? (live.tpt || []) :
      /GetByTitle\('Trades'\)/.test(url) ? (live.trades || []) : null;

    const sandbox = {
      console: { log: () => {}, warn: () => {} },
      Date,
      Promise,
      Blob: class { constructor(parts) { this.parts = parts; } },
      URL: { createObjectURL: b => { captured = b.parts.join(''); return 'blob:stub'; } },
      document: {
        createElement: () => ({ set href(v) {}, download: '', click() {} })
      },
      fetch: async url => {
        const rows = pick(url);
        if (!rows) throw new Error('unexpected URL: ' + url);
        return { ok: true, status: 200, json: async () => ({ value: rows }) };
      }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const src = fs.readFileSync(SCRIPT, 'utf8');
    try {
      const p = vm.runInContext(src, sandbox);
      Promise.resolve(p).then(() => {
        // the anchor click happens synchronously before the summary
        setTimeout(() => captured ? resolve(JSON.parse(captured)) : reject(new Error('nothing downloaded')), 10);
      }, reject);
    } catch (e) { reject(e); }
  });
}

module.exports = { runExport };
