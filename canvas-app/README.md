# canvas-app

Week 3: the crew-lead sign-off + task-tick canvas app, built in **D2 Automation**
against the live SharePoint lists, signed in as **D2 Bot** (`stratirus@d2pools.com`).

## Verdict on headless authoring — YES, confirmed working 2026-09-06

The question was whether the app could be authored as source and deployed without the
designer, the way the five Power Automate flows were built. **It can.** An earlier note
in this file said the opposite; that was written before the loop was tested end to end.

```
edit Src/*.pa.yaml
  -> pac canvas pack --layout SourceCode
  -> pac solution export
  -> swap the .msapp inside the solution zip
  -> pac solution import
  -> open in Studio once, Publish
```

`python deploy.py` runs all of it. Proven by deploying a Today screen that renders live
SharePoint data, with no control built by hand.

### The three things that make it work

1. **Connections survive the round trip.** They are not in the YAML — they live in the
   `.msapr` residual (`References/DataSources.json`, and `LocalConnectionReferences` in
   `Properties.json`). `unpack` writes the residual beside `Src/`, and `pack` folds it
   back in. All seven sources ride through untouched.
   **Never delete the `.msapr`. Never rebuild sources from a blank app.** Either would
   silently strip every data connection.
2. **The solution swap is accepted.** `customizations.xml` points at the app by path with
   no hash or checksum, so substituting the `.msapp` inside the exported zip just works.
3. **Studio is the compiler.** It validates YAML on open and gives file, line, column and
   an error code:
   `Src\Screen1.pa.yaml(16,9) : error PA2109 : Unknown variant 'verticalGallery'`.
   A failed open is a build error, not a catastrophe. Fix and redeploy.

### Two rules that will otherwise cost you an hour

- **Never guess a control or variant name.** The published schema does not enumerate them
  (`Variant` is only "a non-empty string"). Drop the control in Studio once, save,
  **publish**, then `download` + `unpack` and read what Studio generated.
- **`pac canvas download` reads the PUBLISHED version.** A Studio Save alone is invisible
  to the CLI, and looks exactly like the write having failed.

### Known-good control vocabulary

| Control | Exact YAML |
|---|---|
| Gallery | `Control: Gallery@2.15.0` + `Variant: BrowseLayout_Vertical_TwoTextOneImageVariant_ver5.0` |
| Label | `Control: Label@2.5.1` |
| Checkbox | `Control: Classic/CheckBox@2.1.0` |
| Date picker | `Control: Classic/DatePicker@2.6.0` |
| Icon | `Control: Classic/Icon@2.5.0`, `Icon: =Icon.ChevronRight` |
| Rectangle | `Control: Rectangle@2.3.0` |
| Image | `Control: Image@2.2.3` |

Omitting `@version` is legal and takes the current version. Font is `=Font.'Open Sans'`.

### The risk we are accepting, deliberately

Microsoft documents this as unsupported: the `pa.yaml` docs state the files are read-only,
"not used when an app is loading", that edits "are ignored and might be lost", and that
external editing is supported **only** via Power Platform Git Integration.

It works today. The risk is accepted because the fallback is cheap — the Power Fx is
identical either way, so if the mechanism breaks, the same formulas get pasted into Studio
and only time is lost. **Power Platform Git Integration is the supported alternative** and
is worth evaluating: this repo is already on Azure DevOps and the solution has a Source
control tab.

## Pulling Studio's changes back down

When a control is added in Studio (which is still how new control types get discovered,
and the only way to add connections), sync the source back so YAML stays authoritative:

```bash
pac canvas download --name "D2 Sign-off" \
  --file-name canvas-app/msapp/D2-Sign-off.msapp \
  --environment 2710a01b-6cfa-e820-b338-2286f2649300 --overwrite
pac canvas unpack --msapp canvas-app/msapp/D2-Sign-off.msapp \
  --sources canvas-app/src --layout SourceCode
git add canvas-app && git commit -m "canvas: <what changed in Studio>"
```

**Publish in Studio first** or you will download the previous version. Do **not** combine
`--file-name` with `--extract-to-directory`; the command silently prints usage instead of
running. Run `download` then `unpack` as two separate steps.

This overwrites `src/`, including the `.msapr`, which is correct — Studio's copy is the one
with the current connections.

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
