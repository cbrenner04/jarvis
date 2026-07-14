# Centralize review profiles and prompt assembly

Review domains currently select context and assemble prompts in v2 render modules that also execute cycles. Establish the shared domain contract without changing review results.

## Decisions

- Define one `ReviewPromptProfile` per intent, plan, and implement domain; rules out independent prompt, verdict, and boundary selectors that can drift.
- Keep light or debate on the authored review step, while the profile supplies domain semantics to either executor; rules out encoding cycle behavior as a domain property.
- Put profile definitions and all review prompt/context assembly under `shared/prompts/`; rules out shared code importing v2 render helpers.
- Keep `review-cycle.ts` and `review-debate.ts` as the only cycle executors, with render callbacks supplied by the profile; rules out executor wrappers in render modules.
- Preserve rendered prompt bytes and per-cycle context refresh; rules out prompt revisions or one-time snapshots during this refactor.

## Task checklist

- Add the shared profile contract and intent, plan, and implement profiles.
- Move critic, debate-role, and actuator prompt/context assembly to `shared/prompts/`.
- Make both cycle executors consume profile render callbacks and remove execution from render modules.
- Update prompt governance in its durable home.

## Acceptance criteria

- [ ] `shared/prompts/review-profile.test.ts` fails against the baseline and passes with one profile contract covering intent, plan, and implement prompt/context, verdict lifecycle, and write-boundary selections for light and debate execution.
- [ ] `render-intent-review-prompts.test.ts`, `render-plan-review-prompts.test.ts`, and `review-debate-render.test.ts` stay green after their assertions move to shared prompt tests (rendered prompt behavior unchanged).
- [ ] `review-cycle.test.ts` and `review-debate.test.ts` stay green with cycle order, empty-verdict termination, actuator invocation, retries, and role failures unchanged.
- [ ] Review render modules under `shared/prompts/` contain prompt/context assembly only; `review-cycle.ts` and `review-debate.ts` remain the executor boundaries.
- [ ] `v2/docs/prompts.md` documents `ReviewPromptProfile`, shared review assembly ownership, and light/debate renderer selection without duplicating workflow policy.

## Documentation updates

- `v2/docs/prompts.md` — profile ownership, shared assembly, and executor/render boundary.
