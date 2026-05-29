# 01 - Add the shared step runner and terminal contract checks

## Decisions

- Put outcome-token parsing, terminal-token gating, contract dispatch, and typed result classification in one shared runner seam.
- Treat `write` as a behavior input to the runner, not the place that parses tokens or evaluates contracts.
- Support the decided token vocabulary exactly: `done`, `no-work`, `blocked`, `progress`.
- Run contract checks only for `done` and `no-work`.
- Return `progress` as a typed non-success result with no retry in Phase 1.
- Keep contract-miss results distinct from agent-declared `blocked` results.
- Start with the smallest deterministic contract primitive set the first `write` caller needs.
- Do not design a broad reusable contract DSL ahead of a second behavior.
- Deferred to first consumer: any contract primitive beyond the first `write` artifact proof — pin when another caller needs it.

## Constraints

- The runner may call the shared invocation layer exactly once in Phase 1.
- The runner must not spawn a second agent call when a contract fails.
- The runner must stay host-agnostic and abortable.
- Keep CLI exit mapping and terminal formatting out of this subspec.
- Keep workflow sequencing and repeat-until-done loops out of scope.

## Task checklist

- Add one shared runner surface over shared invocation.
- Parse and validate the outcome token once in shared code.
- Add deterministic terminal contract evaluation and typed result classification.
- Add tests for each token path and a contract miss.
- Document the runner-owned boundary in one durable home.

## Acceptance criteria

- [ ] A shared step runner consumes a behavior prompt/contract bundle plus invocation dependencies and owns token parsing, contract dispatch, and typed result classification.
- [ ] The runner recognizes `done`, `no-work`, `blocked`, and `progress` exactly once in shared code; write-specific code does not duplicate that logic.
- [ ] `done` and `no-work` run deterministic contract checks, `progress` skips contract checks and returns a typed non-complete result, and `blocked` returns a typed blocked result without contract evaluation.
- [ ] A contract miss after `done` or `no-work` surfaces as a hard non-success result distinct from agent-declared `blocked`, with no hidden retry and no second invocation.
- [ ] Tests cover terminal token parsing, the `progress` non-loop path, and at least one contract-pass plus contract-fail case.

## Documentation updates

- Add or update one `v2/docs/` contract doc for runner-owned token parsing and contract dispatch.
- Do not edit `v2/docs/v2-architecture.md`.
