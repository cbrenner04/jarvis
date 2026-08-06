# Base-ref scope classification

Ready-gate repair today treats diff membership as the sole out-of-scope signal, stranding caused failures as `ready_gate_out_of_scope` with `resumable: true` over a condition no resume can change.

## Decision ledger

- Scope is decided by whether the failure reproduces on the run's `baseRef`, not diff membership alone — rules out path membership as the sole out-of-scope signal.
- A failure that passes on base and fails in the worktree is in scope; repair proceeds and the failing file joins the repair allowset for that gate only — rules out refusing repair and widening the frozen diff fence generally.
- Per-path base-ref probe: each attributable failing path is probed independently; paths that pass on `baseRef` and fail in the worktree are in scope and join the per-gate allowset; settlement is `ready_gate_out_of_scope` only when every attributable path fails on `baseRef`; mixed results enter bounded repair with allowset = frozen diff/spec union plus in-scope failing paths only — rules out a single mixed settlement that skips repair or widens the fence beyond caused paths.
- The base-ref probe is scoped to attributable failing paths the terminal ready step already reported — rules out doubling gate wall time.
- Base-ref reproduction re-runs each terminal failing ready-step's scoped command at `baseRef` through an injected seam (same step command and attributable paths the gate reported), not a second full `bun run ready` — rules out doubling gate wall time and opaque worktree snapshot diffs.
- A probe that cannot run classifies in scope so repair is attempted — rules out fail-closed behavior whose only outcome is an unrecoverable row.
- Per-gate allowset extension is recomputed on each repair entry from the frozen diff/spec allowset plus in-scope attributable failing paths for the active gate only; it is not persisted on the fence row across gates or repair entries — rules out stale or cross-gate allowset drift for subspecs 02 and 05.
- Conservative attribution rules from the untouched-path classifier remain unchanged: mixed, absent, malformed, stale-retry, later-non-test, and partial attribution stay `ready_gate_failed`.
- Probe error on classified `ReadyGateError` when repair is skipped remains deferred; when probe failure classifies in scope and repair is attempted, the probe error is reported via a `ready_gate_base_ref_probe` log event whose `message` carries probe exit summary and stderr tail, visible in `jarvis run log` tail before the first `ready_gate_repair` on that entry — rules out contradicting integration ACs with opaque "reported" wording.

## Task checklist

- Add a base-ref reproduction seam to `classifyReadyGateError` / `classifyReadyGateFailure` in `v2/src/execution/ready-finalize.ts`.
- Thread per-gate allowset extension (frozen diff/spec allowset plus in-scope attributable failing paths for the active gate) into ready-gate repair entry in `publishWithReadyRepair`.
- Stub base-ref reproduction as failing on `baseRef` in preservation fixtures for out-of-scope cases (`ready-finalize.test.ts` "classifies fully attributed terminal failures outside the allowed set as out of scope", `write-loop.test.ts` "never invokes repair for a fully attributed untouched-path gate"); stub passing-on-`baseRef` for the new outside-diff in-scope regression.
- Update `formatReadyGateOutOfScopeDetail` and `readyGateOutOfScopeDetail` / `readyGateOutsidePaths` operator strings to describe base-ref out-of-scope semantics (fails on `baseRef` too), not diff-only "touched set" language.
- Add unit regressions in `v2/src/execution/ready-finalize.test.ts` and integration regressions in `v2/src/execution/write-loop.test.ts`.

## Acceptance criteria

- [ ] `v2/src/execution/write-loop.test.ts` adds a pre-fix-failing regression that drives a red gate whose failing file is outside the run diff but passes on `baseRef`, asserts the run classifies in scope, admits repair, and adds only that file to the repair allowset for that gate.
- [ ] A red gate whose failing file also fails on `baseRef` still settles `ready_gate_out_of_scope` with that path named; `ready-finalize.test.ts` "classifies fully attributed terminal failures outside the allowed set as out of scope", "keeps mixed, absent, malformed, stale-retry, later-non-test, and partial attribution on ready_gate_failed", and `write-loop.test.ts` "never invokes repair for a fully attributed untouched-path gate" stay green.
- [ ] `ready-finalize.test.ts` adds a pre-fix-failing regression that a base-ref probe failure classifies in scope; `write-loop.test.ts` asserts repair is attempted and a `ready_gate_base_ref_probe` log event with probe error detail appears in `jarvis run log` tail before the first `ready_gate_repair`.
- [ ] `formatReadyGateOutOfScopeDetail` and operator mirrors no longer describe out-of-scope paths as lying outside the run's touched set; they state the failure also reproduces on `baseRef`.
- [ ] In `ready-finalize.test.ts`, the test titled `base-ref reproduction classifies a base-passing worktree-failing path as in scope` carries a `// @mutate` directive inverting the base-ref comparison guard; the mutation turns that test RED. (Criterion names the enclosing `test()` title verbatim so `linkDirectivesToCriterion` resolves the directive.)

## Documentation updates

- `v2/docs/write-behavior.md` — base-ref reproduction probe, per-gate allowset addition, mixed per-path settlement, and updated out-of-scope meaning (fails on base too).
- `v2/docs/workflow-runner.md` — replace diff-only untouched-set language for `ready_gate_out_of_scope` with base-ref scope semantics.
- `v2/docs/v1-behaviors.md` — record v2 ready-gate repair base-ref scope contract.
