# Plan inner-loop model_config cascade

## Problem

Plan-mode `modes.plan.agentOrder` inner loops (`intent-split`, draft) set
`shouldAdvance` to `quota || error` only. Spawn-classified `model_config` stops
the chain on the first agent — e.g. `jarvis1 intent` exits `3` without trying
later binaries. Per-agent environment noise classified `model_config` is
agent-specific; the next configured agent may succeed. Prompt mode already
advances on every `model_config`; plan intent-split does not.

## Decisions

- **Advance predicate includes `model_config` on intent-split and draft (prompt predicate parity)** — rules out splitting agent-env `model_config` from genuine bad-model-name at this layer; spawn taxonomy unchanged.
- **Rotation stderr uses plan/intent harness fallback line, not prompt raw stderr passthrough** — rules out copying prompt's agent-stderr-only rotation shape.
- **`shouldAdvance` includes `model_config` at intent-split and draft** — rules out fixing intent-split alone.
- **`name-only.ts`: `shouldAdvance` one-liner only (binding-predicate parity)** — no operator path today per `v2/docs/v1-behaviors.md`; rules out operator stderr ACs or full-loop tests for dormant export-only path.
- **`intent-draft.ts` out of scope** — retired pre-intent-mode remnant, zero importers; rules out symmetric dead-path sweep with `name-only`.
- **Pre-invocation `model_config` stays terminal** — empty `agentOrder`, prompt-build failure, and other pre-spawn `model_config` returns do not cascade; rules out applying advance-all before first agent spawn.
- **Terminal exit `3` only when the chain ends on `model_config` with no `ok`** (including all agents returning `model_config`) — rules out silent success when every agent rejects the configured model.
- **Patch iteration, patch review, plan review, and shrink keep terminal `model_config`** — rules out widening cascade to patch/review in this intent.
- **Prompt mode unchanged** — already advances on `model_config`; no code churn.
- **Per-rotation stderr (intent-split, draft): phase prefix + harness fallback line + agent stderr when non-empty** — `intent: <agent>: model configuration error; falling back`; `plan: <agent>: model configuration error; falling back`; rules out silent cascade or quota phrasing.
- **Single shared rotation-stderr emitter for intent-split and draft** — extend `emit-plan-quota-stderr.ts` (or equivalent); rules out leaving intent-split on inline quota strings while draft uses the emitter.
- **Rotation vs terminal stderr grep contract: `; falling back` suffix disambiguates rotation from terminal `plan: model configuration error` / `intent: model configuration error`** — rules out ambiguous substring-only grep.
- **Canonical constant `HARNESS_MODEL_CONFIG_FALLBACK` in `quota-harness-messages.ts`** — rules out ad hoc per-call-site strings.
- **Final terminal messages unchanged** — `intent: model configuration error` / `plan: model configuration error` plus last agent stderr on exhaustion; existing `intent.ts` / `plan/run.ts` handlers stay.
- **Rotation telemetry inherits per-phase existing attempt recording** — no new telemetry contract in this intent.

## Task checklist

- [ ] Add `HARNESS_MODEL_CONFIG_FALLBACK`; extend shared rotation-stderr emitter (`emit-plan-quota-stderr.ts` or equivalent) for `model_config` on intent-split and draft.
- [ ] Extend `emit-plan-quota-stderr.test.ts` for `model_config` rotation lines.
- [ ] Set `shouldAdvance` to `quota || error || model_config` in `intent-split.ts` and `draft.ts`; same predicate one-liner in `name-only.ts` only.
- [ ] `intent-command.sandbox-unrunnable.test.ts`: `model_config` cascade + all-`model_config` terminal; hard `error` then `ok` rotation preserved.
- [ ] `plan-draft-hard-error-continue.test.ts` (or sibling): draft `model_config` cascade + all-`model_config` terminal.
- [ ] Update `shared/invocation/execute.ts` default `shouldAdvance` comment (stale once plan bindings override).
- [ ] Update durable docs listed below.

## Acceptance criteria

- [x] `jarvis1 intent` splitter: first agent `model_config`, second `ok` → exit `0`; stderr contains `intent: claude: model configuration error; falling back` (agent names per fake order).
- [x] `jarvis1 intent` splitter: every agent `model_config` → exit `3`; stderr contains `intent: model configuration error`.
- [x] `jarvis1 intent` splitter: first agent hard `error`, second `ok` → exit `0` (error rotation preserved).
- [x] `jarvis1 intent` splitter: first agent `model_config` with non-empty agent stderr → stderr contains harness fallback line then agent stderr.
- [x] `runDraftPhase`: first agent `model_config`, second `ok` → `result.kind === "ok"`; stderr contains `plan: claude: model configuration error; falling back`.
- [x] `runDraftPhase`: every agent `model_config` → `result.kind === "model_config"`; stderr contains `plan: model configuration error`.
- [x] `plan-draft-hard-error-continue.test.ts` stays green (hard `error` rotation unchanged).
- [x] `modes/patch/review.sandbox-unrunnable.test.ts` `model_config exits 11 and all-agent quota exits 11` stays green.
- [x] `modes/review/run.test.ts` `exits 3 for model_config and stops on hard errors` stays green.
- [x] `modes/prompt/run.test.ts` `exits 3 when model_config fallthrough ends without success` stays green.

## Documentation updates

- `v1/docs/quota-signals.md` — plan column: `model_config` rotates; rotation grep (`; falling back`) vs terminal grep contract.
- `v1/docs/plan-mode.md` — draft/intent inner-loop `model_config` cascade; review `model_config` remains fatal.
- `v1/docs/intent-mode.md` — intent-split `model_config` cascade, not quota-only fallback.
- `v1/docs/agents.md` — advance predicate includes `model_config` on live plan phases; revise byte-identical stderr preservation claim for rotation lines.
- `v1/docs/agent-cli-failure-pipeline.md` — draft row: `model_config` rotates.
- `v1/docs/workflows.md` — remove/revise plan inner-loop `model_config` immediate exit `3` claim.
- `v2/docs/v1-behaviors.md` — intent-split/draft vs prompt vs patch/review `model_config` cascade.
