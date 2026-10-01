---
name: completion-commit-run-scope
---

# Harness completion commits stay within the run scope

## Problem

`createCompletionCommitter` stages `git add -A` minus harness sidecars, so shrink, write checkpoint/completion, resume recovery, and ready-gate repair re-commits can sweep files the run never touched or resurrect stale `main` blobs.

## Decisions

- Scope lives in `createCompletionCommitter` (shared helper on every commit leg: fresh stage, strict restage, pending-json `pending.tree`); shrink, write checkpoint/completion, resume recovery, and ready-gate repair re-commits all call it. Allowset: `deriveGateAllowedPaths` with repair seam bundle; `admitCoLocatedTestsOfAllowedPaths` when not markdown-only (caller-supplied markdown-only hints or default non-markdown-only); persisted `readyGateRepairFence` allowset via `loadPersistedRepairAllowset` when present (fence wins over fresh derive); when `shouldEnforceReadyGateRepairFence` and no persisted fence, `initializeFrozenRepairAllowset` — not ad hoc worktree drift. Derivation `{ reason }` fails closed like ready-gate repair.
- Out-of-scope staged paths revert to `HEAD`, are named in `commit_scope_violation` when `logSink` and `runId` are provided, and the commit proceeds on the in-scope remainder; an empty remainder is no-progress, not success.
- Stale-main refusal (no history walk): refuse when staged content equals the path blob at lane `baseRef` and differs from the integration main-tip blob for that path; treat like out-of-scope (revert + conditional `commit_scope_violation`).

## Acceptance criteria

- [ ] `completion-commit.test.ts`: a worktree with an in-scope edit plus a file the run never touched commits only the in-scope path, reverts the other, and emits `commit_scope_violation` naming it when log wiring is present; fails against the pre-fix `add -A` staging.
- [ ] `completion-commit.test.ts`: a staged path whose content matches an older `main` blob while current `main` differs is refused even when the path is in the run diff; fails against the pre-fix committer.
- [ ] One fake-git test per harness commit entrypoint proves shrink, resume-recovery, write completion, and ready-gate repair re-commit each invoke the scope check through the production committer factory (`write-loop.test.ts`, `workflow-runner-resume*.test.ts`); fails when post-stage enforcement is removed from the factory.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — commit scope check, conditional `commit_scope_violation`, derivation fail-closed, stale-main refusal; entrypoint pins are regression guards.
- `v2/docs/operator-practices.md` — after land, harness commits enforce run scope automatically; pre-merge lane diff against merge base remains a sanity check, not the primary guard; run-log events require wiring.
- `v2/docs/v1-behaviors.md` — catalog harness commit scope enforcement and stale-main refusal.

## Prerequisites
