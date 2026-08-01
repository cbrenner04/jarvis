Reviewing implementation and docs to validate the advocate's findings before issuing the verdict.
## Verdict: required outcomes

### Blocking — spec / correctness

1. **Production reporting for unparseable linkage and checkpoints**  
   Unparseable pinning-test linkage, missing production targets, and non-mechanical inversions must be durably reported on real implement writes (not only when tests inject `reportSink`). Completion may still proceed without `contract_miss`, but operators must have an observable record with file and line — per subspec decisions and the unparseable AC.

2. **Guard-skip inversions on indented `if` lines must not silently bypass verification**  
   Short-circuit/skip-guard mutations that produce invalid syntax on typical indented guards currently fail application, are classified unparseable, and allow completion. That defeats hollow detection for checkpoints routed through skip-guard. Applying a skip-guard inversion must either succeed mechanically or follow the same unparseable reporting path without masking a hollow checkpoint.

3. **`v2/docs/write-behavior.md` must describe mutation-checkpoint verification**  
   The `spec.criteria-ticked` loop-outcomes section still says implement completion only checks that criteria are ticked. It must state that ticked non-human-only `Mutation checkpoint:` rows are verified on every `done` / `no-work` (including pre-ticked rows), hollow checkpoints refuse completion with `path:line: comment` coordinates, and unparseable/linkage failures are reported without `contract_miss`. `v1-behaviors.md` already cites this doc; leaving it stale contradicts the updated behavior.

4. **`v1/docs/spec-guidance.md` must not overclaim linkage generality**  
   Guidance currently implies broad production resolution via comment overlap and named symbols. The shipped verifier is exemplar-plus-minimum: overlap scoring across production checkpoint comments, with TUI-specific fallbacks for the cited regression rows. Authoring guidance must match that scope so spec authors do not assume mechanical linkage the harness does not provide.

### Required strengthening — tests and operational semantics

5. **`no-work` parity must be covered by a contract test**  
   The spec requires mutation-checkpoint verification on both `done` and `no-work`. Structure shares the contract path today, but a dedicated `no-work` case (hollow refusal and/or caught allowance) is required to lock parity against future token branching.

6. **Regression replay must assert the named checkpoint, not merely any hollow result**  
   `criteria-ticked-mutation-checkpoint-regression.test.ts` must prove each historical row’s hollow outcome includes coordinates (`path:line: comment`) tied to that row’s checkpoint comment (or equivalent assertion that the correct pin/comment was classified hollow). `ok === false` with `hollow.length > 0` alone does not satisfy “detects each named inversion as surviving.”

7. **Scoped-test execution must honor timeout with worktree restore**  
   The subspec requires restoring the worktree after each inversion attempt, including on scoped-test failure **or timeout**. Production scoped-test runs currently have no bounded wall clock, so a hung suite can block completion indefinitely and skip the timeout-restore path. Bounded execution with restore on timeout (aligned with other harness gate policy) is required.

### Not required in this pass

- Committed fixture trees under `v2/test/fixtures/mutation-checkpoint-regression/` — acceptance criteria are met by git-archive replay at the named SHAs.
- General mechanical parse grammar, per-pin comment filtering beyond named-pin scope, production worktree scan policy, TUI-specific fallbacks, suite-level (vs pin-level) caught signal, completion-boundary cost, or kill-semantics beyond timeout — consistent with deferred first-consumer scope and explicit subspec decisions.
- `intent.md` checkbox sync, test-file import coupling, parallel guard-mutation hygiene, or `resolveCiTestScope` naming drift — process/hygiene only.

### Rationale

Core intent is implemented: pre-ticked bypass closed, hollow checkpoints settle `spec.criteria-ticked` with blocker and detail, tests cover main contract paths. The blocking items are gaps against explicit subspec semantics (report unparseable, restore on timeout, accurate operator docs) and a real correctness hole (skip-guard bypass). Strengthening items close spec-stated parity and regression AC intent without expanding scope.