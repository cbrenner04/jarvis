---
name: v2-unknown-command-error
---

# An unknown command errors instead of printing `v2 not ready`

Any argv v2 doesn't match falls through to `out.stdout("v2 not ready\n")` and exit 0 — a typo
reports success (`jarvis notacommand` prints `v2 not ready` to stdout and exits 0). Replace the
fallthrough: print an error to **stderr** that names the unrecognized command and lists the
recognized v2 commands (the existing dispatch set — `write`, `daemon`, `config`, `run`, `tui`,
`cleanup`), and exit **non-zero**.

## Prerequisites

- None. The recognized command set is the existing hardcoded dispatch chain in `v2/src/cli.ts`
  (`write`, `daemon`, `config`, `run`, `tui`, `cleanup`); no registry or new infrastructure is
  needed for this intent.

## Out of scope

- A `jarvis help` command and a queryable command registry (`{name, summary, usage}`) — deferred
  to the `v2-command-registry-and-help` seed. This intent lists the recognized commands inline
  from the existing dispatch set, not a registry, and does not point at a (nonexistent) `jarvis help`.
- Fuzzy "did you mean `<x>`?" close-matching — folds in once the registry exists.
