---
name: plan-intent-completion-ready-gate-runs-full-suite-on-spec-only-diff
---

# Plan/intent completion ready-gate runs the full suite on spec-only diffs and strands on flaky failures

## Problem

A `plan` (or `intent`) run's diff is Markdown-only under `v2/spec/**`. That surface is not `v1/**`/`v2/**`/`shared/**`, so `scripts/ci-test-scope.ts` classifies it as "surface undetermined → full `bun run test`". The completion ready-gate therefore runs the **entire** test suite for a spec-only change. Under concurrent operator load the heavy/flaky tests (`v1/test/snapshot-update-retest-runner.test.ts`, `runtime-smoke-verifier` real-CLI probe, `daemon-resume`, `completion-commit`) fail, the gate-repair stage tries to autofix them by editing source files outside the run's spec-only diff, the attributable write-fence (correctly) refuses, and completion settles `completion_commit_failed` — stranding a fully-drafted, correct spec with no PR flip.

## Evidence

- 2026-08-07 slice-drain session: the `plan-review-premise-falsification` plan drafted a complete, correct spec + verdict, but its review-landing successor settled `completion_commit_failed`: "Ready-gate repair stages path outside run diff and spec tree: v2/src/daemon/daemon-resume.test.ts, v2/src/execution/completion-commit.test.ts, v2/src/execution/mutation-checkpoint-verifier.ts". Hand-published the clean draft. Same session, three sibling plans run 3-at-a-time completed cleanly — the strand correlates with concurrent full-suite ready-gate load, not the spec content.

## Decisions

- A spec-only diff (only `v2/spec/**` / `v1/spec/**` Markdown changed) should scope the completion ready-gate to Markdown lint (+ typecheck), not the full test suite — rules out running (and flakily failing) the entire suite for a change that touches no runtime code.
- Alternatively/additionally, ready-gate **repair** must never stage paths outside the run's own diff surface for a spec-only run — a spec run producing source-file repair edits is always wrong; classify the failure in-scope-impossible and publish the clean draft rather than settling `completion_commit_failed`.
- Preserve the attributable write-fence (it did its job) — the fix is upstream scope classification / repair suppression, not weakening the fence.

## Acceptance criteria

- [ ] `scripts/ci-test-scope.ts` (or the ready-gate scope caller) classifies a spec-only-Markdown diff as a Markdown-lint(+typecheck) scope, not full `bun run test`; a test drives a `v2/spec/**`-only changed-set and asserts the scoped command set excludes the full suite.
- [ ] A plan/intent completion whose ready-gate repair would stage a path outside the run's diff surface publishes the clean draft (or settles a distinct, non-stranding outcome) instead of `completion_commit_failed`; a regression covers the spec-only-diff-with-flaky-source-failure path.
- [ ] Mutation checkpoint: in the pinning test named above, a `// @mutate` directive inverting the spec-only-scope classification turns that regression RED.
- [ ] `bun run typecheck` and the touched surface's test script pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust / Recovery — spec-only plan/intent runs no longer run the full suite at completion; if one strands on flaky source tests, hand-publish the clean draft.
