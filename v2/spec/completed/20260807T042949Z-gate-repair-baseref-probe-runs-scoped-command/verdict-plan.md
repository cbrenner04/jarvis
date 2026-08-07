Reviewing the implementation and spec to issue an independent verdict on required refinements.
## Verdict: required refinements

1. **Pin the default probe execution contract.** The decision ledger names `runV2TestFiles` with a single-file roster, while tasks still read as “fix `buildBaseRefProbeCommandArgs`” and “default probe subprocess.” The spec must state the observable contract: for v2 terminal failing steps (`bun run test:v2`, `bun run test:integration:v2`), the default probe reproduces the terminal step’s scoped runner for `[failingPath]` only — not raw `bun test <path>`, not full-roster `bun run test:v2` argv, and not merely flipping argv in `buildBaseRefProbeCommandArgs`. Clarify what `buildBaseRefProbeCommandArgs` remains responsible for (e.g. non-v2 fallback) so implementers do not treat argv shape as the whole fix.

2. **Pin scope-env derivation vs probe execution worktrees.** `JARVIS_READY_TEST_SCOPE` must be derived the same way as `createDefaultRunReadyGate` — from the run worktree (`scope.worktreePath`) against `scope.baseRef` — while test execution stays in the detached base worktree. The spec currently implies env parity without this split; omitting it risks deriving scope from the wrong diff and shipping a second misclassification path.

3. **Repair the mutation-checkpoint AC.** The `@mutate` criterion names a pin title but no machine-parseable directive (`// @mutate <path> "<original>" -> "<replacement>"`). Spec guidance requires this format for harness verification; prose-only `@mutate` (as in gate-repair-fence) will block or hollow completion. The criterion must link a stable, unique anchor that reverts scoped-runner invocation to raw `bun test` and turns the pinning test RED.

4. **Reorder pinning-test assertions: runner shape first, env second.** `runV2TestFiles` does not consume `JARVIS_READY_TIER` / `JARVIS_READY_TEST_SCOPE`; the misclassification fix is primarily scoped-runner mechanics (single-file roster, `agent` vs `integration` mode, per-file spawn path, timeout/isolation behavior). The pinning AC should treat those as primary assertions. Env forwarding is reasonable for subprocess fallback paths and gate parity, but weighting env as co-equal with runner shape risks a hollow pin that passes while misclassification persists.

5. **Name explicit residual behavior for non-v2 terminal steps.** “Deferred to first consumer” is intentional scope, but the spec should state what still happens after this subspec lands: v1/shared terminal `bun run test:*` steps and aggregate `bun run test` (when scope is `full`) likely retain the current raw `bun test <path>` probe until a follow-up consumer pins per-file routing. Residual behavior should not be implicit.

6. **Cover `test:integration:v2` mode mapping in verification.** The decision ledger decides both `bun run test:v2` → `agent` and `bun run test:integration:v2` → `integration`, but acceptance criteria only imply `test:v2`. Verification must exercise both terminal commands (second pin case or parameterized test) so mode derivation is not untested.

### Rationale

Items 1–4 close implementer ambiguity on architecture, worktree split, and test contract — the core gaps between “scoped command reproduction” (intent) and task wording that still centers argv/subprocess shape. Item 3 is a spec-guidance conformance blocker. Items 5–6 bound intentional deferrals and prevent a partial v2 fix from reading as complete terminal-step coverage.

### Not requiring refinement

- Single-subspec shape is appropriate (one execution-loop seam).
- Outcome-level classification is owned by gate-repair-fence plus subspec preservation AC citing `base-ref reproduction classifies…`, `base-ref probe failure classifies in scope`, and `classifies fully attributed terminal failures…`.
- Fail-open, per-path wall-time bound, and `JARVIS_READY_ATTEMPT_ID` parity need no new ACs (fail-open cited; wall-time follows scoped runner; attempt ID is out of scope).
- Optional task hints (mock runner patterns), intent/subspec AC alignment, and an extra classification test without stubbing `reproduceReadyGateAtBaseRef` are strengtheners, not blockers.