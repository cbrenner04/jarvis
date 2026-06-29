# Plan inner-loop model_config cascade

## Problem

Plan-mode `modes.plan.agentOrder` inner loops (`intent-split`, draft, `name-only`)
set `shouldAdvance` to `quota || error` only. Spawn-classified `model_config`
stops the chain on the first agent — e.g. `jarvis1 intent` exits `3` without
trying later binaries. Per-agent environment noise classified `model_config` is
agent-specific; the next configured agent may succeed. Prompt mode already
advances on every `model_config`; plan intent-split does not.

## Decisions

- **Advance all spawn-classified `model_config` in plan inner loops (prompt parity)** — rules out splitting agent-env `model_config` from genuine bad-model-name at this layer; spawn taxonomy unchanged.
- **`shouldAdvance` includes `model_config` at intent-split, draft, and name-only** — rules out fixing intent-split alone.
- **Terminal exit `3` only when the chain ends on `model_config` with no `ok`** (including all agents returning `model_config`) — rules out silent success when every agent rejects the configured model.
- **Patch iteration, patch review, plan review, and shrink keep terminal `model_config`** — rules out widening cascade to patch/review in this intent.
- **Prompt mode unchanged** — already advances on `model_config`; no code churn.
- **Per-rotation stderr: phase prefix + harness fallback line + agent stderr when non-empty** — `intent: <agent>: model configuration error; falling back` for intent-split; `plan: <agent>: model configuration error; falling back` for draft and name-only — rules out silent cascade or quota phrasing.
- **Canonical constant `HARNESS_MODEL_CONFIG_FALLBACK` in `quota-harness-messages.ts`** — rules out ad hoc per-call-site strings.
- **Final terminal messages unchanged** — `intent: model configuration error` / `plan: model configuration error` plus last agent stderr on exhaustion; existing `intent.ts` / `plan/run.ts` handlers stay.
- **Empty `modes.plan.agentOrder` short-circuits stay as today** — rules out treating config errors as cascade-eligible.

## Task checklist

- [ ] Add `HARNESS_MODEL_CONFIG_FALLBACK`; wire per-rotation stderr at intent-split, draft, and name-only (reuse or extend `emit-plan-quota-stderr.ts`).
- [ ] Set `shouldAdvance` to `quota || error || model_config` in `intent-split.ts`, `draft.ts`, and `name-only.ts`.
- [ ] `intent-command.sandbox-unrunnable.test.ts`: `model_config` falls through to next agent; all-`model_config` exits `3`.
- [ ] `plan-draft-hard-error-continue.test.ts` (or sibling): draft `model_config` cascade + all-`model_config` terminal.
- [ ] Unit test `runNameOnlyPhase` `model_config` cascade (direct call; no full plan entry required).
- [ ] Update durable docs listed below.

## Acceptance criteria

- [ ] `jarvis1 intent` splitter: first agent `model_config`, second `ok` → exit `0`; stderr contains `intent: claude: model configuration error; falling back` (agent names per fake order).
- [ ] `jarvis1 intent` splitter: every agent `model_config` → exit `3`; stderr contains `intent: model configuration error`.
- [ ] `runDraftPhase`: first agent `model_config`, second `ok` → `result.kind === "ok"`; stderr contains `plan: claude: model configuration error; falling back`.
- [ ] `runDraftPhase`: every agent `model_config` → `result.kind === "model_config"`.
- [ ] `runNameOnlyPhase`: first agent `model_config`, second `ok` → `result.kind === "ok"`.
- [ ] `modes/patch/review.sandbox-unrunnable.test.ts` `model_config exits 11 and all-agent quota exits 11` stays green.
- [ ] `modes/review/run.test.ts` `exits 3 for model_config and stops on hard errors` stays green.
- [ ] `modes/prompt/run.test.ts` `exits 3 when model_config fallthrough ends without success` stays green.

## Documentation updates

- `v1/docs/quota-signals.md` — classification matrix plan column: `model_config` rotates to next agent; operator stderr grep contract for model-config fallback line.
- `v1/docs/plan-mode.md` — draft/intent inner-loop `model_config` cascade; review `model_config` remains fatal.
- `v1/docs/agents.md` — plan invocation architecture advance predicate includes `model_config` on single-call phases.
- `v2/docs/v1-behaviors.md` — intent-split/draft/name-only vs prompt vs patch/review `model_config` cascade.
