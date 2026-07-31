# Step contract check carries dynamic failure reason

## Problem

`StepContract.check` returns only `boolean`. `evaluateContracts` sets `failureReason`
from the static `contract.reason` field. Plan-draft normalization failures need a
per-check dynamic message that `write.ts` cannot supply through `reason: "plan.draft.shape"`.

## Decisions

- `StepContract.check` may return `{ ok: false; reason: string }` in addition to `boolean` —
  rules out a parallel side channel for dynamic contract text.
- Contract pass/fail uses an explicit `ok` (or equivalent) field, not JavaScript truthiness on
  structured returns — rules out `{ ok: false }` counting as pass because the object is truthy.
- `evaluateContracts` maps a check-returned `reason` to `failureReason`, ahead of static
  `contract.reason` — rules out ignoring the check when `contract.reason` is set.
- A `true` / `{ ok: true }` check still passes; failed checks without a returned reason keep
  today’s `contract.reason` fallback — rules out breaking existing boolean-only contracts.
- Verdict stays `contract_miss`; only `failureReason` gains a dynamic source — rules out new
  outcome kinds.

## Task checklist

- Extend `StepContract.check` return type and `evaluateContracts` in `step-runner.ts`.
- Add `step-runner.test.ts` coverage for check-returned reason precedence and boolean fallback.

## Acceptance criteria

- [ ] `step-runner.test.ts` drives `contract_miss` where `check` returns `{ ok: false, reason: "dynamic" }` with static `reason: "static"` and asserts `failureReason` is `"dynamic"`; it fails against the pre-fix code.
- [ ] `step-runner.test.ts` `no-work with failing contract returns contract miss` stays green (boolean `false` checks still classify as `contract_miss` with static `contract.reason` when present).
- [ ] Inverting the `evaluateContracts` guard that prefers a check-returned `reason` over static `contract.reason` turns the dynamic-reason test RED.

## Documentation updates

None — internal contract-evaluation plumbing; operator-facing plan-draft diagnostics land in
subspec 02.
