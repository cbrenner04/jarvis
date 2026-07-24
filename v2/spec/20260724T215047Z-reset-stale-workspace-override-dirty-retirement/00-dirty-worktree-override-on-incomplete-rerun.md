# Dirty-worktree override on incomplete re-run stale reset

## Problem

Incomplete git-enabled `jarvis run workflow implement` or `plan` re-runs refuse
implicit `resetStaleWorkspace` when the managed worktree is dirty. Operators who
deliberately want retirement despite local edits need that choice on the re-run
command without reverting the default refusal or using a separate `jarvis cleanup
--abandon` session.

## Prerequisites

Incomplete git-enabled workflow re-run refuses `resetStaleWorkspace` when the
managed worktree has uncommitted tracked or untracked changes, without tearing
down artifacts.

## Decisions

- Expose one explicit operator-facing switch on the implement and plan workflow
  CLI re-run path; thread it through `maybeResetStaleWorkspace` into
  `resetStaleWorkspace` to skip refusal **only** when porcelain listing reports
  `dirty`. Listing failure (`error`) stays fail-closed with no retirement — same
  as the dirty-refusal slice; rules out wiring override as blanket
  `enforceDirtyWorktreeGate: false`, which would also clear listing-error refusal.
- When the switch is omitted, behavior matches the dirty refusal slice exactly.
  Rules out weakening the gate for all re-runs.
- Pin the flag name and workflow help text in this implementation slice (plan-review
  deferral only; implementers wire a concrete token, not a placeholder).
- Extend dirty refusal `reason` / recovery copy (surfaced as
  `Cannot re-run incomplete spec: …`) to name commit, discard, the wired override
  switch, and `jarvis cleanup --abandon <branch>`. Rules out omitting the
  deliberate-continue option from operator stderr.
- `jarvis cleanup --abandon` keeps no dirty gate on that entry. Rules out
  coupling abandon to the re-run override in this slice.
- One implement workflow regression proves operator wiring end-to-end; plan shares
  the seam via `maybeResetStaleWorkspace` without a second workflow AC. Rules
  out duplicate implement/plan workflow ACs for the same flag.

## Task checklist

- [x] Add the override switch to implement and plan `run workflow` flag parsing
  and usage strings; pass a seam option that skips dirty refusal only (not
  listing-error refusal) into `maybeResetStaleWorkspace` / `resetStaleWorkspace`.
- [x] Update `staleResetDirtyRecovery` (or equivalent) so dirty refusal reasons
  include the wired flag token.
- [x] Add `workflow.test.ts` `run workflow implement resets stale dirty worktree when override switch is set` (teardown baseline: `cleanup.test.ts` describe `resetStaleWorkspace: incomplete implement re-run reset`, test `reset removes stale worktree and draft PR before re-run`).
- [x] Add seam test: override enabled + listing `error` still refuses with no retirement (extend `reset refuses fail-closed when dirty listing fails` or equivalent).
- [x] Update operator runbook and `v1-behaviors.md` per documentation updates below.

## Acceptance criteria

- [x] `workflow.test.ts` `run workflow implement resets stale dirty worktree when override switch is set` drives incomplete git-enabled implement re-run with a dirty managed worktree and the override switch set, asserting the same teardown outcomes as `cleanup.test.ts` `reset removes stale worktree and draft PR before re-run`; fails against the pre-fix code.
- [x] `workflow.test.ts` `run workflow implement refuses reset when the managed worktree is dirty` (no override): exit non-zero, no retirement side effects; assertions updated for extended recovery copy including the wired override token — refusal semantics unchanged, not zero test edits.
- [x] Guard inversion: dirty incomplete implement re-run without the override switch performs no retirement mutations (worktree, branch, draft PR survive); fails if teardown runs without the switch.
- [x] `cleanup.test.ts` `reset refuses when worktree has uncommitted tracked changes` stays green.
- [x] `cleanup.test.ts` `reset refuses when worktree has untracked paths` stays green.
- [x] With the override switch set, porcelain listing failure still refuses fail-closed with no retirement (test in `cleanup.test.ts` or seam unit coverage); fails if override clears listing-error refusal.
- [x] `workflow.test.ts` dirty refusal stderr `Cannot re-run incomplete spec: …` lists commit, discard, the wired override switch token, and `jarvis cleanup --abandon <branch>`.
- [x] `cleanup.test.ts` dirty refusal tests (tracked and untracked) assert `reason` / recovery copy includes the wired override flag token.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Implement workflow / Recovery pre-mutation refusal
  material: document the override switch on incomplete git-enabled implement and plan
  re-run, when to use it vs cleaning the tree vs `jarvis cleanup --abandon <branch>`.
- `v2/docs/v1-behaviors.md` — incomplete implement/plan re-run stale reset: default
  dirty refusal unchanged; override switch skips dirty refusal only (listing failure
  still refuses); retirement matches pre-refusal-slice behavior when override is set
  on a known-dirty tree.
