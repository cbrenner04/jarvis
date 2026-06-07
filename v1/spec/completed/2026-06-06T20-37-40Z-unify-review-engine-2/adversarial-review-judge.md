# Judge — reconciliation of review and defense

> Adjudicates [adversarial-review.md](adversarial-review.md) against
> [adversarial-review-response.md](adversarial-review-response.md).
> Reviewed at: 64d0294 · Date: 2026-06-06
>
> Verdict: **#1 upheld (fix required), #2 dismissed, #3 dismissed.** The defense
> argued #2/#3 correctly and overreached on #1.

## Finding 1 — raw exit-code propagation → **UPHELD, fix required**

The adversary is right; the defense's rebuttal does not hold. Three problems with the defense:

1. **False dichotomy.** It frames the choice as "return the raw code" *vs.* "blanket `1` that destroys the diagnostic." Those are independent. The real exit code can live in telemetry + stderr while the *returned control-flow code* is normalized. Preserving the diagnostic does not require returning the raw code as the switch value.
2. **Factual error.** The defense states "there is no automated consumer that branches on `2` vs `7`." There is: `plan.ts` switches on `reviewResult.exitCode === 2` (→ quota-exhausted) and `=== 3` (→ model-config), and patch propagates the code to the process exit. The harness's own caller is the consumer. The defense redirected to *external CI* (genuinely absent) and answered a question the adversary never asked.
3. **Circular evidence.** Citing `run.test.ts:256` (which asserts the runner returns `9`) as proof the behavior is correct just restates the disputed choice as a fixture.

The defense's only surviving point — quota/model_config are peeled off before the `error` branch, so collisions are *uncommon* — lowers probability, not consequence. A correctness bug that fires rarely is still a correctness bug, and the fix is cheap.

**Fix.** In the shared runner's error branch (`v1/src/modes/review/run.ts:170`), do not return `result.exitCode` raw. Record the true `exitCode` in telemetry/stderr (already happens at lines 154–159), then return a value that cannot collide with the reserved set `{2, 3, 7, 130}` — return `1` for any error whose code falls in that set, otherwise the raw code is fine. Equivalent: have each adapter map. Smaller blast radius to do it once in the runner.

- Update `run.test.ts:256`: assert telemetry records the raw `exitCode`, and the *returned* code is normalized away from reserved values.
- Add a test: agent error with `exitCode: 2` does **not** surface as quota in either caller.

## Finding 2 — summary reason → **DISMISSED**

The defense is correct. Zero functional effect: revert, blocker commit, PR comment, exit code, and stderr lines are all unchanged; only a telemetry summary token moved, and `agent-error` is at least as accurate as the old `blocker`/`error` for boundary violations and validation failures. No downstream consumer keys off the token. Not worth a change.

## Finding 3 — per-pass agent reset → **DISMISSED**

The defense is correct and the behavior is intentional (commit message + spec). Per-pass reset is the cleaner model: passes are independent, quota can recover between them across the `ready` gates, and the cost ceiling is one fast-failing spawn per pass. Consistent with the new lenient/porcelain-guarded quota handling. Keep as-is.

## Disposition

- **Block merge on #1 only.** Apply the normalize-reserved-codes fix + two tests above.
- #2 and #3: no action.
- Everything else the adversary praised (timeout watchdog, telemetry double-record guard, artifact-level behavior parity, 97 passing tests) stands.

## Note for the debate design

This adjudication is the argument for the third role. The defender argued #2/#3 soundly and, doing its job, pushed the strongest case on #1 — including a false premise and a circular citation that neither the adversary nor the defender was positioned to flag. Only a judge reconciling both sides catches the overreach. A two-role loop would have shipped #1.
