# 00 - Classify cursor exhaustion

## Problem

Cursor reports exhaustion as `ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.` None of the nine `cursorQuotaPatterns` (`shared/invocation/agents.ts:1066`) match it — the nearest wants `you've hit your usage limit`. It therefore classifies as a generic `error`, and because the agent order advances on quota only, the fallback chain stops instead of reaching the next rung.

Observed on project `sudoku`, 2026-09-08: eight `plan`/`intent` stages settled `invocation_error` across five lanes, each with exactly two telemetry rows (`codex` `quota` → `cursor` `error`) and **zero** invocations of the configured third rung, `claude`, which was working normally for another project on the same daemon. The operator hand-landed every stage for a day.

## Decision ledger

- Add two independent anchors from the live banner (`out of usage`, `increase your limit`) rather than one, so a reworded half still classifies; rules out matching the exact sentence, which the vendor can change without notice.
- Anchor on exhaustion wording, not on the `ActionRequiredError` class name; rules out classifying every action-required condition (auth, plan change) as quota.
- Leave `isQuotaSignal`'s whole-stderr matching as-is — it already tests the full captured tail, so a preceding noise line cannot mask the banner; rules out a redundant change to matching.
- Scope is classification only. Advancing the chain past a rung that exits non-zero having done no work, and the settled error naming every rung tried, stay with [[cursor-out-of-usage-is-not-classified-quota]]; rules out widening an urgent fix into cascade redesign.

## Task checklist

- [x] Add the two patterns to `cursorQuotaPatterns`.
- [x] Pin the live banner verbatim, including the noise-prefixed shape.

## Acceptance criteria

- [x] `shared/invocation/agents.test.ts` proves the verbatim cursor out-of-usage banner classifies `quota`, both alone and preceded by an unrelated error line; it fails against the pre-fix pattern list.
- [x] Existing cursor quota, model-configuration and generic-error classifications stay green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:shared` passes.

## Documentation updates

- `v2/docs/quota-signals.md` — cursor's out-of-usage shape.
