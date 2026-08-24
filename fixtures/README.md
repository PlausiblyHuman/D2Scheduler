# fixtures/

Regression corpus for this project. Every known good and bad input goes here
with its expected outcome, so refactors run against real cases instead of
"looks right" reviews.

## Layout convention

```
fixtures/
├── inputs/          # raw inputs — PDFs, JSON, dictations, etc.
├── expected/        # expected outputs, one per input file with matching name
└── manifest.json    # optional: list of cases with tags (bug-XYZ, edge-case, happy-path)
```

## Adding a case

1. Drop the input in `inputs/` with a descriptive filename.
2. Add the expected output in `expected/` with the same base name.
3. If the case fixes a specific bug, note the bug ID or session log reference.

## Running the harness

Project-specific. Document the command in CLAUDE.md → "How to run it" and
in the top-level README.

## Rule

Never delete a fixture that's caught a real regression. If a fixture becomes
obsolete because the behavior it tested was intentionally changed, move it
to `fixtures/archive/` with a note explaining why.
