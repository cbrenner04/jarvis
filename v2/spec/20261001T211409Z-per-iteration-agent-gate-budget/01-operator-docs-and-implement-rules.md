# Operator docs and implement rules for gate budget

## Problem

Operators and implement agents only see the concurrent gate slot and ceiling-headroom refusals today; the per-iteration full-suite cap and its non-terminal reprompt path are undocumented.

## Decisions

- Document the budget in the durable homes listed below; cross-link `write-behavior.md` and `operator-runbook.md` § Concurrency instead of duplicating full settlement prose in both.
- Update `v2/docs/v1-behaviors.md` implement gate-invocation bullet to include the per-iteration cap and that budget refusal continues the loop rather than settling `gate_invocation_refused`; rules out leaving the parity catalog describing only headroom and slot refusal.

## Tasks

- `v2/docs/operator-runbook.md` § Concurrency — per-iteration budget (`MAX_AGENT_GATE_INVOCATIONS_PER_ITERATION`), `iteration_gate_budget`, slot re-drive still `slot_contention` only.
- `v2/docs/write-behavior.md` — gate-budget refusal, `gate_invocation_budget_refused` log event, checkpoint + next-iteration reprompt; distinguish from terminal `gate_invocation_refused`.
- `v2/docs/v1-behaviors.md` — extend the implement agent gate-invocation budget bullet for the per-iteration full-suite cap.
- `prompts/implement/rules.md` — state the budget up front (two classified `bun run test:*` invocations per iteration; use `bun test <file>` while iterating).

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` § Concurrency documents the per-iteration gate budget, cause `iteration_gate_budget`, and that automatic slot re-drive remains `slot_contention` only.
- [ ] `v2/docs/write-behavior.md` documents budget refusal, the reprompt seam, and that budget refusal does not settle terminal `gate_invocation_refused`.
- [ ] `v2/docs/v1-behaviors.md` records the per-iteration full-suite cap and non-terminal budget refusal behavior.
- [ ] `prompts/implement/rules.md` states the two-invocation-per-iteration budget and file-scoped verification guidance.
- [ ] `bun run typecheck` and `bun run lint:md` pass on the touched markdown.

## Documentation updates

- `v2/docs/operator-runbook.md` § Concurrency.
- `v2/docs/write-behavior.md`.
- `v2/docs/v1-behaviors.md`.
- `prompts/implement/rules.md`.
