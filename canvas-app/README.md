# canvas-app

Week 3: the crew-lead sign-off + task-tick canvas app, built in **D2 Automation**
against the live SharePoint lists, signed in as **D2 Bot** (`stratirus@d2pools.com`).

## Verdict on headless authoring — SPIKED 2026-09-06, ANSWER IS NO

The question was whether the app could be authored as source and packed, the way the
five Power Automate flows were built with no designer. **It cannot.** Build in Studio.

`pac` 2.11.2 round-trips cleanly, so the temptation is real: `pac canvas unpack` on a
blank app yields just three tiny YAML files, and `pack` → `unpack` returns byte-identical
sources. But three things make it a dead end as a *primary authoring* path:

1. **Data connections are not expressible in YAML.** They live in the `.msapr` binary
   residual — `References/DataSources.json` and `Properties.json`'s
   `LocalConnectionReferences`. This app needs four SharePoint list connections plus the
   Flow 2 connector, and none of them can be declared in source. This alone is fatal,
   and it would have surfaced at Day 1 Step 2 of the Week 3 spec.
2. **There is no `pac canvas upload`.** The verbs are `download / list / pack / unpack /
   validate / create`. A packed `.msapp` can only re-enter the environment through Studio
   (or a solution import, which the Default solution does not support — same wall the
   flows hit).
3. **Microsoft scopes it explicitly.** Every generated file carries: *"YAML source code
   for Canvas Apps should only be used to review changes made within Power Apps Studio
   and for minor edits (Preview)."* `pack` itself warns that anything packed from YAML
   *"must be validated first by opening the app for edit within the Power Apps studio."*

## What YAML IS good for, and we should use it

Version control and review. A Studio-built app becomes a readable diff:

```yaml
App:
  Properties:
    Theme: =PowerAppsTheme
```

**Workflow after every Studio session:**

```bash
pac canvas download --name "D2 Sign-off" \
  --file-name canvas-app/msapp/D2-Sign-off.msapp \
  --environment 2710a01b-6cfa-e820-b338-2286f2649300 --overwrite
pac canvas unpack --msapp canvas-app/msapp/D2-Sign-off.msapp \
  --sources canvas-app/src --layout SourceCode
git add canvas-app && git commit -m "canvas: <what changed in Studio>"
```

That gives reviewable formula-level diffs of Studio work, which we did not have before.
Do **not** combine `--file-name` with `--extract-to-directory`; the command silently
prints usage instead of running. Run `download` then `unpack` as two steps.

## Files

| Path | What |
|---|---|
| `msapp/D2-Sign-off.msapp` | The packed app as downloaded from D2 Automation |
| `src/Src/*.pa.yaml` | Reviewable Power Fx source (App, screens, editor state) |
| `src/*.msapr` | Binary residual: themes, control JSON, **data sources**, publish info |
| `blank-lead-email.js` | One-off: cleared the `Crews.LeadEmail` placeholders (done 2026-09-06) |
| `mirror-provision.js` | Live-schema capture, retained as reference. Not needed for the build |

App ID `97fec10b-f23c-434c-96b1-fd61ce562d08`, DocVersion 1.349.

## Prerequisites, all verified 2026-09-06

- `pac auth create --tenant f24d9b39-6a71-4f4e-a376-03b6f61c97e4 --name D2`, signed in as
  `stratirus@d2pools.com`. **This sign-in revokes existing `az` tokens tenant-wide**
  (`TokensValidFrom` is bumped), so `az login` is needed again before the next `PublishXml`.
- Flow 3 is **Stopped** so app writes to Assignments do not burn runs on its no-op trigger.
- `Crews.LeadEmail` is empty on all 14 rows, so the app must fall through to the PM-proxy
  picker. That path is required anyway for the four `Unlimited` subcontractor crews.
- 282 Tasks rows across all 43 assignments, so the task-tick screen has real data.
