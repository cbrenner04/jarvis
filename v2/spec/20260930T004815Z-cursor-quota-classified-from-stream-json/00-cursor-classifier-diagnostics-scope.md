# 00 — Scope cursor classifier diagnostics to stderr, terminal `result`, and plain stdout

## Problem

`classifierDiagnostics` (`shared/invocation/agents.ts`) feeds cursor's full stream-json stdout to the quota/transient/model-config classifiers, so assistant/thinking/tool-output text matching `cursorQuotaPatterns` false-trips healthy runs as `quota`.

## Decisions

- Cursor classified text = stderr plus scoped stdout per the bullets below; never assistant/thinking/tool-output frames — rules out keeping combined stdout.
- Terminal stream-json `result` frame: scan only the string `result` property for patterns (same field `parseCursorJsonOutput` reads) — rules out scanning other frame keys or the raw NDJSON line without extracting `result`.
- Terminal `result` with `subtype: success` and `is_error: false` contributes no scoped stdout text (do not scan its `result` string); stderr patterns still classify — rules out success `result` suppressing all quota.
- No terminal `result` frame: scoped stdout is every stdout line that is not parseable JSON; parseable non-`result` JSON lines are omitted — rules out stderr-only (would lose plain-text quota/crash output).
- Non-ok settled `stderr` carries `${errBuf}${classifiedStdoutText}` with no delimiter (same concatenation shape as today's combined stream) — rules out a separate classified field or delimiter between stderr and stdout text.
- When scoped stdout is a strict subset of `outBuf`, retain full `outBuf` on observability-only `diagnostics` for `quota`/`model_config`/`error` settles (mirror opencode `retainedDiagnosticsSpread`); excluded stdout is never reclassified — rules out dropping excluded stream-json from operator-visible failure payloads.
- `cursorQuotaPatterns` unchanged.

## Tasks

- [ ] Narrow cursor branch of `classifierDiagnostics` and extend `retainedDiagnosticsSpread` for cursor per Decisions.
- [ ] Update the comment above `classifierDiagnostics` so it no longer claims every non-opencode adapter keeps the combined stream.
- [ ] Add/rewrite tests in `shared/invocation/agents.test.ts`.
- [ ] Update docs.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` drives cursor stream-json stdout whose assistant text contains each `cursorQuotaPatterns` phrase plus a terminal success `result` at exit 0; settlement is not `quota` (fails against pre-fix combined-stream classification).
- [ ] The same test file proves stdout with a non-`result` stream-json frame containing a quota phrase and no terminal `result` frame at exit 0 settles `ok`, not `quota` (fails against pre-fix combined-stream classification).
- [ ] The same test file proves genuine cursor quota via stderr, via a non-success/error `result` whose string `result` property carries the quota message, and via plain non-JSON stdout when no `result` frame was emitted, each settles `quota`.
- [ ] The same test file proves terminal success `result` plus stderr matching `cursorQuotaPatterns` settles `quota`.
- [ ] The same test file proves at non-zero exit an error `result` with `is_error: true` and a non-quota message in the string `result` property settles `error`, not `quota`.
- [ ] The same test file proves at non-zero exit model-config and transient markers on stderr, and on a scanned error `result` string `result` property, classify as `model_config` and transient respectively.
- [ ] `cursor binding classifies quota (ASCII and U+2019), model config, and generic errors` in `shared/invocation/agents.test.ts` stays green unchanged.
- [ ] `cursor binding classifies zero-exit quota patterns` is rewritten so the quota case uses stderr or an error `result` frame instead of plain stdout; its zero-exit success path stays green.
- [ ] `cursor binding classifies quota phrases in stream-json frames` is rewritten (not deleted) to use a fixture with a terminal success `result` frame and a non-`result` frame carrying the quota phrase only; settlement is not `quota`.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/quota-signals.md` — cursor classifies from stderr, terminal `result` event (`result` string when scanned), and plain non-JSON stdout when no `result`; replace the false-`quota` at ~24s note with this rule.
- `v2/docs/operator-runbook.md` — § Choosing an actuator: replace the cursor false-`quota` at ~24s bullet with a pointer to the quota-signals cursor section.
- `v2/docs/shared-invocation.md` — align the resolved-cursor-binding classifier paragraph with the narrowed diagnostics (mirror opencode scoping and `diagnostics` retention language).
- `v2/docs/v1-behaviors.md` — record cursor classifier diagnostics scoped like opencode plus terminal `result` `result` string and plain-stdout fallback, with full stdout on `diagnostics` when stream-json is excluded from classification.
