---
name: cursor-streams-output-to-watchdog
---

# Cursor streams output to the idle-output watchdog

## Problem

Cursor is spawned with `--output-format text` (`shared/invocation/agents.ts`). In `text` mode
`cursor agent -p` emits nothing until its final response, so a silently-editing role (the review
actuator) produces zero stdout for the whole edit phase. The idle-output watchdog sees silence and
settles `invocation_failure` / `failureKind: "stall"` → `role_stalled`, which is non-retryable and
discards the committed write step, throwing away the run.

Observed 2026-07-24 on `state-store-wal-concurrent-writes` (`~/.jarvis/telemetry.jsonl`): the debate
roles (adversary/advocate/adjudicator) stream a verdict and complete fine on cursor; only the
actuator stalls, at exactly `dur=90003` — the idle budget, not a natural stop. Its completed edits
were on disk both times, so the watchdog fired mid-edit. A plain re-dispatch stalled again.

This is the same structural blindness fixed for claude by spawning it with
`--output-format stream-json --verbose`. Cursor never got that fix. **Confirmed 2026-07-24 against
the installed binary** — `cursor agent --help` lists `--output-format text | json | stream-json` and
`--stream-partial-output` (deltas, requires `--print` + `stream-json`).

## Decisions

- Spawn cursor with `--output-format stream-json` (plus `--stream-partial-output`) so the watchdog
  observes edit activity mid-invocation. Rules out raising the idle budget, which only lengthens
  every real stall and still cannot distinguish silent-working from hung.
- Teach the output reader cursor's `stream-json` envelope shape rather than reusing claude's parser
  as-is. Rules out flipping the flag alone, which would leave final text and quota signals unparsed.
- Ships as one change: the flag and the reader are mutually dependent — the flag without the reader
  regresses result text and quota classification.
- A quiet-but-progressing cursor invocation (emitting stream frames) resets the idle clock and
  completes; only genuinely output-silent invocations stall.
- Out of scope: whether `role_stalled` should discard committed work — separate seed.
- Out of scope: codex output visibility — codex is out for this operator and unverified here.

## Acceptance criteria

- [ ] Cursor argv contains `--output-format stream-json` (not `text`); a test asserts it and fails
      against current code.
- [ ] A cursor invocation emitting stream frames faster than the idle budget, with no final text
      until the end, does not stall. Ignoring stream frames for idle purposes fails this test.
- [ ] The reader parses cursor's `stream-json` envelope and still surfaces the final result text and
      any error/quota signal the `text` path surfaced; existing cursor quota-classification tests
      stay green.
- [ ] An output-silent cursor invocation past the idle budget still settles `stall`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § choosing an actuator — cursor now streams to the watchdog like
  claude; drop any implication that cursor actuator stalls are unavoidable.
- `v2/docs/v1-behaviors.md` — cursor invocation output format (parity with claude's streaming spawn).

## Prerequisites

- The installed `cursor agent` CLI accepts `--output-format stream-json` and `--stream-partial-output`
  — **confirmed** against the binary's `--help` on 2026-07-24 (see Problem).
- The idle-output watchdog settles `failureKind: "stall"` on an output-silent invocation.
- Claude is spawned with `--output-format stream-json --verbose` so the watchdog observes it mid-invocation.
