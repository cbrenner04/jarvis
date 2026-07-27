# 00 - Snapshot by default, tail behind `--follow`

## Problem

`streamRunLogRecords` (`v2/src/daemon/daemon.ts`) replays every persisted record via `onData`
before checking `run.status`, so a live run's existing records do reach the client. The defect is
what happens next: for any `in-progress` run it unconditionally enters
`deps.logReader.follow(runId, signal)`, whose `FileLogStream.follow` (`v2/src/persistence/log-stream.ts`)
polls forever until `signal.aborted`. `createTailStreamHandler` only calls `onClose()` (which sends
`stream-end`) after that loop returns, so the daemon never closes the stream for a live run.
`runLogSubcommand` (`v2/src/commands/run.ts`) prints each `stream-data` frame as it arrives but then
blocks in its `while (true)` frame loop waiting for a `stream-end` that never comes — an unbounded
follow with no dump-and-exit, while `jarvis run list` on the same daemon answers in under a second.
`jarvis tui log` needs the tail and must keep it.

## Decisions

- `stream-open` payload gains `follow?: boolean`, defaulting to `false`; the daemon closes the
  stream after replay when it is absent or false — rules out a second RPC method or stream kind for
  snapshots.
- `jarvis tui log`'s tail client sends `follow: true` — rules out defaulting the field to `true` for
  compatibility, which would leave `run log` broken by default.
- `run log <id>` sends no follow flag; `run log <id> --follow` sends `follow: true` — rules out a
  separate `run tail` subcommand.
- `--follow` may appear anywhere in the `log` argv alongside the run id (before or after it); any
  other extra token, or `--follow` on a non-`log` subcommand, is a usage error. No `-f` alias.
- Snapshot completion is the daemon closing the stream, not a client-side deadline — rules out a
  client timeout that truncates output on a slow replay.
- Defaulting `follow` to `false` means a new CLI talking to an older, pre-flag daemon still gets
  followed (the daemon ignores the unknown field and keeps its unconditional follow loop). Accepted
  as transient: daemons are keyed per executable digest, this is a single-operator install, and a
  superseded daemon only owns runs that are already settling out from under it.
- This subspec does not make `--follow` exit when the run settles — that requires the daemon to
  re-read run status mid-follow, which does not exist yet and is scoped separately in
  [01](./01-run-log-follow-settlement.md). Here, `--follow` keeps today's behavior (tails until the
  daemon closes the stream or the client disconnects), just reachable explicitly instead of forced
  on every live run.

## Task checklist

- [ ] Thread `follow` through `parseTailStreamParams` / `streamRunLogRecords`; skip the
      `logReader.follow` loop unless requested.
- [ ] Parse `--follow` in `runRunCommand`'s `log` branch (either position relative to the id; reject
      any other extra token) and pass it into the `stream-open` payload; add `[--follow]` to
      `RUN_USAGE`.
- [ ] Send `follow: true` from `v2/src/tui/tui-log-tail-client.ts`.
- [ ] Update the four docs below.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` regression test `streamRunLogRecords closes after
      replay for a non-follow in-progress run` drives `streamRunLogRecords` with a fake `LogReader`
      whose `tail()` returns pre-written records for an `in-progress` run and whose `follow()` never
      yields or resolves, and asserts (via a bounded `Promise.race` against a short timer) that all
      records reach `onData` and the call returns without invoking `follow()`; run against the
      pre-fix code (which has no `follow` param and unconditionally calls `follow()`), it times out
      instead of returning.
- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` covers `parseTailStreamParams`' new field: absent,
      `false`, `true`, non-boolean, and string-JSON payload cases, plus the composed guard — a
      terminal run closes immediately regardless of `follow`, an `in-progress` run with
      `follow: true` still enters the follow loop.
- [ ] `v2/src/commands/run.test.ts` test `run log sends no follow flag by default` and `run log
      --follow sends follow: true` assert the `stream-open` payload sent for each invocation; both
      fail against the pre-fix CLI, which never sends a `follow` field.
- [ ] Terminal-run `run log` output and exit status are unchanged: existing `run.test.ts` log tests
      stay green.
- [ ] `jarvis tui log` still replays then tails a live run: `v2/src/tui/tui-log-tail-client.test.ts`
      stays green, with its `stream-open` payload assertions updated to carry `follow: true`.

## Documentation updates

- `v2/docs/operator-runbook.md` — add `run log` snapshot vs `--follow` to the command table; correct
  (not delete) the "`run log` blocks on a live run" bullet: keep its `run list`/`run log` timing
  measurements, replace the hang claim with the fixed default-snapshot behavior, and note `--follow`
  still blocks until the daemon closes the stream (settlement lands in
  [01](./01-run-log-follow-settlement.md)).
- `v2/docs/daemon-host.md` — document the `stream-open` payload's `follow` field (default `false`)
  and that snapshot mode's stream completion is the daemon closing after replay, independent of
  `--follow`'s continued-tail completion.
- `v2/docs/write-behavior.md` — correct the `run log` table row (currently "replay first, then follow
  new records until stream end or client close") to describe the two modes: default snapshot exits
  after replay; `--follow` replays then tails. Add `[--follow]` to the CLI help text.
- `v2/docs/v1-behaviors.md` — record the v2 behavior change: `run log` defaults to snapshot instead
  of always following.
