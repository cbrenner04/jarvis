## Verdict

### Required outcome

**Add executable test coverage for the auto-ready behavior.** The four acceptance criteria — successful committed run leaves the PR ready, ready-gate/`gh pr ready` failure still exits 0 with a warning and leaves the PR draft, no-commit runs make no `gh pr ready` call, and the state-guard no-op on an already-ready PR — currently have no test exercising them. The existing committed-path intent test routes through the "ready" branch of the PR-state check (the fake `gh` shim returns a value that parses to a non-draft state), so the draft→ready transition this spec adds is never asserted.

This is the only gap requiring action. It matters because the spec adds new operator-facing behavior (a PR that auto-flips to ready) with no regression guard; a silent break in the ready step would pass CI today.

The seam to do this already exists: the intent suite drives the full commit path against a fake `gh` on `PATH` inside a real git repo, and the new call site threads `getOpenPrState` the same way plan does. Extending the shim so the state check returns a genuine draft state and `pr ready` flips it (plus a failure variant where `pr ready` exits non-zero) drives the success path, the exit-0-on-failure path, and the no-commit path through `intentCommand` with no new TypeScript seam. The actuator should choose the concrete shim mechanics; the required outcome is that all four ACs have assertions.

### Not required

- **Idempotency AC wording.** The re-run no-op credits the inherited library state guard, not CLI reachability (each run mints a fresh branch, so re-running never targets the prior PR). The text is an honest record of inherited behavior, not an over-claim — leave it.
- **Inlined warn-and-continue wrapper.** Reusing plan's `safeMarkPlanPrReady` would require exporting or extracting a plan-internal, `PlanIo`-typed helper across a module boundary for an 8-line try/catch. The spec's "reuse" decision targets the gate+retry logic (`maybeMarkPlanPrReady`), which is reused; the thin wrapper is acceptably duplicated. Optional cleanup only.
- **"Review the draft PR" next-steps string.** The spec explicitly accepts keeping this identical to plan's (consistency over cosmetic divergence; both print before auto-ready). No change.
- **Footer staleness / check:fix ordering.** Inherited from plan by design; a markdown-only intent split makes a check:fix commit near-impossible. Out of scope.