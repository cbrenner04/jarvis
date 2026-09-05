---
name: stale-reset-disposable-lane-retirement-gates
---

# Stale reset gates disposable-lane retirement and unlanded work

## Prerequisites

## Problem

Shared `resetStaleWorkspace` still refuses retirement on descendant drift and landed-criteria drift before pipeline restart can rematerialize a never-landed lane, and it retires branches with commits not on base and no PR without naming salvage risk — the shape that will block `cleanup --abandon` in [[abandon-refuses-unlanded-work-with-no-pr]].

## Decision ledger

- Retirement refuses when the branch has commits not reachable from the resolved base and no associated PR, naming tip SHA, commit count, and a hand-finish salvage path; rules out silently destroying unpushed implementation work during disposable rematerialization.
- Callers may mark a lane disposable (never landed: no PR, no unpushed commits whose changed paths leave harness workflow staging — `.jarvis-plan-stage/`, `.jarvis-intent-stage/`, and ignored `.jarvis-*` sidecars); disposable retirement bypasses descendant and landed-criteria refusals and proceeds to rematerialize from the current base; rules out requiring per-gate `--reset-despite-*` overrides for dead lanes.
- Live worktree claim, dirty reuse outside harness draft dirt, and ready (non-draft) PR ownership refusals stay unconditional; rules out disposable bypass eating operator edits or published work.
- `jarvis cleanup` merged-worktree retirement and standalone `run workflow` incomplete re-run defaults stay unchanged; rules out widening disposable bypass beyond caller-marked pipeline restart retirement.
- Deferred to first consumer: `--discard-unlanded` override wiring at stale-reset — pin when [[abandon-refuses-unlanded-work-with-no-pr]] lands.

## Acceptance criteria

- [ ] `cleanup.test.ts` test `resetStaleWorkspace refuses unlanded commits with no PR before retirement` builds a worktree whose branch is ahead of base with no PR, asserts retirement refuses without removing the worktree or deleting branches, and names tip SHA, commit count, and salvage recovery; it fails against the pre-fix path that retires it.
- [ ] `cleanup.test.ts` test `resetStaleWorkspace rematerializes a disposable never-landed lane past descendant drift` builds a worktree whose HEAD is not descended from base with zero commits ahead of base, passes the disposable-lane marker, and asserts `status: "reset"` with rematerialized HEAD matching the current base; it fails against the pre-fix descendant refusal.
- [ ] `cleanup.test.ts` test `resetStaleWorkspace rematerializes a disposable never-landed lane past landed-criteria drift` builds a worktree whose spec tree has acceptance criteria ticked absent from base with zero commits ahead of base, passes the disposable-lane marker, and asserts `status: "reset"` with rematerialized HEAD matching the current base; it fails against the pre-fix landed-criteria refusal.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — cross-link disposable-lane stale-reset gate sequence used by pipeline restart (full operator contract lands in the dependent restart intent).
