---
name: cursor-quota-classified-from-stream-json
---

# Cursor quota classification ignores model prose in stream-json stdout

Unsplit rationale: One shared-invocation exit-classification seam (`classifierDiagnostics` and cursor settle paths); docs only record the same behavior.

## Problem

Cursor runs with `--output-format stream-json`, so stdout carries assistant deltas, thinking, and tool output. Quota classification scans combined stderr+stdout like every adapter except opencode, so model or grep text matching `cursorQuotaPatterns` false-trips healthy runs that already emitted a terminal success `result` (observed 2026-09-29: six false `quota` escalations to paid rungs).

## Decisions

- Cursor quota/transient/model-config classification reads stderr plus the terminal stream-json `result` frame (`is_error`, error payload), never assistant/thinking/tool-output frames.
- When stdout has no terminal `result` frame: scan stderr and any stdout line that is not a parseable stream-json frame (plain-text quota/crash output); ignore parseable non-`result` JSON lines.
- Terminal `result` with `subtype: success` and `is_error: false` forbids `quota` from stdout only; stderr quota patterns still settle `quota` even alongside that success `result`.
- Keep existing `cursorQuotaPatterns` for the channels still scanned; no pattern changes.

## Primary implementation surface

- Shared agent invocation exit classification (`shared/invocation`).

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` drives cursor stream-json stdout whose assistant text contains each `cursorQuotaPatterns` phrase plus a terminal success `result` at exit 0; settlement is not `quota` (fails against pre-fix combined-stream classification).
- [ ] The same test file proves genuine cursor quota via stderr, a non-success/error `result` carrying the quota message, or plain non-JSON stdout when no `result` frame was emitted, still settles `quota`.
- [ ] The same test file proves terminal success `result` plus stderr matching `cursorQuotaPatterns` still settles `quota`.
- [ ] The same test file proves an error `result` with `is_error: true` and a non-quota message settles `error`, not `quota`.
- [ ] The same test file proves model-config and transient markers on stderr (and on a scanned `result` error payload when present) still classify as `model_config` and transient respectively.
- [ ] `cursor binding classifies quota (ASCII and U+2019), model config, and generic errors` stays green (stderr-only fixtures; unchanged channel).
- [ ] `cursor binding classifies zero-exit quota patterns` is rewritten so the quota case uses stderr or an error `result` frame instead of plain stdout; the normal zero-exit success path stays green.
- [ ] `cursor binding classifies quota phrases in stream-json frames` is rewritten to assert non-`quota` when the phrase appears only in a non-`result` stream-json frame (not deleted).
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/quota-signals.md` — cursor classifies from stderr, the terminal `result` event, and plain non-JSON stdout when no `result` frame; drop or replace the false-`quota` at ~24s note with the fixed channel rule.
- `v2/docs/operator-runbook.md` — § Choosing an actuator: replace the cursor false-`quota` at ~24s bullet with a pointer to the quota-signals cursor section.
- `v2/docs/shared-invocation.md` — align the resolved-cursor-binding classifier paragraph with the narrowed diagnostics surface (mirror opencode scoping language where it applies).
- `v2/docs/v1-behaviors.md` — record cursor classifier diagnostics scoped like opencode but including the terminal `result` frame and plain stdout fallback when no `result` is present.

## Prerequisites
