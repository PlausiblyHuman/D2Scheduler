# Planner fixtures

Behaviour tests for `D2-Build-Scheduler/D2-Build-Scheduler/app/pool-scheduler.html`,
the browser planner. They run the real file in jsdom, so they test what a PM's
browser actually executes rather than a copy of the logic.

```
npm install jsdom          # once, anywhere on the path
node fixtures/planner/determinism.js
node fixtures/planner/roundtrip.js
node fixtures/planner/empty.js
node oracle-test.js         # the original 16-invariant harness (repo root)
```

| File | What it pins |
|---|---|
| `determinism.js` | Auto-Schedule is idempotent from a settled state. Before the 2026-09-11 patch, 4 of 138 crew picks oscillated on every re-run. |
| `roundtrip.js` | `Load from D2` merges a SharePoint export correctly: live pools update, local-only pools survive, sign-offs lock against Auto-Schedule, task text stays local. |
| `empty.js` | A first-run browser seeds no phantom pools and still renders. |

`roundtrip.js` builds its payload from the planner's own `SEED_TEMPLATE`, in the
exact shape `sharepoint/export-to-planner.js` emits. It does not touch the D2
tenant and needs no credentials.

**Why these exist:** the planner sat untouched from 2026-08-13 to 2026-09-11
while everything around it changed, and two patches the repo claimed were applied
were not. Nothing was checking. These are cheap and they run offline.
