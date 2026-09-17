---
name: base-ref-probe-exonerates-only-on-conclusive-base-failure
---

# Base-ref probe exonerates only on a conclusive failure at base

Run `75ca2a7a` settled `ready_gate_out_of_scope` for `v2/src/daemon/daemon-run-failure-capture.test.ts`, but on an idle machine that file passes on `main` (12/0) and fails on the branch (11/1). The lane caused the failure, and the settlement exonerated it with `nextAction: "stop"`.

Recurred twice on 2026-09-17, both regressions the lane itself introduced: run `823a8185` (owner-stamp persistence) blamed main for `v2/src/persistence/state-store-baseline-migration.test.ts` (main 4/4, branch 2/4 deterministic); run `29b222de` (resume orchestration) blamed main for `v2/src/daemon/daemon-workflow-start.test.ts` (main 41/41, branch 39/41 deterministic). Both ran with three implement lanes live.

## Decisions

- Before changing classification, confirm why `createDefaultReproduceReadyGateAtBaseRef` (`v2/src/execution/ready-finalize.ts`) reported `fail` for `v2/src/daemon/daemon-run-failure-capture.test.ts`, which passes at base (run `75ca2a7a`). Check whether the probe tree is really at `baseRef`, which cwd and env the v2-mode spawn uses, and whether any non-zero exit counts as reproduction.
- `probeOutsidePathsAtBaseRef` puts a path in `confirmedOutsidePaths` only when the probe shows the path fails at a tree verified to be the base commit. An inconclusive probe keeps the path in scope, so the run settles the ordinary repairable red gate. This covers errors, timeouts, an unverified tree, or a failure that is not a test failure.
- Scope is limited to the base-ref probe and the classification it feeds. Do not change what the ready gate runs.

## Acceptance criteria

- [ ] A test reproduces the run `75ca2a7a` case — a path that passes at `baseRef` and fails on the branch, matching `v2/src/daemon/daemon-run-failure-capture.test.ts`'s pass/fail split — and proves the run does not settle `ready_gate_out_of_scope`. This test fails against the current probe.
- [ ] A test proves a path that fails on both base and branch still settles `ready_gate_out_of_scope`.
- [ ] A test proves an inconclusive base-ref probe settles a repairable red gate, not the non-resumable out-of-scope verdict.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: which tree and command the base-ref probe runs, and what counts as a conclusive reproduction.
- `v2/docs/operator-runbook.md`, Gate trust section: `ready_gate_out_of_scope` has been observed wrong in both directions. Check the named paths on base and on the branch before believing or dismissing it.

## Prerequisites
