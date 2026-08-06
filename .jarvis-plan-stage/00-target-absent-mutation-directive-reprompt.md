# 00 - target_absent mutation directive reprompt

## Problem

Plan-authored `@mutate` directives often quote call syntax the implementer later writes with
different arity, renamed locals, or at multiple sites. `verifyMutationCheckpoints` reports
`target_absent` / `target_ambiguous`, but `spec.criteria-ticked` settles `contract_miss` /
`resumable: false` even when production behavior is done and the pin is one directive edit from
correct. Observed on all three `implement-completion-honesty` subspecs (2026-08-05).

## Decision ledger

- `spec.criteria-ticked` miss **only** from linked `target_absent` / `target_ambiguous` in opened pinning files → write-loop pre-settle `continue` with `pinningFile:line`, raw directive, and reason — rules out terminal `blocked` / `resumable: false` on a one-line pin-text mismatch the agent can self-heal.
- Repromptable misses skip `contract_miss`, `appendBlockerToSpec`, and terminal settle until `maxIterations` is exhausted — rules out harness `## Blocker` on the first pin-text miss.
- Hollow, missing-directive, `unresolved_pinning_test`, and red scoped-suite failures still settle `contract_miss` with harness `## Blocker` — rules out reprompting every unparseable checkpoint.
- `maxIterations` exhaustion with directive still unparseable settles terminal `contract_miss` / `resumable: false` — rules out unbounded repair.
- Reprompt payload carries `pinningFile:line`, raw directive, and `target_absent` / `ambiguous` reason verbatim — rules out a generic contract-miss message.
- Plan authoring: prefer a unique stable anchor (definition line, unique enclosing statement) over a bare call expression that may change arity or recur — rules out runtime-only fix leaving fragile plan pins.
- Out of scope: `@mutate` single-line replacement format or strict linker changes.

## Prerequisites

- `verifyMutationCheckpoints` reports `unparseable` entries with `target_absent` / `target_ambiguous` reasons and `pinningFile:line` coordinates.
- Write-loop `spec.criteria-ticked` settles `contract_miss` / `resumable: false` on unparseable checkpoints in opened pinning files.
- Write loop has bounded `maxIterations` consumed by ordinary step iterations.

## Task checklist

- Teach write-loop completion handling to classify `spec.criteria-ticked` `contract_miss` misses: reprompt-only when **every** blocking unparseable entry is `target_absent` or `target_ambiguous` in an opened pinning file (no hollow, no `unresolved_pinning_test`, no other unparseable reasons, no red scoped suite).
- On repromptable miss: `continue` the write loop (consumes `maxIterations`); inject reprompt context into the next write-step prompt; emit durable log event with `pinningFile:line`, raw directive, and reason verbatim; skip `appendBlockerToSpec` and terminal boundary.
- On budget exhaustion with directive still unparseable: settle terminal `contract_miss` / `resumable: false` (existing hard-block path).
- Add `write-loop.test.ts` regressions for first-miss reprompt, payload text, and budget-exhaustion block.
- Update `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md` § Gate trust, `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria, and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `write-loop.test.ts` `target_absent mutation directive reprompts before settle` drives implement `patch.prompt.body` with a ticked mutation-checkpoint criterion whose pinning-file directive is `target_absent` against landed source, asserts the loop reprompts (durable log event records directive + `target_absent` reason and the loop re-enters the agent) instead of settling `blocked` / `resumable: false`; asserts no `contract_miss` / `appendBlockerToSpec` on the first miss; fails against the current hard-block boundary.
- [ ] `write-loop.test.ts` `target_absent mutation directive budget exhaustion settles contract_miss` keeps `target_absent` through `maxIterations`, asserts terminal `contract_miss` with `resumable: false`; fails against the pre-fix code.
- [ ] `write-loop.test.ts` `target_absent mutation directive reprompts before settle` pins reprompt payload text naming offending `pinningFile:line`, raw directive, and `target_absent` / `ambiguous` reason verbatim.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria documents stable-anchor guidance for directive quoted originals (unique definition or enclosing statement over bare call expressions that may change arity or recur).
- [ ] Inverting the reprompt-only predicate for `target_absent` / `target_ambiguous` (so the miss falls through to hard block) turns `target_absent mutation directive reprompts before settle` RED; `write-loop.test.ts` links a single-line `// @mutate` naming that enclosing test verbatim.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `spec.criteria-ticked` reprompts on `target_absent` / `ambiguous` linked directives within `maxIterations`; budget exhaustion still settles `contract_miss`.
- `v2/docs/operator-runbook.md` § Gate trust — reprompt replaces operator hand-fix for plan-authored pin-text mismatch; delete the 2026-08-05 `target_absent` hard-block bullet when this ships.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — stable-anchor guidance above.
- `v2/docs/v1-behaviors.md` — reprompt boundary for repromptable unparseable mutation directives; hard-block boundary for hollow, `unresolved_pinning_test`, and other unparseable reasons.
