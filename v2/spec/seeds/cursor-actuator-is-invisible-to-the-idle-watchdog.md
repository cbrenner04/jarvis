# Cursor's actuator is invisible to the idle-output watchdog and stalls at 90s

## Problem

Cursor is spawned with `--output-format text` (`shared/invocation/agents.ts:98-99`). In `text` mode
`cursor agent -p` emits nothing to stdout until its final response, so any role that works by editing
files — the review **actuator** — produces zero output for the whole edit phase. The idle-output
watchdog (default 90_000 ms, `review-role-invocation.ts`) measures stdout/stderr age, sees silence,
and settles `invocation_failure` / `failureKind: "stall"` → `role_stalled`. Because `role_stalled`
is non-retryable and discards the committed write step
([[role-stalled-discards-a-committed-write-step]]), a whole implement run is thrown away.

This is the exact structural blindness the operator runbook already records for claude before
`claude-streams-output-to-watchdog`: 33/33 claude patch records carried `last_output_age_ms: null`
because claude buffered output. The fix there was to spawn claude with
`--output-format stream-json --verbose` so the watchdog observes it mid-invocation. **Cursor never
got that fix** — it is still on `text`.

Observed 2026-07-24 on `state-store-wal-concurrent-writes`, telemetry (`~/.jarvis/telemetry.jsonl`):

```text
adversary    cursor  dur=88143  ok       ← debate roles emit a verdict → visible
advocate     cursor  dur=50456  ok
adjudicator  cursor  dur=21445  ok
actuator     cursor  dur=90003  stall    ← edits files silently → invisible → killed at the 90s bound
```

Every stall is the actuator, and every one lands at exactly **90003 ms** = the idle budget, not a
natural stop. The debate roles (adversary/advocate/adjudicator) stream a verdict to stdout and
complete fine on the same agent; only the silently-editing actuator trips. **Proof the actuator was
working, not hung:** both times its completed edits were on disk in the worktree when recovered — the
watchdog fired mid-edit. It hit twice on cursor, and a plain re-dispatch stalled again, so
re-dispatch is not the recovery.

Cursor's CLI supports the same streaming claude uses:

```console
$ cursor agent --help
  --output-format <format>   text | json | stream-json (default: "text")
  --stream-partial-output    Stream partial output as individual text deltas
                             (only works with --print and stream-json format)
```

## Decisions

- Spawn cursor with `--output-format stream-json` (and `--stream-partial-output`) so the watchdog
  observes tool-call and edit activity mid-invocation, the same reason claude uses
  `stream-json --verbose`. Rules out raising the idle budget — that only lengthens every real stall
  and still can't distinguish silent-working from hung.
- The run loop already consumes claude's `stream-json`; cursor's `stream-json` envelope differs, so
  the output reader must parse cursor's shape (or normalise both) rather than assume one format.
  Rules out flipping the flag without teaching the reader cursor's frames.
- A quiet cursor actuator that is *making progress* (emitting stream frames) must reset the idle
  clock and complete; only a genuinely output-silent invocation should stall. Pin this directly —
  the whole point is that the watchdog now sees the progress it was blind to.
- Out of scope: whether `role_stalled` should discard committed work at all — that is
  [[role-stalled-discards-a-committed-write-step]]. This seed removes the *cause* of the spurious
  stalls; that seed makes a real stall recoverable. Both are wanted.
- Out of scope: codex output visibility — codex is out for this operator and unverified here.

## Acceptance criteria

- [ ] Cursor is spawned with a streaming output format; a test asserts the argv contains
      `--output-format stream-json` (not `text`) and fails against the current code.
- [ ] A cursor invocation that emits stream frames on a cadence shorter than the idle budget, while
      producing no *final* text until the end, does **not** stall — the frames reset the idle clock.
      Inverting the frame handling (ignoring stream output for idle purposes) fails this test.
- [ ] The output reader parses cursor's `stream-json` envelope and still surfaces the final result
      text and any error/quota signal the `text` path surfaced; existing cursor quota-classification
      tests stay green.
- [ ] A genuinely output-silent cursor invocation past the idle budget still settles `stall` — the
      negative case proves the watchdog wasn't simply disabled.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Choosing an actuator — cursor now streams to the watchdog like
  claude; remove any implication that cursor actuator stalls are unavoidable.
- `v2/docs/v1-behaviors.md` — cursor invocation output format (parity with claude's streaming spawn).

## Prerequisites

- The idle-output watchdog settles `failureKind: "stall"` on an output-silent invocation (#1998).
- Claude already streams to the watchdog via `--output-format stream-json --verbose`
  (`claude-streams-output-to-watchdog`) — this is the cursor analogue.
