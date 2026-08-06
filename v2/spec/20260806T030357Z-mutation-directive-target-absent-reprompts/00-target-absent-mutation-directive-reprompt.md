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
- Hollow, `unresolved_pinning_test`, other unparseable reasons, and hollow checkpoint (scoped suite stayed green) still settle `contract_miss` with harness `## Blocker` — rules out reprompting every unparseable checkpoint.
- `maxIterations` exhaustion with directive still unparseable settles terminal `contract_miss` / `resumable: false` via the existing hard-block path (including `appendBlockerToSpec`) — rules out unbounded repair.
- Reprompt prompt and durable log display reuse `describeUnparseable` shape (`pinningFile:line: reason: raw`); log event carries structured fields — rules out a generic contract-miss message.
- When multiple blocking unparseables are all repromptable (`target_absent` / `target_ambiguous`), one reprompt lists every offending directive (same `describeUnparseable` listing shape as today's blocker text).
- Plan authoring: prefer a unique stable anchor (definition line, unique enclosing statement) over a bare call expression that may change arity or recur — rules out runtime-only fix leaving fragile plan pins.
- Out of scope: `@mutate` single-line replacement format or strict linker changes.

## Reprompt lifecycle

Outcome-level wiring (analogous to landing-contract reprompt, not in-step `blocker_reprompt`):

- **Classification seam**: `write-loop.ts` intercepts `spec.criteria-ticked` `contract_miss` using structured `report.unparseable` entries — not `failureReason` string parsing.
- **Durable log event**: named kind with structured `pinningFile`, `line`, `raw`, and `reason` fields; display derived via `describeUnparseable`; sufficient for resume/audit.
- **Prompt injection**: next write-step prompt carries reprompt context via a dedicated prompt ID and template placeholders (like `write.landing-contract-reprompt`).
- **Resume**: pause/resume replays reprompt context from the persisted log tail (same pattern as `findLandingContractRepromptFromLog` / `landing_contract_reprompt`).
- **Progress boundary**: reprompt path commits `in-progress` / `progress` completion boundary before `continue` (mirrors landing reprompt; avoids resume/accounting drift).
- **Observability skip**: first repromptable miss skips the terminal bundle (`contract_miss`, `contract_miss_detail`, `appendBlockerToSpec`, terminal boundary settle) and emits the reprompt event instead.

## Prerequisites

- `verifyMutationCheckpoints` reports `unparseable` entries with `target_absent` / `target_ambiguous` reasons and `pinningFile:line` coordinates.
- Write-loop `spec.criteria-ticked` settles `contract_miss` / `resumable: false` on unparseable checkpoints in opened pinning files.
- Write loop has bounded `maxIterations` consumed by ordinary step iterations.

## Task checklist

- In `write-loop.ts`, intercept `spec.criteria-ticked` `contract_miss` from structured unparseable entries: reprompt-only when **every** blocking unparseable entry is `target_absent` or `target_ambiguous` in an opened pinning file (no hollow, no `unresolved_pinning_test`, no other unparseable reasons, no hollow checkpoint).
- On repromptable miss: `continue` the write loop (consumes `maxIterations`); inject reprompt context into the next write-step prompt; emit durable log event with structured fields and `describeUnparseable`-shaped display; commit progress boundary; skip `appendBlockerToSpec` and terminal boundary; when multiple entries are repromptable, list every offending directive in one payload.
- On budget exhaustion with directive still unparseable: settle terminal `contract_miss` / `resumable: false` via existing hard-block path including `appendBlockerToSpec`.
- On mixed miss (repromptable reasons plus hollow, `unresolved_pinning_test`, or other unparseable reasons): hard-block — no reprompt.
- Implement resume replay from persisted log tail (landing precedent).
- Add `write-loop.test.ts` regressions: `target_absent` reprompt + payload, `target_ambiguous` reprompt, budget-exhaustion block with blocker append, mixed-failure hard-block.
- Update `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md` § Gate trust, `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria, `v2/docs/v1-behaviors.md`, and close the related `v2/spec/implement-queue.md` row when deleting the 2026-08-05 operator-runbook bullet.

## Acceptance criteria

- [ ] `write-loop.test.ts` `target_absent mutation directive reprompts before settle` drives implement `patch.prompt.body` with a ticked mutation-checkpoint criterion whose pinning-file directive is `target_absent` against landed source; asserts the loop reprompts (durable log event with structured fields, loop re-enters the agent) instead of settling `blocked` / `resumable: false`; asserts no `contract_miss` / `appendBlockerToSpec` on the first miss; pins reprompt prompt and payload text in `describeUnparseable` shape (`pinningFile:line: reason: raw`); fails against the current hard-block boundary.
- [ ] `write-loop.test.ts` `target_ambiguous mutation directive reprompts before settle` drives the same reprompt boundary for `target_ambiguous`; fails against the pre-fix hard-block path.
- [ ] `write-loop.test.ts` `target_absent mutation directive budget exhaustion settles contract_miss` keeps `target_absent` through `maxIterations`; asserts terminal `contract_miss` with `resumable: false` and harness `## Blocker` append via `appendBlockerToSpec`; fails against the pre-fix code.
- [ ] `write-loop.test.ts` `mixed unparseable mutation directive reasons hard-block without reprompt` drives a miss mixing repromptable reasons with hollow, `unresolved_pinning_test`, or other unparseable reasons; asserts hard-block (`contract_miss`, `appendBlockerToSpec`) and no reprompt log event; fails if the reprompt path fires on mixed failure.
- [ ] `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria documents stable-anchor guidance for directive quoted originals (unique definition or enclosing statement over bare call expressions that may change arity or recur).
- [ ] Inverting the reprompt-only predicate in `write-loop.ts` (so the miss falls through to hard block) turns `target_absent mutation directive reprompts before settle` RED; `write-loop.test.ts` links a single-line `// @mutate` on that predicate naming the enclosing test verbatim.
- [ ] `v2/docs/v1-behaviors.md` records the reprompt vs hard-block boundary for mutation-directive unparseables (repromptable `target_absent` / `target_ambiguous` within `maxIterations`; hard-block for hollow, `unresolved_pinning_test`, hollow checkpoint, mixed failure, and budget exhaustion).
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — `spec.criteria-ticked` reprompts on `target_absent` / `ambiguous` linked directives within `maxIterations`; budget exhaustion still settles `contract_miss`.
- `v2/docs/operator-runbook.md` § Gate trust — reprompt replaces operator hand-fix for plan-authored pin-text mismatch; delete the 2026-08-05 `target_absent` hard-block bullet when this ships.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — stable-anchor guidance above.
- `v2/docs/v1-behaviors.md` — reprompt boundary for repromptable unparseable mutation directives; hard-block boundary for hollow, `unresolved_pinning_test`, hollow checkpoint, mixed failure, and budget exhaustion.
- `v2/spec/implement-queue.md` — close the `implement-reconciles-mutation-directive-to-landed-code` implement-blocker-cluster row when the operator-runbook bullet is deleted.
