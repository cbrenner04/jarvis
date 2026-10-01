---
name: terminal-publication-accepts-operator-merged-pr
---

# Terminal publication accepts an operator-merged PR

Unsplit rationale: PR-state probe, short-circuit success, `pr_closed` failure, merge skip, and merged publication evidence all live in the terminal publication execution boundary; settlement already commits success or failure from `executeTerminalPublication` without a separate persistence or projection seam.

## Problem

Terminal publication runs the ready gate and `gh pr ready` without reading PR state; an operator-merged implement PR makes `gh pr ready` fail and the pipeline settles publication-failed although the work landed.

## Decisions

- Before the ready gate, probe by number (`gh pr view <n> --json state,mergedAt`). `MERGED` succeeds without ready gate, flip, or `merge`; record terminal publication evidence with merged state so operators see success, not failure.
- `CLOSED` (unmerged) fails with cause `pr_closed`; no `gh pr ready` and no reopen.
- Probe failure is inconclusive; fall through to today's ready/flip/merge path unchanged.
- `leave-draft` unchanged.

## Acceptance criteria

- [ ] `terminal-publication.test.ts` with fake `gh`: `MERGED` → success, no ready gate or `gh pr ready`, evidence records merged; fails against pre-fix code.
- [ ] Same harness: `CLOSED` → `TerminalPublicationError` with cause `pr_closed`, no `gh pr ready`.
- [ ] Same harness: state probe throws → ready gate and flip run as before.
- [ ] Terminal action `merge` with `MERGED` PR does not call `gh pr merge`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — operator-merged PR is terminal publication success; closed PR is `pr_closed`.
- `v2/docs/operator-runbook.md` — hand-merging the implement PR before terminal publication is safe.

## Primary implementation surface

`v2/src/execution/terminal-publication.ts`

## Prerequisites
