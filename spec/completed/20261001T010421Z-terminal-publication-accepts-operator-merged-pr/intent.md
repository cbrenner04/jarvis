---
name: terminal-publication-accepts-operator-merged-pr
---

# Terminal publication accepts an operator-merged PR

Unsplit rationale: PR-state probe, short-circuit success, `pr_closed` failure, merge skip, and merged publication evidence all live in the terminal publication execution boundary; settlement already commits success or failure from `executeTerminalPublication` without a separate persistence or projection seam.

## Problem

Terminal publication runs the ready gate and `gh pr ready` without reading PR state; an operator-merged implement PR makes `gh pr ready` fail and the pipeline settles publication-failed although the work landed.

## Decisions

- Before the ready gate, probe by number (`gh pr view <n> --json state,mergedAt`). `MERGED` succeeds without ready gate, flip, or `merge`; return threaded `prNumber`/`prUrl` so settlement uses the existing `commitTerminalPublicationSuccess` path (`terminalPublicationSucceededAt`, no `terminalPublicationFailure`); no new pipeline-context or notification marker.
- `CLOSED` (unmerged) fails with `PublicationFailure.cause: "pr_closed"` (new optional field on `PublicationFailure`), `operation: "gh pr view"`, and a stable message naming closed-not-merged; no `gh pr ready` and no reopen.
- Probe failure is inconclusive; fall through to today's ready/flip/merge path unchanged.
- `leave-draft` unchanged.

## Acceptance criteria

- [ ] `terminal-publication.test.ts` with fake `gh`: `MERGED` → success with threaded `prNumber`/`prUrl`, no ready gate or `gh pr ready`; fails against pre-fix code.
- [ ] Same harness: `CLOSED` → `TerminalPublicationError` with `failure.cause === "pr_closed"`, no `gh pr ready`; fails against pre-fix code.
- [ ] Same harness: state probe throws → ready gate and flip run as before.
- [ ] Terminal action `merge` with `MERGED` PR does not call `gh pr merge`; fails against pre-fix code.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — operator-merged PR is terminal publication success (`terminalPublicationSucceededAt`); closed unmerged PR is `terminalPublicationFailure` with `cause: "pr_closed"`.
- `v2/docs/operator-runbook.md` — hand-merging the implement PR before terminal publication is safe.
- `v2/docs/write-behavior.md` — pipeline terminal publication probes PR state before ready gate; merged short-circuit (detail in `pipeline-execution.md`).
- `v2/docs/v1-behaviors.md` — terminal publication no longer fails ready flip when the implement PR is already merged; closed unmerged PR fails with `pr_closed`.

## Primary implementation surface

`v2/src/execution/terminal-publication.ts`

## Prerequisites
