---
name: cursor-out-of-usage-is-not-classified-quota
---

# Cursor's out-of-usage error is not classified quota, so the chain never reaches the third rung

## Problem

Cursor reports exhaustion as:

```text
ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.
```

None of the nine `cursorQuotaPatterns` (`shared/invocation/agents.ts:1066-1076`) match it. The nearest, `/\byou['’]ve hit your usage limit\b/i`, wants "you've hit your usage limit"; cursor says **"You're out of usage"**. Neither `ActionRequiredError` nor "Increase limits" nor "out of usage" appears in the list.

So the invocation classifies as a generic `error` with `exit_code:1`. **The agent order advances on quota only**, so a generic error stops the chain rather than falling through — and the third rung is never invoked. A run with a fully-available third agent settles `invocation_failure` / `resumable: false` in seconds.

## Evidence (2026-09-08, project `sudoku`, agent order `codex, cursor, claude`)

Eight `plan`/`intent` stages failed `invocation_error`, across five lanes (`plan/basic-single-finders` ×4, `plan/locked-candidate-finders`, `plan/versioned-basic-technique-catalog`, `intent/human-solver-advanced-techniques`, `intent/attempt-event-log-and-replay`). Every one has exactly **two** telemetry rows and then stops:

| role | agent | model | duration | exit_kind |
| --- | --- | --- | --- | --- |
| plan | codex | gpt-5.6-sol | 2.4–14.7s | `quota` |
| plan | cursor | Composer 2.5 | 3.0–3.3s | `error` (`exit_code:1`) |

`claude` — the configured third rung — has **zero** invocations in that window, while succeeding normally for another project on the same machine and daemon. Both upstream rungs were genuinely exhausted; the session log for run `880b2201` carries both banners:

```text
[codex]  ERROR: You've hit your usage limit … try again at 10:52 AM.
[cursor] ActionRequiredError: Increase limits … You're out of usage.
```

Codex's is matched and cascades correctly. Cursor's is not, and the cascade dies one rung short of a working agent.

Scale: since 12:00 that day, cursor was **0 ok / 9 attempts** while codex was 13/22 (its window recovers intermittently). Stages therefore succeeded whenever codex happened to have quota and died outright when it did not — the operator hand-landed every stage for a full day. The near-constant ~3.0–3.4s cursor duration is the tell that it is failing before doing any work.

## Decisions

- Add cursor's out-of-usage shape to the quota patterns — at minimum "out of usage", and the `ActionRequiredError` limit-increase banner — so it classifies `quota` and the chain advances; rules out leaving a live exhaustion phrasing unmatched while eight near-synonyms are listed.
- Patterns are matched against the whole captured stderr, not the first error line, so a preceding noise line cannot mask the banner; rules out the ordering gap already recorded in [[quota-classification-covers-every-step-role]] recurring for cursor.
- When the last configured rung fails, the settled error names **every** rung tried and its classification, so an operator can see the chain stopped early rather than inferring it from telemetry; rules out a settlement that looks identical whether one rung or three were attempted.
- Vendor exhaustion wording changes without notice, so an agent that exits non-zero having produced no output and no usage is treated as a *provisional* exhaustion signal for fallback purposes, recorded distinctly from a matched banner; rules out a pattern list that must be exhaustive to keep the cascade working. Rules out treating it as terminal quota for reporting — the distinction stays visible.
- Scope is classification and cascade. The reporting defect where such a failure surfaces the prompt as its message with no telemetry row stays with [[invocation-error-reports-the-prompt-and-records-nothing]]; rules out merging the two.

## Acceptance criteria

- [ ] A classification test proves the literal cursor stderr `ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.` classifies `quota`; it fails against the current pattern list.
- [ ] A classification test proves that banner still classifies `quota` when preceded by an unrelated error line.
- [ ] A fallback test proves a chain whose first two rungs return quota advances to and invokes the third rung; it fails against the current stop-on-`error` behaviour.
- [ ] A test proves an agent exiting non-zero with no output and no usage advances the chain, and that its settled classification is distinguishable from a matched-banner quota.
- [ ] A test proves the settled error after final-rung failure names every rung attempted with its classification.
- [ ] Existing cursor `model_config` and generic-error classifications stay green in `shared/invocation/agents.test.ts`.
- [ ] `bun run typecheck` and the `test:shared` pair pass.

## Documentation updates

- `v2/docs/quota-signals.md` — cursor's out-of-usage and `ActionRequiredError` shapes, and the whole-stderr matching rule.
- `v2/docs/agent-model-config.md` — the chain advances past any rung that cannot do work, not only a matched quota banner.
- `v2/docs/operator-runbook.md` — § Choosing an actuator: a ~3s non-zero cursor exit with no output means exhausted-or-unusable, not slow; check telemetry for the rung count before assuming the order was honoured.
