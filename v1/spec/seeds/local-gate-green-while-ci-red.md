# The local ready gate reports green on trees CI rejects

`bun run ready` returned green twice on a tree whose failures CI then caught, on
the same PR (#1422). The gate is supposed to be the thing that makes CI a
formality; right now it is not load-bearing.

## Problem

Observed 2026-07-12:

1. **`v1/test/ready-script.sandbox-unrunnable.test.ts` red, gate green.** The
   `check` script gained a suffix; the test asserts `pkg.scripts.check` exactly.
   CI (`Test (full)`) failed on it. `bun run ready` on the identical tree,
   sandbox-off, reported green and proceeded to `lint:md`.
2. **Slice-boundary roster red, gate green.** Same PR, earlier — green locally,
   red in CI.

Inspection does **not** explain it. `bun run test` → `scripts/run-tests.ts`
aggregates `agent` and `integration` files (the latter includes every
`*.sandbox-unrunnable.test.ts`) and exits non-zero on the first failing file:

```ts
for (const file of integration) {
  const code = runBunTest(["test", file]);
  if (code !== 0) process.exit(code);
}
```

So the aggregation looks correct and the failing file *is* in the set. Something
between "file is collected" and "gate exits non-zero" is not holding. Candidates
to rule out, in order:

- The gate's resolved test scope (`JARVIS_READY_TEST_SCOPE`) substituting scoped
  scripts for `bun run test` and dropping the integration slice.
- `runBunTest`'s exit code not reflecting a bun test failure (per-file timeout
  wrapper swallowing it).
- The test's `readFileSync("./package.json")` resolving to a different CWD under
  the gate than under CI.

## Why it matters

This is the mechanism behind [run-cannot-report-complete-over-red-gate](./run-cannot-report-complete-over-red-gate.md),
not a separate bug: if `bun run ready` can exit 0 on a red tree, then a patch
run's completion gate exits 0 too, the run reports `criteria-complete`, and the
PR flips ready over failing tests. Every guarantee downstream — the ready flip,
`triage --merge`'s local gate, `cleanup`'s archival — inherits it.

It also silently taxes the operator: CI becomes the real gate, so every PR pays a
full CI round-trip to learn what the gate should have said in seconds.

## Scope

- Reproduce: check out the pre-fix tree of #1422 (`check` script suffixed,
  assertion not yet updated), run `bun run ready` sandbox-off, and confirm it
  exits 0 while `bun test v1/test/ready-script.sandbox-unrunnable.test.ts` exits
  non-zero. That is the minimal failing case.
- Root-cause which of the candidates above is responsible.
- **A red test file anywhere in the resolved suite must fail `bun run ready`.**
  Regression coverage: a deliberately failing integration file makes the gate
  exit non-zero.

## Decisions

- Fix the gate, not the tests. The tests were right both times; the gate was wrong.
- Do not narrow the fix to `sandbox-unrunnable` files until the root cause says
  that is the boundary — the slice-boundary failure was an ordinary test file.

## Out of scope

- The specific assertions that were red (both fixed on `main`).
- CI test scoping (`scripts/ci-test-scope.ts`), unless it turns out to be the cause.

## Documentation updates

- `v1/docs/operator-runbook.md` § The gate — what a green `ready` does and does not
  prove, once it actually proves it.
