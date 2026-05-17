# 01 — Harness messages and telemetry alignment

## Problem

Harness stderr prefixes and **`runs.jsonl`** `exitReason` / `kind` values evolved separately for patch vs plan. Operators grep logs; telemetry consumers parse JSONL. Divergent strings for **the same conceptual outcome** make triage harder and obscure when quota fallback occurred.

## Decisions

- Prefer **stable, grep-friendly** stderr prefixes per outcome class (quota strict vs probable-quota vs exhausted-all-agents).
- **`exitReason`**: extend only when necessary; document deprecations if renaming (list old → new in PR body). Avoid breaking external tooling without note.
- Plan command stderr (`plan mode: …`) may keep its banner style but **quota-related lines** should use vocabulary **consistent** with patch harness lines where they describe the same event.

## Task checklist

- [ ] Inventory current stderr strings for quota-related paths in `src/modes/patch/run.ts` and `src/commands/plan.ts` / plan phases.
- [ ] Inventory telemetry writes for the same paths (`writeTelemetry`, plan equivalents if any).
- [ ] Propose a minimal diff: align wording without churning unrelated banners.
- [ ] Update tests that assert exact stderr substrings.

## Acceptance criteria

- [x] At least one test per mode asserts aligned quota-fallback vocabulary (exact substring contract documented in code comment or `docs/quota-signals.md`).
- [x] Telemetry `kind` / `exitReason` for quota fallback and exhaustion documented in the outcome matrix (subspec 00) or in `docs/quota-signals.md`.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [x] `docs/quota-signals.md` (telemetry column or linked subsection).
- [x] `docs/run-loop.md` / `docs/plan-mode.md` only if operator-visible strings change meaningfully.
