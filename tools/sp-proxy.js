#!/usr/bin/env node
/* Run one of the console-paste scripts in sharepoint/ under Node, with its fetch forwarded through a
 * throwaway Request-triggered proxy flow that runs SharePoint REST as D2 Bot. The recipe for the
 * flow is in CLAUDE.md ("A REQUEST-TRIGGERED FLOW IS A GENERIC SHAREPOINT REST PROXY"); it was never
 * committed before this file, so each session rebuilt it by hand.
 *
 *   D2_PROXY_URL='<callback url>' node tools/sp-proxy.js sharepoint/gate-template-lists.js [--write] [--lists a,b,c]
 *
 * The script runs exactly as pasted: `window` exists and carries the flags a script reads
 * (--write sets every window.D2_*_WRITE flag true and window.D2_DRY false), `fetch` is the shim
 * below, and the script's own return value is printed as JSON.
 *
 * The shim strips the site prefix off each URL (the connector takes a site-relative uri), drops
 * X-RequestDigest (the connector signs its own calls) and answers /_api/contextinfo locally so a
 * script that fetches a digest before writing still runs. A SharePoint 4xx comes back from the
 * proxy as a 500 whose body is the connector's error, so the script sees !ok and the message.
 *
 * DELETE THE PROXY FLOW WHEN DONE. While it exists its callback URL runs arbitrary REST on the site.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const SITE = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler';
const url = process.env.D2_PROXY_URL;
const file = process.argv[2];
const write = process.argv.includes('--write');
if (!url || !file) {
  console.error("usage: D2_PROXY_URL='<callback url>' node tools/sp-proxy.js <sharepoint/script.js> [--write]");
  process.exit(2);
}

async function proxyFetch(u, opts) {
  u = String(u); opts = opts || {};
  if (u.startsWith(SITE + '/_api/contextinfo')) {
    return { ok: true, status: 200, text: async () => '{"FormDigestValue":"proxy"}', json: async () => ({ FormDigestValue: 'proxy' }) };
  }
  if (!u.startsWith(SITE + '/')) throw new Error('sp-proxy only forwards site URLs, got ' + u);
  const headers = Object.assign({}, opts.headers || {});
  delete headers['X-RequestDigest'];
  const payload = { method: (opts.method || 'GET').toUpperCase(), uri: u.slice(SITE.length + 1), headers };
  if (opts.body != null) payload.body = String(opts.body);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text: async () => text, json: async () => (text ? JSON.parse(text) : {}) };
}

const src = fs.readFileSync(path.resolve(file), 'utf8');
const window = { D2_DRY: !write };
const li = process.argv.indexOf('--lists');
if (li > 0 && process.argv[li + 1]) window.D2_GATE_LISTS = process.argv[li + 1].split(',').map(x => x.trim()).filter(Boolean);
['D2_GATE_WRITE', 'D2_WRITE', 'RENUMBER_WRITE'].forEach(k => { window[k] = write; });
const sandbox = { window, fetch: proxyFetch, console, URL, URLSearchParams, setTimeout, clearTimeout };
sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
Promise.resolve(vm.runInContext(src, sandbox, { filename: file }))
  .then(out => { if (out !== undefined) console.log('\n== script returned ==\n' + JSON.stringify(out, null, 2)); })
  .catch(e => { console.error('script failed: ' + (e && e.stack || e)); process.exit(1); });
