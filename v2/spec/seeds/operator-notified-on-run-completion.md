# Operators poll for run completion because Jarvis never pushes it

Every operator session hand-rolls shell around Jarvis to find out when a
backgrounded run finished. That polling scaffolding is the tell: the harness never
*pushes* "this run is done", so every operator invents a loop to *pull* it.

## Problem

To drive work in parallel an operator must background each invocation — and then has
nothing to be notified by. What gets written instead, over and over:

```sh
until grep -qE "exit reason" run.log; do sleep 30; done      # is it done yet?
tail -f run.log | grep ...                                    # did it fail?
watch 'git -C .worktree/<spec> log --oneline'                 # is it progressing?
```

None of this is a Jarvis command. It is bespoke, per-session, and wrong in different
ways each time (one session: a completion grep that also matched "error" in seed
prose, producing false failure alerts).

Waiting on a run is the single most common thing an operator does, and the reach-me
half of it — get pinged when I'm *not* watching the terminal — is the part Jarvis
provides nothing for.

## Not a new bus — a notifier on the substrate that exists

v2 already has ~80% of this. Do **not** build a pub/sub bus, an HTTP/SSE/websocket
server, or an in-process `EventEmitter`. What already exists to reuse:

- `v2/src/persistence/log-stream.ts` — append-only JSONL event log, `seq`-ordered
  typed `LogEvent`s (`loop_finished`, `run_execution_failed`, …); `LogReader.follow()`
  replays from seq 1 then yields new appends. This is the subscribe primitive.
- `run wait <run-id>` + the daemon's `wait` handler — already the terminal-state model
  and a genuine blocking long-poll, but scoped to one known run-id.
- SQLite durable `RunStatus` + the workflow rollup — the authoritative terminal state.

The gap between this and "operators get pinged" is two small pieces, both in the
daemon:

1. **Subscribe-to-all, not per-run-id.** `follow()` needs a run-id up front. Add a
   daemon `subscribe`/watch that emits terminal transitions across *all* runs, over
   the existing `stream-open`/`stream-data` frames.
2. **A daemon-owned sink.** A live client dies when the terminal closes — that is
   "listen", not "get notified". The daemon must own the push: a config-registered
   webhook URL or shell command (`terminal-notifier`, Slack POST, or the
   agent-operator re-invoke) fired on a terminal transition. Fire-and-forget is the
   whole point.

## Precondition — the events must be honest first

**Gate this behind P0 gate-trust** (`v2-run-reports-completed-over-a-red-gate`,
`failed-ready-flip-strands-the-run`). A notification that fires `completed` over a
genuinely red gate is *worse* than polling: it lies to an operator who has stopped
watching. Wiring push before the terminal events are trustworthy just automates the
misinformation.

## Scope

- A first-class push notification when a backgrounded invocation reaches a terminal
  state, without the operator writing a loop. It replaces polling, not adds to it.
- Cover the states an operator acts on — not just success: completed, gate-red,
  blocked, quota-exhausted, iteration-timeout, agent-cascade-exhausted. A notifier
  silent on failure is worse than none: silence reads as "still running".
- Work for a **backgrounded** invocation — parallel operation is the normal case.
- Reach an operator not watching the terminal: the human case (OS notification /
  terminal bell) and the agent-operator case (harness re-invoke on completion) are
  the same need served by the same daemon sink.
- **Return `run workflow` to fire-and-forget.** #1558
  (`run-workflow-exit-status-tracks-run-outcome`) made the CLI `start` then block on
  `waitForRunCompletion` so exit status tracks the run. Once the daemon push carries
  the outcome, that foreground block is the polling this seed removes — just spelled
  as a blocking wait instead of a `tail -f`. `run workflow` should print the run-id
  and return; the push (not a held-open CLI) delivers the terminal state.

## Decisions

- **Push on the existing substrate, don't build a bus.** Reuse `log-stream.follow()`,
  the daemon `stream-*` frames, and `run wait`'s terminal model. No HTTP/SSE/websocket
  server (the v1 `127.0.0.1:4310` log server is not the model), no `EventEmitter`.
- **The sink lives in the daemon, not a CLI client.** Only the daemon survives a
  closed terminal, so only the daemon can fire-and-forget. Config-register the sink
  (webhook or command) rather than requiring a live listener.
- **Durability is free — keep it.** The JSONL log replays from seq 1, so a
  reconnecting or late sink misses nothing; concurrent readers are fine (append-only
  JSONL + SQLite).
- Fold into config / the existing invocation surface rather than adding a new
  subcommand where possible — "fewer manual steps" is not "more commands".
- Do not solve this by telling operators to run in the foreground — and note that
  #1558's blocking `run workflow` *is* running in the foreground. Revert it: the
  outcome-tracking it exists for moves to the push. Keep `run wait <run-id>` as the
  opt-in blocking path for anyone who still wants an exit code to gate on.
- Terminal-state coverage is the acceptance bar, not happy-path completion.

## Out of scope

- `run wait` itself (already exists) — reuse its terminal-state model, don't reinvent.
- Live progress streaming. This is the terminal boundary, not a TUI.
- Any v1 implementation. v2 owns the substrate; v1 is being replaced.

## Documentation updates

- `v1/docs/operator-runbook.md` — replace the hand-rolled
  [Background-run-and-poll pattern](../../v1/docs/operator-runbook.md#background-run-and-poll-pattern)
  section, which currently *teaches* operators to write `tail -f` / `pgrep` /
  `runs.jsonl` polling, with the supported path. That section existing at all is the
  clearest evidence of this gap.
