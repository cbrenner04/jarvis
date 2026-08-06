# Intent stale-reset CLI preflight

## Problem

A killed or failed `jarvis run workflow intent` leaves a persistent branch, worktree, and ownership-stamped `.jarvis-intent-review-verdict.md` plus `.owner` sidecar. `STALE_RESET_WORKFLOWS` excludes `intent`, so the next CLI re-run reuses that tree; review then refuses non-retryably with `boundaryViolation: verdict file .jarvis-intent-review-verdict.md is owned by a different
invocation`. Recovery today is manual `jarvis cleanup --abandon`.

## Decisions

- Add `"intent"` to `STALE_RESET_WORKFLOWS` — rules out reclaiming dead verdict ownership in
  `review-intent-enforcement` as the primary fix. Applies to `intent-reviewed` (same canonical
  preset). No-op when the resolved write step has `worktree.git === false`.
- Intent incomplete re-run uses the same `maybeResetStaleWorkspace` preflight as implement/plan
  (claim, live-held, PR, descendant gates) — rules out a narrower intent-only retirement that skips
  existing gates.
- **Dirty gate (poisoned verdict sidecars):** exclude untracked `.jarvis-*` paths from the shared
  stale-reset dirty gate (`listDirtyWorktreePathsForStaleReset` / refusal reason) so harness verdict
  sidecars alone do not block retirement — rules out wiring `--reset-despite-dirty` on intent CLI in
  this slice and rules out leaving the typical poisoned case blocked by dirty refusal.
- **Landed-criteria gate (intent `specPath`):** skip/N/A when `specPath` is not a readable spec file
  or `index.md` tree (production intent directory paths such as `ready-intents`) — rules out
  `specTreeRelPaths` throws surfacing as `Stale workspace reset failed` on intent re-run.
- Intent CLI does not gain `--reset-despite-dirty` or `--reset-despite-landed-criteria` in this
  slice; implement/plan override flags remain unchanged.
- Verdict-reclaim fallback in `review-intent-enforcement` is out of scope — rules out dual-path
  recovery in this slice.
- Relocate `maybeResetStaleWorkspace` and `STALE_RESET_WORKFLOWS` to
  `v2/src/commands/stale-reset-workspace.ts` — rules out daemon inlining membership and gate wiring,
  and rules out exporting only `maybeResetStaleWorkspace` without the membership set.

## Tasks

- [ ] Add `"intent"` to `STALE_RESET_WORKFLOWS`; update the stale-comment on that constant.
- [ ] Relocate `maybeResetStaleWorkspace` and `STALE_RESET_WORKFLOWS` to
      `v2/src/commands/stale-reset-workspace.ts`; re-export from `workflow.ts` if needed.
- [ ] Exclude `.jarvis-*` porcelain paths from the shared stale-reset dirty gate.
- [ ] Skip landed-criteria gate when `specPath` is not a spec file or `index.md` tree.
- [ ] Add `workflow.test.ts` membership assertion on exported `STALE_RESET_WORKFLOWS` (fails against
      the current two-element set).
- [ ] Add `workflow.test.ts` `"run workflow intent resets a stale worktree before daemon start"` in
      the `implement preflight stale workspace reset` describe: mocked intent write steps (same pin
      pattern as implement/plan — not production `buildIntentWorkflowSteps`), materialize a managed
      git-enabled worktree, seed `.jarvis-intent-review-verdict.md` and `.jarvis-intent-review-verdict.md.owner`
      with a foreign `invocationId`, drive incomplete re-run, assert worktree retired and sidecars
      gone before daemon `start` via IPC `sent` ordering, then `start` proceeds.
- [ ] Add `v2/src/commands/stale-reset-workspace.test.ts` compile/import regression importing
      `maybeResetStaleWorkspace` and `STALE_RESET_WORKFLOWS` from the relocated module (fails
      against pre-fix module-private code).
- [ ] Add mutation checkpoint directive on the membership guard in `workflow.test.ts`.
- [ ] Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md` per Documentation updates
      below.

## Acceptance criteria

- [x] `STALE_RESET_WORKFLOWS` includes `"intent"`; `workflow.test.ts` asserts exported membership
      and fails against the current two-element set.
- [x] `workflow.test.ts` — `"run workflow intent resets a stale worktree before daemon start"` uses
      mocked intent write steps (implement/plan pin pattern), seeds a managed git-enabled worktree
      with stale `.jarvis-intent-review-verdict.md` and a foreign-`invocationId`
      `.jarvis-intent-review-verdict.md.owner`, drives incomplete re-run, asserts worktree absent
      from `git worktree list` and verdict sidecars gone before daemon `start` (IPC `sent`
      inspection), then `start` proceeds; fails against pre-fix code.
- [x] `stale-reset-workspace.test.ts` imports `maybeResetStaleWorkspace` and `STALE_RESET_WORKFLOWS`
      from `v2/src/commands/stale-reset-workspace.ts`; fails against pre-fix module-private code.
- [x] Mutation checkpoint: the `STALE_RESET_WORKFLOWS membership includes intent` test in
      `workflow.test.ts` carries
      `// @mutate v2/src/commands/stale-reset-workspace.ts "const STALE_RESET_WORKFLOWS = new Set([\"implement\", \"plan\", \"intent\"]);" -> "const STALE_RESET_WORKFLOWS = new Set([\"implement\", \"plan\"]);"`;
      applying it turns **both** the exported-set membership assertion and the intent integration
      test red.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Workflow presets — incomplete re-run stale-workspace preflight
  prose (~324): add `intent` and `intent-reviewed` beside `plan`; note `.jarvis-*` harness sidecars
  do not block stale reset; landed-criteria gate N/A for intent directory `specPath`; git-enabled
  only; when automatic re-run reset is refused (live-held, PR, descendant, operator dirty work),
  `jarvis cleanup --abandon` remains the manual fallback — do not imply re-run alone always clears
  poisoned verdict trees.
- `v2/docs/operator-runbook.md` § Blocked run recovery (~995): include `intent` / `intent-reviewed`
  among workflows that reset stale worktrees on incomplete re-run.
- `v2/docs/v1-behaviors.md` — record intent (and `intent-reviewed`) in the stale-reset workflow set;
  document intent-specific gate semantics (`.jarvis-*` dirty exclusion, landed-criteria N/A for
  directory `specPath`, no intent override flags, git-enabled only).

## Prerequisites

- Landed `resetStaleWorkspace` / claim-before-reset / dispatch-scoped retirement behavior
  (`v2/spec/completed/20260722T134237Z-retire-stale-workspace-only-after-dispatch-is-reachable/`).

## Blocker

Artifact contract check failed: Hollow mutation checkpoints (the named mutation left the scoped suite green):
- no @mutate directive linked to this criterion; add // @mutate <path> "<original>" -> "<replacement>" on the named pin
