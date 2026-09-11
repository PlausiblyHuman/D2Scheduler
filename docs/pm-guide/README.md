# PM guide — source

The client-facing project-manager guide, published as an artifact at
`https://claude.ai/code/artifact/a84a2e1a-6395-4f3a-b050-8cf53cefa2b5`.

**These sources live here because they used to live nowhere.** The guide was
built in a session scratchpad, which is temporary. Everything needed to rebuild
and republish it is now in the repo.

**Republished as a NEW artifact on 2026-09-11**, so the page carries no version
history. The previous artifact (`1cc7b6be-...`) is superseded and must not be
republished to; anyone holding that older link still sees the older guide, so
reshare this URL.

## Rebuild

```
python docs/pm-guide/build_guide.py
```

Reads `guide.tpl.html`, inlines the seven screenshots as base64 data URIs and
the daily-summary email as the `#mailpreview` iframe source, and writes
`d2-guide.html` (~1.3 MB) beside itself. It asserts on any unreplaced
`{{PLACEHOLDER}}`, so a renamed image fails the build rather than shipping a
broken page.

Then publish that file to the **existing** artifact URL above. Publishing
without the URL creates a second artifact instead of updating the one people
have been sent.

## The pieces

| File | What it is |
|---|---|
| `guide.tpl.html` | The guide. Placeholders `{{IMG_*}}` and the `<!--EMAIL_BODY-->` marker. |
| `build_guide.py` | Inlines the assets. |
| `shot-*.jpeg` | Screenshots, 2026-09-10, taken against the live tenant. |
| `daily-summary-live.html` | A real sent body, pulled from a `D2 - Daily Summary` run. |

## Screenshots

Retaken 2026-09-10 after the site chrome changed. **The previous set was taken
before the header-tabs rebuild and showed the old stock left rail while the
guide text described the new layout** — so they contradicted the page they
documented. If the site chrome changes again, retake them.

Two deliberate choices when shooting:

- **The group-membership count is hidden** (`.ms-membersInfo-infoArea`,
  `[class*="facepileCell"]`). It read "1 member" on the night the shots were
  taken and becomes wrong the moment D2 staff are added. It is site chrome, not
  part of any instruction in the guide.
- **The commit shot shows the Status dropdown open** on a pool, rather than a
  saved change. It shows the exact action the guide describes with no data
  written. Nothing was saved; the row's Modified timestamp was checked
  afterwards to confirm.

SharePoint caches navigation per page, so **hard-reload each page before
shooting** or the old left rail renders. See `sharepoint/build-navigation.js`.

## The email sample

Pulled from a real run rather than mocked, via the `Send_summary` action's
`inputsLink`. To refresh it: run `D2 - Daily Summary`, then read that action's
inputs and save `emailMessage/Body`. Verify the palette afterwards — the
summaries were repainted into the D2 navy/green/cream on 2026-09-10, and the
colours live in **two** actions (`Compose_body` and the per-row `Append_row`),
so a repaint that misses one leaves the table links the old colour while the
flow definition reads clean.
