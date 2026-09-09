---
name: prove-mutation-verifier-reaps-bounded-tests
---

# Prove mutation verification reaps bounded killing tests

## Prerequisites

- Every process-group timeout or abort awaits SIGTERM→SIGKILL escalation and confirms the group is gone before `runAsync` settles.

## Module-boundary surface

- Diff-derived mutation verification: real scoped killing-test execution and its while-true guard regression in `v2/src/execution/diff-derived-mutation-verifier.test.ts`.

## Problem

The real while-true mutation regression proves only elapsed time and verifier classification, so it passes while the bounded `bun test` process survives as an orphan and burns a CPU core.

## Behavior

- Returning `non-terminating-mutation` from the real scoped-test path also proves the timed-out killing-test process group is gone.
- The regression retains its elapsed-time, result-kind, source-site, restoration, and clean-worktree assertions.
- Operator guidance distinguishes a verifier call that returned from a killing-test process that survived, using CPU and parentage for attribution.

## Decision ledger

- Assert child-group disappearance in the real while-true verifier fixture instead of relying only on shared subprocess tests; rules out future verifier wiring bypassing the shared termination guarantee unnoticed.
- Exercise the real `bun test` spawn instead of an injected runner; rules out a test double that cannot reproduce the orphan.
- Keep process-liveness verification at the bounded-spawn regression instead of adding production test-only exports or parameters; rules out contaminating the runtime API for observability.
- Preserve the existing verifier classification and restoration assertions instead of replacing them with cleanup-only coverage; rules out fixing the leak while regressing non-terminating-mutant settlement.

## Acceptance criteria

- [ ] `v2/src/execution/diff-derived-mutation-verifier.test.ts`'s real while-true guard regression proves the spawned killing-test process group is absent when `verifyDiffDerivedMutations` returns.
- [ ] The same regression retains its elapsed-time, `non-terminating-mutation`, source-site, restored-bytes, and clean-worktree assertions.
- [ ] No production `*ForTest`/`*ForTests` member, parameter, module variable, exported function, or exported variable, and no `invert*` parameter, is added for process observation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — state that bounded verifier killing-test calls settle only after their process groups are confirmed gone.
- `v2/docs/operator-runbook.md` — retain the historical leaked-`bun test` diagnostic, identify the fixed regression gap, and preserve CPU-and-parentage attribution guidance.
