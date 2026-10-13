/* Copy named top-level keys from a captured JSON file into an existing target JSON file.
 * node fixtures/planner/merge-capture.js <captured.json> <target.json> key1 [key2 ...]
 * The target's other keys and its JSON.stringify(d, null, 1) formatting are preserved. */
const fs = require('fs');
const [, , capFile, targetFile, ...keys] = process.argv;
if (!capFile || !targetFile || !keys.length) {
  console.error('usage: node merge-capture.js <captured.json> <target.json> key1 [key2 ...]');
  process.exit(1);
}
if (!fs.existsSync(targetFile)) { console.error('target does not exist: ' + targetFile); process.exit(1); }
const cap = JSON.parse(fs.readFileSync(capFile, 'utf8'));
const missing = keys.filter(k => !(k in cap));
if (missing.length) { console.error('captured file lacks key(s): ' + missing.join(', ')); process.exit(1); }
const t = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
for (const k of keys) {
  t[k] = cap[k];
  console.log(k + ': ' + (Array.isArray(cap[k]) ? cap[k].length + ' rows' : typeof cap[k]));
}
fs.writeFileSync(targetFile, JSON.stringify(t, null, 1), 'utf8');
console.log('merged into ' + targetFile);
