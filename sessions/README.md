# sessions/

Per-session handoff logs. One file per work session, named
`YYYY-MM-DD-topic.md`. Keep them short — 5–10 lines is the goal, not the
ceiling. The point is orientation, not archival.

`latest.md` is a copy of the most recent file. Update it at close.

## Template

```markdown
# YYYY-MM-DD — Short topic

**Session goal:** one line.

**Decisions made:**
- ...

**Files touched:**
- `path/to/file` — what changed and why

**Open questions / blocked on:**
- ...

**Next action:**
One-line handoff for the next session.
```

## When to close and start fresh

- Phase change: design → build, build → deploy, investigation → fix
- Context is ~50%+ full and next work is well-scoped
- About to start a long grind (bulk edits, script development)
- A deliverable just landed and next work is separable

## When NOT to split

- Mid-debug when live tab/script state matters
- Next task materially depends on nuance not yet in the repo
