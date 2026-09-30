---
name: cursor-quota-classified-from-stream-json-content
---

# Cursor runs are classified `quota` from model prose in the stream-json stdout

## Problem

Quota classification tests every adapter except opencode against the combined stdout+stderr text (`shared/invocation/agents.ts`, `quotaPatternsFor` / `isQuotaSignal`, ~:1415-1443). Cursor is spawned with `--output-format stream-json --stream-partial-output`, so its stdout carries the model's own text deltas, thinking, and tool output. Any of that containing a quota phrase (`quota exceeded`, `rate limit`, a `429` near `error`, …) settles a healthy run `quota` and escalates the role to the next rung. opencode was fixed for exactly this shape (restricted to stderr, same file); cursor was not.

Evidence (2026-09-29, 22:38–00:18Z): 6 of 52 cursor invocations settled `exit_kind: quota` after 18 s–14 min, several with cursor's own terminal `{"type":"result","subtype":"success","is_error":false}` in the captured output (runs `93ff7932`, `8a8be074`, `d4a9c045` ×3, `ed5d45e7`). Each escalated to paid rungs; lane `shard-session-logs-by-month` ran all three debate roles on `claude-opus-5-5` (~$1.70) after cursor "quota". Earlier sightings: runbook § Choosing an actuator (24 s false-`quota` cluster, 2026-07-26).

## Decisions

- Cursor quota classification reads stderr plus cursor's terminal `result` event (its `is_error`/error payload), never assistant/thinking/tool-output frames. Rules out regex over model prose.
- A cursor run whose terminal `result` is `subtype: success`, `is_error: false` is never `quota`, whatever else the stream contains.
- Keep cursor's existing quota patterns for the channels it still reads; no pattern changes.

## Acceptance criteria

- [ ] A test feeds cursor stream-json stdout whose assistant text contains each cursor quota pattern plus a terminal success `result` and exit 0; classification is not `quota`. Fails against the current combined-stream classifier.
- [ ] A test with a genuine cursor quota signal (stderr, or an error `result` event carrying the quota message) still classifies `quota`.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/quota-signals.md` — cursor classifies from stderr and the terminal result event only.
- `v2/docs/operator-runbook.md` — replace the "cursor false `quota` at ~24s" note in § Choosing an actuator with a pointer to this fix.
