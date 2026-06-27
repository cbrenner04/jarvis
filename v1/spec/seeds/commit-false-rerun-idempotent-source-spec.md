---
name: commit-false-rerun-idempotent-source-spec
---

# commit:false re-runs are idempotent (don't mutate the external source spec)

## Problem

In `commit:false` mode the spec lives outside the repo
(`~/.jarvis/specs/<proj>/`). A `run`:

- ticks the acceptance-criteria checkboxes in the **source** spec, and
- may append a `## Blocker` section to the spec/intent.

So re-running an item is **not idempotent** — it needs manual cleanup first:
un-tick AC (`- [x]` → `- [ ]`), strip the appended blocker (carefully: a blocker
placed *before* the AC can clobber the AC if stripped naively), and remove the
worktree + branch + close any stale draft PR.

The in-repo no-commit auto-reset (Jarvis reverts stale ticks/blockers before the
next invocation) does **not** cover the external `commit:false` source spec.
Intake #520; related to the `commit:false` boundary issue #416.

## Direction

Extend the no-commit auto-reset to the external `commit:false` source spec, or
track run state separately so the source spec is never mutated in place. At
minimum, on re-run restore the source spec to its pre-run state (un-tick AC
ticked by the prior incomplete run, drop the appended blocker — preserving
pre-attempt checkboxes) and clean the worktree/branch/draft PR, mirroring the
in-repo behavior.

## Documentation updates

- Operator runbook "No-commit re-run auto-reset" — extend to state external
  `commit:false` specs are covered.
- `v1/docs/config.md` `commit:false` notes — re-runs are self-cleaning.
