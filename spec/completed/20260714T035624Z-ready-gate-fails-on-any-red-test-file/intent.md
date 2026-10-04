---
name: ready-gate-fails-on-any-red-test-file
---

# `bun run ready` exits non-zero when any test file in its resolved suite is red

`bun run ready` reported green twice on trees CI then rejected (#1422): a red
`v1/test/ready-script.sandbox-unrunnable.test.ts`, and earlier a red slice-boundary
roster test. The gate is meant to make CI a formality; today a green gate proves nothing.

## Behavior

A red test file anywhere in the suite the gate resolves makes `bun run ready` exit
non-zero. No step's failure is swallowed.

The serial retry may stay (it exists for genuine parallel-load flakes), but a retry
must re-run the exact failed aggregation (e.g. `bun run test`), not a narrower bare
`bun test` invocation — a retry that checks less than the original step must never be
able to turn a real failure green. Retry recovery is legitimate only when the retried
step is byte-for-byte the one that failed.

## Root-cause first

Reproduce before fixing: PR #1422 ("Nonblocking ready gate and daemon blocking-call
guard") added a sync-guard suffix to the `check` script, then needed a same-PR fixup
("fix: allow the sync-guard suffix in the check-script assertion") because
`v1/test/ready-script.sandbox-unrunnable.test.ts`'s assertion on the `check` script
didn't yet account for the new suffix. On the tree at that fixup's parent commit
(assertion not yet updated for the suffix), `bun run ready` sandbox-off exits 0 while
`bun test v1/test/ready-script.sandbox-unrunnable.test.ts` exits non-zero. If that
exact parent commit isn't independently reachable (PR #1422 landed squash-merged),
reproduce the same shape directly: add a suffix to the `check` script that the test's
assertion doesn't expect, and confirm `bun run ready` still exits 0 while the direct
`bun test` run on that file exits non-zero.

Candidates, in order:

- `scripts/ready.ts` serial retry — on a genuine test-step failure it re-runs bare
  `bun test`, not the failed `bun run test` aggregation, and a green retry is reported
  as a "parallel-load flake recovered" and continues.
- `JARVIS_READY_TEST_SCOPE` substituting scoped scripts for `bun run test` and dropping
  the integration slice (note the empty scope `[]` resolves to zero test steps).
- `runBunTest`'s exit code in `scripts/run-tests.ts` not reflecting a bun test failure.
- The test's `readFileSync("./package.json")` resolving to a different CWD under the gate.

Fix the gate, not the tests — the tests were right both times. Do not narrow the fix to
`sandbox-unrunnable` files unless the root cause says that is the boundary; the
slice-boundary failure was an ordinary test file.

## Regression coverage

A deliberately failing integration test file makes `bun run ready` exit non-zero.

## Out of scope

- The assertions that were red (both already fixed on `main`).
- `scripts/ci-test-scope.ts`, unless it turns out to be the cause.
- The patch-run completion gate — it inherits this fix; no separate change here.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate — what a green `ready` does and does not prove.

## Prerequisites
