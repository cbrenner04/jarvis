# Route review actuator rungs through shared execution

## Problem

`createActuator` in `v1/src/modes/patch/review.ts` still owns a hand-rolled
per-rung loop over `reviewActuatorOrder` even though `shared/invocation/execute.ts`
already exposes the shared fallback executor used by other review-shaped paths.
That duplicate control flow already drifted once on strict quota fallback and
again on lenient weak-quota classification. This slice removes the duplicate
loop without changing review actuator outcomes.

## Decisions

- Review actuator uses one `InvocationBinding` per `reviewActuatorOrder` rung and one `executeWithQuotaFallback(...)` call for rung selection; rules out keeping a second fallback loop in `v1/src/modes/patch/review.ts`.
- Each binding invocation owns its own `AbortController`, idle watchdog timer, pgid capture, and descendant polling; rules out one executor-wide controller whose rung-1 idle abort leaves rung 2 with a permanently aborted signal.
- Review actuator bindings set `shouldAdvance` to cover native quota, lenient weak-quota upgrades, and `kind === "error"` with `stderr` containing `aborted: idle-timeout`; rules out silently inheriting the shared executor default quota-only policy or imposing the actuator policy on other review-shaped callers.
- Binding `shouldAdvance` excludes `model_config`, iteration-wall timeout, and other non-idle errors; rules out accidentally broadening review actuator fallback beyond today's contract.
- The actuator binding seam preserves caller-supplied prompt text as authoritative for the actuator path, so the verdict-actuator prompt is built once before shared execution and reused by every rung binding; rules out per-rung prompt rebuilds that can drift from the persisted `verdict-patch.md`.
- Success side effects stay in `v1/src/modes/patch/review.ts`, keyed from `execution.attempts` and `execution.final`; rules out teaching `shared/invocation/execute.ts` about verdict restore, spec/code reverts, commits, pushes, convergence, or PR-body refresh.
- The `actuatorOrder.length === 0` path stays a pre-executor terminal failure; rules out fabricating an empty binding chain and changing the current actuator-unavailable path.

## Tasks

- Replace the inline `for (let rungIndex ...)` actuator loop in `v1/src/modes/patch/review.ts` with one `executeWithQuotaFallback(...)` call over bindings built from `reviewActuatorOrder`.
- Extend `createReviewInvocationBinding` with the hook surface the actuator watchdog already needs (`onSpawned`, liveness timestamp, abort grace, authoritative prompt handoff, and any equivalent binding-owned spawn options) and keep that wiring inside each binding invocation.
- Keep actuator-only fallback policy local to the actuator bindings, while standalone review-mode callers keep their current binding/executor behavior.
- Keep per-rung fallback stderr emission and telemetry on the review side of the seam, preserving current message text and `exitReason` values for strict quota, lenient weak-quota, idle fallback, terminal idle, and infra failures.
- Keep post-success handling on the review side of the seam: restore `verdict-patch.md`, revert spec edits, recover immutable-copy overreach, commit/push/reconcile, and refresh the PR body.
- Keep terminal result mapping on the review side of the seam: `model_config`, final-rung quota, final-rung idle, and other actuator errors must resolve to the same review-phase exit behavior as today.
- Add or adjust tests so the executor migration is pinned by behavior, by fresh-signal coverage after an idle-timeout advance, and by the zero-rung actuator-unavailable path.

## Documentation updates

- `v2/docs/shared-invocation.md` — document that the shared executor advances on binding-owned `shouldAdvance`, with quota-only as the default policy rather than the only policy, and that review actuator opts into a broader actuator-only advance policy.
- `v2/docs/v1-behaviors.md` — record that patch review actuator rung selection now routes through the shared invocation executor while preserving head-only quota fallback, full-ladder idle escalation, prompt reuse across actuator rungs, the zero-rung terminal path, and existing terminal review outcomes.

## Acceptance criteria

- [x] `v1/test/modes/patch/review.sandbox-unrunnable.test.ts` stays green for the existing review-actuator preservation coverage, including quota fallback, lenient weak-quota fallback, verdict/spec restore, idle escalation, final-rung idle, idle disabled, iteration-wall terminality, auth-note emission, quota-line emission, reconcile-before-push, empty verdict skip, and orphan reaping.
- [x] `v1/test/modes/review/run.test.ts` stays green for standalone review-mode binding/executor preservation coverage, including `upgrades lenient weak-quota errors when porcelain is unchanged`, so the shared binding extraction does not regress non-actuator review callers.
- [x] `v1/src/modes/patch/review.ts` routes review actuator rung selection through `shared/invocation/execute.ts` `executeWithQuotaFallback(...)` with one binding per `reviewActuatorOrder` rung instead of a hand-rolled rung loop.
- [x] Review actuator still advances past a non-final rung on native quota, lenient weak-quota, and `aborted: idle-timeout`, while `model_config`, iteration-wall timeout, and other non-idle errors stay terminal for that pass.
- [x] The actuator path reuses one caller-built verdict prompt across every rung attempt, so the persisted `verdict-patch.md` text cannot drift by rebuilding prompt text per rung.
- [x] A review-actuator test proves a rung reached after an earlier rung's idle-timeout advance receives a fresh non-aborted signal, guarding against an executor-wide controller shared across rungs.
- [x] A review-actuator test proves `reviewActuatorOrder.length === 0` still exits on the review side with `review: actuator no agents available` before shared execution would return its empty-binding result.
- [x] `v2/docs/shared-invocation.md` and `v2/docs/v1-behaviors.md` describe the live shared-executor boundary and review-actuator contract consistently.
