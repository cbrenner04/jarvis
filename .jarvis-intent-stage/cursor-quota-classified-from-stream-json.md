---
name: cursor-quota-classified-from-stream-json
---

# Cursor quota classification ignores model prose in stream-json stdout

Unsplit rationale: One shared-invocation exit-classification seam (`classifierDiagnostics` and cursor settle paths); docs only record the same behavior.

## Problem

Cursor runs with `--output-format stream-json`, so stdout carries assistant deltas, thinking, and tool output. Quota classification scans combined stderr+stdout like every adapter except opencode, so model or grep text matching `cursorQuotaPatterns` false-trips healthy runs that already emitted a terminal success `result` (observed 2026-09-29: six false `quota` escalations to paid rungs).

## Decisions

- Cursor quota/transient/model-config classification reads stderr plus the terminal stream-json `result` frame (`is_error`, error payload), never assistant/thinking/tool-output frames.
- Terminal `result` with `subtype: success` and `is_error: false` forbids `quota` regardless of other stream content.
- Keep existing `cursorQuotaPatterns` for the channels still scanned; no pattern changes.

## Primary implementation surface

- Shared agent invocation exit classification (`shared/invocation`).

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` drives cursor stream-json stdout whose assistant text contains each `cursorQuotaPatterns` phrase plus a terminal success `result` at exit 0; settlement is not `quota` (fails against pre-fix combined-stream classification).
- [ ] The same test file proves genuine cursor quota via stderr or a non-success/error `result` carrying the quota message still settles `quota`.
- [ ] `cursor binding classifies quota (ASCII and U+2019), model config, and generic errors` and `cursor binding classifies zero-exit quota patterns` stay green where still applicable after narrowing the scanned stdout surface.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/quota-signals.md` — cursor classifies from stderr and the terminal `result` event only; drop or replace the false-`quota` at ~24s note with the fixed channel rule.
- `v2/docs/operator-runbook.md` — § Choosing an actuator: replace the cursor false-`quota` at ~24s bullet with a pointer to the quota-signals cursor section.
- `v2/docs/shared-invocation.md` — align the resolved-cursor-binding classifier paragraph with the narrowed diagnostics surface (mirror opencode scoping language where it applies).
- `v2/docs/v1-behaviors.md` — record cursor classifier diagnostics scoped like opencode but including the terminal `result` frame.

## Prerequisites
