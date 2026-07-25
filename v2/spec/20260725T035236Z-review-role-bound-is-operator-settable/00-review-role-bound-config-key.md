# Configured review-role bound reaches `invokeReviewRole`

`review-role-invocation.ts:37` resolves its wall clock as
`args.roleTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS` (imported from `write-loop.ts`).
`roleTimeoutMs` is declared on `ReviewCycleInput`, `ReviewDebateInput`, and the
`invokeReviewRole` args, and forwarded once (`workflow-runner.ts:1995`), but nothing in
production sets it: `prepareWorkflowSteps` (`v2/src/commands/workflow.ts`) stamps resolved
bounds onto `step.behavior === "write"` steps only. So every critic/actuator/debate role
runs on 600_000 ms, whose observed p90 (548 s) is at the wall.

## Decisions

- New machine-config key `reviewRoleTimeoutMs` in `v2/src/config/machine-config-loader.ts`, default `1_800_000`; rules out a CLI flag or a raised hardcode, which leave the bound unversioned.
- Resolve it in `prepareWorkflowSteps` alongside `resolveWritePathIterationBounds` and stamp `roleTimeoutMs` on `review` and `review-debate` steps; rules out resolving inside `invokeReviewRole`, which would read machine config from the execution layer and bypass snapshot retention.
- Validation matches `iterationTimeoutMs`: positive finite number, else throw naming the key; rules out silent coercion.
- `review-role-invocation.ts` drops its `write-loop.ts` import; its remaining fallback is the new default constant. The wiring test asserts the built step carries the configured value, so unsetting the wiring fails even though the fallback number coincides.
- Debate roles get the same single bound as critic/actuator; rules out per-role keys, which no caller needs. Deferred to first consumer: per-role review bounds — pin when a role needs a different wall.
- No ordering constraint against `idleOutputTimeoutMs`/`iterationCeilingMs`; rules out extending `resolveWritePathIterationBounds`'s inversion checks to a bound that arms a different path.
- Out of scope: escalation on overrun, actuator diff size.

## Task checklist

- [ ] Add `DEFAULT_REVIEW_ROLE_TIMEOUT_MS = 1_800_000` and `readReviewRoleTimeoutMs()` to `machine-config-loader.ts`.
- [ ] Stamp `roleTimeoutMs` on review/review-debate steps in `prepareWorkflowSteps`.
- [ ] Point `invokeReviewRole`'s fallback at the new default; remove the `write-loop.ts` import.
- [ ] Docs.

## Acceptance criteria

- [ ] With `reviewRoleTimeoutMs` set in machine config, that value reaches `invokeReviewRole` for review and review-debate steps; a new test in `v2/src/commands/workflow.test.ts` asserts the built steps carry it and fails against the pre-fix code.
- [ ] With no key configured the resolved bound is `1_800_000` ms; a test asserts the built review step's `roleTimeoutMs` is present and equal to the default, so reverting the wiring (parameter unset) fails it.
- [ ] No production source under `v2/src` resolves a review-role bound from `DEFAULT_ITERATION_TIMEOUT_MS`; `review-role-invocation.ts` no longer imports from `write-loop.ts`.
- [ ] A non-positive or non-numeric `reviewRoleTimeoutMs` fails workflow launch with a message naming the key; a test covers it.
- [ ] Inverting each added guard (the validation reject, the config-value-present branch) makes a test fail; the reject's negative case proves the invalid value does not reach a built step.
- [ ] `v2/src/execution/review-role-invocation.test.ts` and `review-cycle.test.ts` stay green (role-bound behavior unchanged when the value is passed explicitly).

## Documentation updates

- `v2/docs/install-and-config.md` — add `reviewRoleTimeoutMs` (default, validation, that it bounds each review/debate role invocation and is stamped on review steps).
- `v2/docs/workflow-runner.md` — review steps resolve their role bound from config, alongside the existing write-step paragraph.
- `v2/docs/v1-behaviors.md` — review roles no longer inherit the write-loop `iterationTimeoutMs` default; they resolve `reviewRoleTimeoutMs` (default `1800000` ms).
