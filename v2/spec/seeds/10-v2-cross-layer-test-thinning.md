---
name: v2-cross-layer-test-thinning
---

# Cross-layer test thinning and table-driving

Behaviors are re-proven at 3–4 layers (run wait, list composition, operator-error mapping, quota fallback each tested through execution → daemon → tui → cli). Rule: prove each behavior thoroughly at its cheapest owning layer (pure fn > handler > client > cli); upper layers keep one happy-path wiring test + one error-passthrough test per command. Then table-drive near-identical remainders.

## Decisions

- `cli.test.ts`: drop re-proofs of wait semantics, list-row composition, and operator-error columns (owned by handler/pure layers); table-drive the exit-code mapping singles (the existing `run wait maps %p to exit %i` test.each shows the pattern); drop the randomUUID-uniqueness test and the simulated-bindings describe (asserts a test fixture's own mock behavior).
- `workflow-runner.test.ts`: the multi-step mega-test subsumes "runs two-step workflow to completion" and most of "runs single step" — drop the subsumed; quota-fallback rung ordering is owned by the resolver + step-runner tests — drop the workflow-level re-proof; role-validation trio (three assertions on one aggregated error) → one table; extract the ~25 repeated `openStateStore(":memory:")` try/finally blocks into a fixture.
- `write-loop.test.ts`: merge the with/without-sink crash-resume test pairs; three abort tests → one (the last supersets the first); drop the byte-for-byte "omitting the log sink leaves loop behavior unchanged" duplicate.
- `daemon-start-list.test.ts`: extract the pure list-snapshot mapping (run/step status → terminalOutcome) into unit tests over the mapping function + one composed list test; drop "kill aborts the abort signal that bindings can observe" (strict subset of "kill aborts an active run and records killed status"); operator-error columns: one wiring check per surface — the mapping matrix stays owned by `run-operator-error.test.ts`, which is untouched.
- Table-drive: tui error-frame → `TuiDaemonRpcError` cases (one method × code table); `external-worktree.test.ts` repeated 7-line input object → a `makeInput()` helper; write-loop terminal-mapping quartet.
- Config-validation thinning (agent-model-config / machine-config-loader / cli config block) is **not here** — it rides seed 06's loader rewrite.

## Out of scope

- Src changes, except exporting the list-snapshot mapping if it isn't directly reachable.
- Dropping any behavior's coverage at its owning layer.

## Verification

Test-count diff vs baseline in the PR body; every dropped test named with its surviving owner. Target ~700–900 test LOC removed.

## Ordering

10 — after 07 (daemon `start` params settle before the daemon-start-list rework); may run before 07 if 07 is not imminent — only the daemon-start-list portion is 07-sensitive.
