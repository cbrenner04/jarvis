---
name: intent-workflow-stale-reset-cli
---

# Intent workflow stale reset on CLI re-run

## Problem

A killed or failed `jarvis run workflow intent` leaves a persistent branch, worktree, and
ownership-stamped `.jarvis-intent-review-verdict.md`. `STALE_RESET_WORKFLOWS` excludes
`intent`, so the next CLI re-run reuses that tree; review then refuses non-retryably with
`boundaryViolation: verdict file .jarvis-intent-review-verdict.md is owned by a different
invocation`. Recovery today is manual `jarvis cleanup --abandon`.

## Decisions

- Add `"intent"` to `STALE_RESET_WORKFLOWS` — rules out reclaiming dead verdict ownership in
  `review-intent-enforcement` as the primary fix.
- Intent incomplete re-run uses the same `maybeResetStaleWorkspace` preflight as implement/plan
  (claim, live-held, PR, descendant, landed-criteria, dirty gates; `--reset-despite-dirty` and
  `--reset-despite-landed-criteria` when present) — rules out a narrower intent-only retirement
  that skips existing gates.
- Verdict-reclaim fallback in `review-intent-enforcement` is out of scope — rules out dual-path
  recovery in this slice.
- Export or relocate `maybeResetStaleWorkspace` for non-CLI callers — rules out daemon inlining
  `STALE_RESET_WORKFLOWS` membership and gate wiring.

## Acceptance criteria

- [ ] `STALE_RESET_WORKFLOWS` includes `"intent"`; `workflow.test.ts` asserts membership and
      fails against the current two-element set.
- [ ] `workflow.test.ts` — `"run workflow intent resets a stale worktree before daemon start"`
      seeds a managed worktree with stale `.jarvis-intent-review-verdict.md`, drives an incomplete
      git-enabled re-run, asserts retirement before daemon `start` (worktree removed and recreated,
      verdict gone), and fails against pre-fix code.
- [ ] `maybeResetStaleWorkspace` is importable outside `v2/src/commands/workflow.ts` (export or
      relocation); a daemon-surface regression import fails against pre-fix module-private code.
- [ ] Mutation checkpoint: `workflow.test.ts` carries
      `// @mutate v2/src/commands/workflow.ts 'const STALE_RESET_WORKFLOWS = new Set(["implement", "plan", "intent"]);' -> 'const STALE_RESET_WORKFLOWS = new Set(["implement", "plan"]);'`;
      applying it turns the membership regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Workflow presets — incomplete re-run stale-workspace preflight
  prose (~324: add `intent` beside `plan`).
- `v2/docs/v1-behaviors.md` — record intent in the stale-reset workflow set.

## Prerequisites
