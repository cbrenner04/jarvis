# Retire dormant name-only phase

## Problem

The off-registry `prompts/plan/name-only.md` template is loaded only by `v1/src/modes/plan/name-only.ts`, whose exported `runNameOnlyPhase` has no importer. Its stale telemetry producer variants and durable v1 docs still present the unreachable path as live behavior.

## Decision ledger

- Delete the v1 loader/export and its sole prompt template together — rules out retaining an unreachable API or orphan prompt for symmetry.
- Remove `name-only` from the `PlanTelemetryPhase` writer contract and `plan-name-only-ok` success branch — rules out retaining dead producer variants solely for historical JSONL readability.
- Separate current prompt ownership from relocation history in `v1/docs/agents.md` — rules out either listing retired `name-only.md`/`review.md` as live or rewriting the historical relocation inaccurately.
- Amend the existing plan-telemetry entry in `v2/docs/v1-behaviors.md` — rules out duplicate durable retirement records.
- Scope negative greps to `v1/src`, `v1/test`, `shared`, and `prompts`, excluding `v1/spec/**`, `v2/spec/**`, `**/completed/**`, `.jarvis-plan-stage/**`, and Git history — rules out unsatisfiable whole-repository absence checks that include retained specs and archives.

## Tasks

- Delete `v1/src/modes/plan/name-only.ts` and `prompts/plan/name-only.md`.
- Remove `name-only` from `PlanTelemetryPhase` and the success exit-reason selection in `v1/src/modes/plan/plan-telemetry.ts`; update its coverage for the remaining phases.
- Remove the dormant export row from `v1/docs/agent-cli-failure-pipeline.md`.
- Update `v1/docs/agents.md` so current plan prompt inventory and invocation architecture omit retired `name-only.md` and prerequisite-retired `review.md`, while relocation history remains accurate.
- Remove `name-only` from the plan-telemetry enumeration in `v1/docs/run-loop.md`.
- Amend the existing plan-telemetry entry in `v2/docs/v1-behaviors.md` for the retired writer path; do not add a separate retirement entry.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [x] `v1/src/modes/plan/name-only.ts` and `prompts/plan/name-only.md` are absent, and `rg -n "runNameOnlyPhase" v1/src v1/test shared prompts` returns no matches; this searches only the stated production/test corpus, excluding `v1/spec/**`, `v2/spec/**`, `**/completed/**`, `.jarvis-plan-stage/**`, and Git history, and `v1/src/modes/plan/name-only.ts` matches on the pre-fix base.
- [x] `PlanTelemetryPhase` and `exitReasonForPlanAttempt` no longer admit `name-only` or return `plan-name-only-ok`; retained phase values remain covered, and the pre-fix `v1/src/modes/plan/plan-telemetry.ts` branch is reachable.
- [x] Plan telemetry coverage rejects `phase: "name-only"` at compile time and covers the retained phases; the unused-error directive fails against the pre-fix writer contract.
- [x] `v1/docs/agent-cli-failure-pipeline.md` no longer inventories the dormant loader, and `v1/docs/agents.md` distinguishes relocation history from its current inventory, which omits retired `name-only.md` and prerequisite-retired `review.md`.
- [x] `v1/docs/run-loop.md` no longer lists `name-only` among emitted `plan_phase` values, and the existing plan-telemetry entry in `v2/docs/v1-behaviors.md` is amended without a duplicate retirement entry.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/agent-cli-failure-pipeline.md` — remove the dormant loader row.
- `v1/docs/agents.md` — separate accurate relocation history from current prompt ownership and invocation behavior.
- `v1/docs/run-loop.md` — remove the retired producer from emitted plan telemetry phases.
- `v2/docs/v1-behaviors.md` — amend the existing plan-telemetry entry with the retired writer boundary.
