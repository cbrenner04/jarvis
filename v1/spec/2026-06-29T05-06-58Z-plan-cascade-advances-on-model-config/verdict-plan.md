## Verdict — required refinements

### Scope and ledger

1. **`name-only` scope** — Reconcile with intent: either drop from tasks/ACs with a ledger line that dormant export-only paths are out of scope, or keep the `shouldAdvance` one-liner only with a ledger line that parity is binding-predicate maintenance (no operator path today per `v1-behaviors.md`). If kept, do not require operator stderr ACs.

2. **`intent-draft` out of scope** — Add ledger entry: retired pre-intent-mode remnant, no intent mention, zero importers — rules out symmetric dead-path sweep with `name-only`.

3. **Pre-invocation `model_config` stays terminal** — Ledger: empty `agentOrder`, prompt-build failure, and other pre-spawn `model_config` returns do not cascade — rules out applying “advance all” before first agent spawn.

4. **“Prompt parity” precision** — Retitle or split the advance-all decision: predicate parity with prompt (`model_config` advances); rotation stderr uses plan/intent harness line, not prompt raw stderr passthrough.

### Acceptance criteria

5. **Draft terminal stderr** — Mirror intent: all agents `model_config` → `result.kind === "model_config"` **and** stderr contains `plan: model configuration error`.

6. **Agent stderr on rotation** — At least one cascade AC (intent or draft) verifies non-empty agent stderr appears after the fallback harness line.

7. **Intent-split preserve-on-`error`** — Add preservation AC (new or extended test) that hard `error` still does not advance at intent-split, matching draft's pinned behavior.

8. **`name-only` stderr** — Only if `name-only` stays in operator scope; otherwise omit per item 1.

### Tasks and implementation contract

9. **Emitter convergence** — Task must require a single shared rotation-stderr path (extend `emit-plan-quota-stderr` or equivalent) covering draft **and** intent-split — rules out leaving intent-split on inline quota strings while draft uses the emitter.

10. **Grep contract** — Pin whether rotation and terminal messages are disjoint by phrase or disambiguated by full-line/suffix (`; falling back`); document in `quota-signals.md` update scope.

11. **Emitter tests** — Add `emit-plan-quota-stderr.test.ts` (or extend existing) to task checklist if emitter is extended.

### Documentation updates (required additions)

Per `documentation-standard.md` behavior-change rule and spec-guidance `v1-behaviors.md` requirement, extend the documentation updates list to cover operator docs that still describe fatal plan `model_config`:

12. **`v1/docs/agent-cli-failure-pipeline.md`** — draft/name-only rows: `model_config` rotates.
13. **`v1/docs/workflows.md`** — remove/revise “only `model_config` exits immediately with code 3” for plan inner loops.
14. **`v1/docs/intent-mode.md`** — intent-split `model_config` cascade, not quota-only fallback.
15. **`v1/docs/agents.md`** — revise “byte-identical stderr” preservation claim; document advance predicate includes `model_config` on live plan phases.
16. **`shared/invocation/execute.ts` comment** — add to doc/task scope: default `shouldAdvance` comment is stale once plan bindings override.

`v2/docs/v1-behaviors.md` entry already listed — keep; it is the cross-mode durable home.

### Explicitly not required

- Mixed `model_config` ↔ `quota` chain exhaustion AC — optional; final `kind`/exit semantics are inferable.
- Shrink `model_config` preservation test anchor — decision scoping suffices; no fabricated AC without an existing test to cite.
- Telemetry parity across rotation attempts — no behavior change intended; silence or one-line “inherits per-phase telemetry” is sufficient.
