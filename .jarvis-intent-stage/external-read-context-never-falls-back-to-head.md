---
name: external-read-context-never-falls-back-to-head
---

# The external read-context archive never silently falls back to local `HEAD` for an explicit base

On the `specs: external` read-context path, `resolveLocalArchiveRef` currently degrades any non-local base to local `HEAD` before `git archive`. That is harmless while the base is always the default branch, but the moment an operator names an explicit `--base` it becomes a footgun: a mistyped or un-fetched base would silently archive the wrong tree and draft against code the operator never selected.

An explicit operator-named base that is not a local tree-ish must fail rather than fall back: extraction reports the unresolvable ref and no read-context checkout is materialized against local `HEAD`. The no-`--base` default resolution — where the default-branch name may legitimately be absent as a local ref — keeps its existing tolerant behavior.

## Prerequisites

- plan accepts --base <ref> and threads the resolved base into the plan workflow input
- the resolved base drives the specs:external read-context archive via materializeReadCheckout

## Documentation updates

- `v2/docs/workflow-runner.md` — plan preset contract: the explicit-base no-`HEAD`-fallback rule for the read-context archive.
