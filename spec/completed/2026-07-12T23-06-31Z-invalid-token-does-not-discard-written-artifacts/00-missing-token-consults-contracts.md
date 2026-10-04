# 00 - Missing token decides outcome from the step contracts

## Problem

`runStep` (`v2/src/execution/step-runner.ts`) returns `invalid_token` the moment
`parseStepOutcomeToken` finds no terminal token, before any contract runs. A `plan`
run whose agent wrote a valid spec tree but ended in prose is classified as if it
produced nothing, and the loop discards the run. The contracts the step already
carries (`artifact.exists`, `plan.draft.blocker` — `v2/src/execution/write.ts:214`)
are exactly the evidence that would settle the outcome.

## Decisions

- Missing token: evaluate the step's contracts; all pass → `complete` with token `done`. Rules out reporting `invalid_token` with artifacts intact, which strands satisfied work uncommitted.
- All contracts must pass, not just `artifact.exists` — a plan draft that wrote a genuine `## Blocker` fails `plan.draft.blocker` and must not complete.
- Any contract failing on a missing token stays `invalid_token` (not `contract_miss`) — `contract_miss` means the agent claimed done, and it appends a `## Blocker` to the spec; a silent agent made no claim to contradict. The resumability of that case is subspec 01.
- Contract evaluation runs once per step, on one shared path for both the token and no-token cases.

## Acceptance criteria

- [x] A write step whose agent emits no terminal token but whose artifact contract is satisfied returns `complete` (token `done`), and the loop commits and publishes the artifacts as it does for a token-emitting completion.
- [x] A plan-draft step with no terminal token whose spec tree is valid returns `complete`; the same step whose agent appended a genuine `## Blocker` to `intent.md` does not complete.
- [x] A write step with no terminal token and an unsatisfied artifact contract still returns `invalid_token` (with `tokenText`), and no `## Blocker` is appended to the spec.
- [x] `step-runner.test.ts` token-parsing and `contract_miss` tests stay green (contract dispatch for token-emitting steps is unchanged).

## Documentation updates

- `v2/docs/shared-step-runner.md` — the runner classifies a missing token from the contracts, not before them.
- `v2/docs/write-behavior.md` — terminal-outcome list: a missing token with satisfied contracts is `complete`.
