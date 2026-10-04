# Failed plan resume disposition reporting

## Primary implementation surface

`v2/src/daemon/pipeline-execution.ts` (failed-plan redraft stale-reset preflight success reporting).

## Problem

Successful failed-plan resume is silent about whether shared stale reset retired and rematerialized the lane from base or reused the existing worktree. Operators preserve work on a tree the daemon is about to delete, or abandon edits they could have kept, because the destructive versus preserving path is invisible.

## Prerequisites

- Subspec 00 — failed plan resume harness preamble (stale-reset retirement paths and harness-draft-dirt classification land first).

## Decision ledger

- Successful failed-plan resume prints exactly one disposition line on stderr naming either `retired-and-rematerialized from base` or `reused existing worktree`; rules out silent success that hides destructive retirement.
- Disposition reflects shared stale-reset outcome (`reset` versus `no-op`) for the reopened plan lane worktree; rules out inferring disposition from dispatch alone.
- Disposition prints only on successful failed-plan redraft admission that passes stale-reset preflight and reaches dispatch; rules out disposition lines on refusals or non-plan resume paths.
- Deferred to first consumer: CLI forwarding of disposition to stdout — pin when a caller needs it.

## Tasks

- Capture shared stale-reset `reset` versus `no-op` outcome during failed-plan resume preflight and emit one stderr disposition line before writer dispatch.
- Add regression coverage for both retired-and-rematerialized and reused-worktree success shapes.
- Delete manual failed-plan resume preamble steps from `operator-runbook.md` § Pipeline resume; document resume-owned preamble and which cases retire versus reuse the lane.
- Record preamble ownership and disposition reporting in `v1-behaviors.md`.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` proves successful failed-plan resume reports retired-and-rematerialized versus reused worktree disposition on stdout or stderr; it fails against a success path that omits disposition (reachable on main: `whole-pipeline failed plan resume retires dirty draft and rematerializes from base before writer dispatch` succeeds with no disposition text today).
- [x] `v2/docs/operator-runbook.md` § Pipeline resume deletes the manual preamble (clean branch, merge main, remove staged blockers before resume) and states that resume owns preamble work and which cases retire the lane versus reuse it.
- [x] `v2/docs/pipeline-execution.md` documents worktree disposition reporting on successful failed-plan resume.
- [x] `v2/docs/v1-behaviors.md` records plan-lane resume preamble ownership and disposition reporting.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Pipeline resume: delete manual preamble; resume owns settlement and names retire versus reuse disposition.
- `v2/docs/pipeline-execution.md` — worktree disposition line on successful failed-plan resume.
- `v2/docs/v1-behaviors.md` — plan-lane resume preamble ownership and disposition reporting against the v1 parity baseline.
