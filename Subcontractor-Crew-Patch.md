# Subcontractor crew patch — George, Armondo, STL Shotcrete, Brothers

Per Don's clarification: these four are subcontractors, not internal field crews. Treat them the same way the tool already treats `Main Office` and `Subcontractor` — capacity-exempt buckets with `unlimited: true`. They never get double-booked (multiple pools can list them on the same day), no roster is required, and no M365 seat is needed for them.

---

## Browser tool patch — `app/pool-scheduler.html`, SEED_CREWS array (lines 190–197)

Apply this diff:

```diff
-  {id:'george',   name:'George Crew',   members:[], size:null,
-    skills:['masonry','cmu'], note:'Crew size / members not specified'},
-  {id:'armondo',  name:'Armondo Crew',  members:[], size:null,
-    skills:['hardscape','coping'], note:'Crew size / members not specified'},
-  {id:'stl',      name:'STL Shotcrete', members:[], size:null,
-    skills:['dig','form','rebar','shotcrete','plumbing','pebbletech','plaster'], note:'Advanced pebbletech · size not specified'},
-  {id:'brothers', name:'Brothers Crew', members:[], size:null,
-    skills:['plaster','pebbletech'], note:'Crew size / members not specified'},
+  {id:'george',   name:'George Crew',   members:[], size:null, unlimited:true,
+    skills:['masonry','cmu'], note:'Subcontractor · capacity-exempt · no roster'},
+  {id:'armondo',  name:'Armondo Crew',  members:[], size:null, unlimited:true,
+    skills:['hardscape','coping'], note:'Subcontractor · capacity-exempt · no roster'},
+  {id:'stl',      name:'STL Shotcrete', members:[], size:null, unlimited:true,
+    skills:['dig','form','rebar','shotcrete','plumbing','pebbletech','plaster'], note:'Subcontractor · capacity-exempt · no roster'},
+  {id:'brothers', name:'Brothers Crew', members:[], size:null, unlimited:true,
+    skills:['plaster','pebbletech'], note:'Subcontractor · capacity-exempt · no roster'},
```

## Verify

After applying, run `Reset` in the tool once to reseed, then:

1. Confirm those four appear in the Crews tab with no size, no roster.
2. Confirm Auto-Schedule can now assign George Crew work — currently it can't because all George's trades (`masonry`, `cmu`) are unmapped from sub-phases (see §09 gap #2, still awaiting Don's answer on the 10 unmapped trades). Once Don maps `masonry` and `cmu` to real sub-phases, George should schedule.
3. Confirm nothing else regressed — run `oracle-test.js` if you have it in the workspace.

Note: the `unlimited:true` flag is what removes them from the busy-map check in `autoSchedule()`. It also means the `conflicts()` function will never flag them as double-booked — correct behavior for a subcontractor who can send different teams to different pools the same day.

---

## Same treatment in the Microsoft Lists path

On the Lists path, the four subcontractor crews get created in the `Crews` list with:

- `Unlimited = Yes`
- `Size` left blank
- `Members` left blank
- `Trades` set as-is from the browser tool

The event-driven reconciliation flow already respects the `Unlimited` flag — it skips capacity checks for any crew where `Unlimited = Yes`. No flow change required.

## What this doesn't fix

- The 10 unmapped trades (`walls, landscaping, grade, veneer, cmu, waterline, forms, pavers, brick/masonry, materials`) still need Don's mapping decision. George's trades (`masonry`, `cmu`) are in that list, so making him unlimited doesn't yet get him scheduled work — it just makes the model correct for when Don answers.
- The 11 Unassigned field-supervision sub-phases still need Don's PM-bucket decision.

Both are covered in the outstanding note to Don.
