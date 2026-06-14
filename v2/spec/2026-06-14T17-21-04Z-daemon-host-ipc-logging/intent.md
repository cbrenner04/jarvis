---
name: daemon-host-ipc-logging
---

# Next phase of v2 — Phase 3: Daemon host + IPC + structured logging

Phases 0–2 are done (`v2/spec/v2-meta-index.md`): the write loop runs end-to-end,
host-agnostic behind a thin CLI host, with durable SQLite state and kill-resume.
The next phase per `v2/docs/v2-build-order.md` is **Phase 3 — Daemon host + IPC +
structured logging**: stand up the long-running second host over the *same* core,
now that there is a real looping run worth detaching from the terminal.

## What this phase ships

A persistent `jarvis` daemon that owns run lifecycle and exposes a programmatic
API; a thin CLI control surface that talks to it over IPC; and a structured,
queryable log stream that later phases consume. The core library
(`executeWriteLoop` and below) is **unchanged** — the daemon is a second driver
over it, wiring its own cancellation into the existing `AbortSignal`, not a
retrofit of the core.

Concretely:

- **Daemon process & lifecycle.** Start/stop a long-lived host. Single instance
  per machine, hermetic (no external service — SQLite under `~/.jarvis/state/`).
  Owns in-memory worktree ownership for its own runs (the architecture's
  single-daemon locking); the on-disk `.jarvis.lock` still guards cross-process
  coexistence with `jarvis1`/editor/manual git.
- **IPC / API surface.** A local transport (e.g. unix-domain socket under
  `~/.jarvis/`) carrying request/response + a streaming channel. Operations:
  - `start` a run (launch a write run detached, returns run ID)
  - `list` runs (status snapshot from the state store)
  - `tail` a run's log (live structured stream)
  - `pause` / `resume` / `kill` — the steering vocabulary, scoped to exactly these
    three (`v2-architecture.md` → Steering).
- **Steering semantics** (port the architecture's decisions):
  - **pause** is graceful — takes effect at the next loop/step boundary, no work
    lost (the loop already checks `signal.aborted` at the top of each iteration).
  - **resume** branches on how the step stopped: paused-at-boundary → continue
    next; killed/crashed mid-step → re-run the interrupted step over the dirty
    worktree (the existing crash-recovery path).
  - **kill** is immediate — SIGTERM→SIGKILL the agent process group; leaves a
    dirty worktree, run marked killed.
- **Structured logging.** A queryable, per-run structured log stream (records,
  not free-form text) the daemon emits and `tail` consumes — the substrate every
  later phase (TUI, workflow view) reads. First cut can be thin; the contract that
  matters is "structured records keyed to a run, streamable live and replayable."
- **CLI control surface.** A minimal `jarvis` command set —
  `start`/`stop`/`status`/`log-tail` (names TBD) — as a thin client over the IPC
  API. Replaces today's in-process `jarvis write` as the detached path; the
  one-shot foreground `write` can stay or route through the daemon (decide during
  draft).

## Boundaries / non-goals

- **No TUI** — that's Phase 4, seeded once this detached run exists to observe.
- **No workflow runner, no project config / category store** — Phase 5. This
  phase still drives the single write behavior.
- **No new steering verbs** beyond pause/resume/kill (no mid-run spec edit, no
  message injection, no reorder — explicitly deferred in the architecture).
- **Core library stays put.** If the daemon needs the loop to expose more (a
  pause callback, log hooks), that's an additive seam on the core, not a rewrite —
  keep the change minimal and justified.

## Open questions to settle in draft

- IPC transport + framing (unix socket + line-delimited JSON vs. a small RPC
  shape) and how the streaming log channel multiplexes with request/response.
- How `pause` reaches a running loop: today only an `AbortSignal` exists and abort
  returns a resumable `progress`. Does pause reuse abort-at-boundary, or does the
  loop need a distinct "pause" disposition vs. "killed"? The state store records
  which (architecture: "one field on the run records which").
- Daemon ↔ run process model: in-process async runs vs. child processes. Kill
  semantics (process-group SIGTERM→SIGKILL) point toward child processes for agent
  invocation; the loop orchestration can stay in-daemon.
- Structured-log schema: minimum field set for Phase 3, grown behind consumers
  (don't over-design ahead of the TUI).
- Daemon autostart/discovery: does the CLI spawn the daemon on demand, or require
  an explicit `jarvis daemon start`?

## Documentation & evidence (acceptance lives outside this spec tree)

- Implement under `v2/src/` with co-located tests: daemon host, IPC layer,
  steering, structured log. Tests prove: start→list→tail a run; pause stops at a
  boundary and resume continues; kill leaves a recoverable dirty worktree and
  resume re-runs the interrupted step; logs stream live and replay.
- `bun run typecheck` + `bun test` green; `bun run ready` passes.
- Update `v2/docs/v2-build-order.md` and `v2/spec/v2-meta-index.md` to check off
  Phase 3.
- If any v1 behavior is touched/restated, update `v2/docs/v1-behaviors.md`
  (per repo rule).
- Reflect the daemon/IPC/logging surfaces in `v2/docs/v2-architecture.md` where
  the as-built shape diverges from the design notes.

## Refinement

- `03` must add a boundary-clean pause disposition distinct from interrupted kill/crash; rules out reusing existing `AbortSignal` abort, which already means interrupted recovery and would re-run completed work.
- Daemon stop must refuse while any invocation is active and report active run IDs; rules out silently killing or orphaning running work on lifecycle stop.
- Daemon stop may exit when runs are only paused, blocked, budget-soft-stopped, killed, failed, or done; rules out requiring a daemon process to stay resident for durable non-running states.
- `02` must define `(project, branch)` ownership as held for active, paused, blocked, budget-soft-stopped, and killed runs, then released only on done, failed, or explicit cleanup; rules out starting another daemon run over resumable/dirty work.
- Daemon startup must rebuild ownership guards from durable nonterminal run state; rules out losing paused/killed exclusivity across daemon restart.
- `00`/`02` must separate `jarvis daemon status` (daemon health/socket/process) from `jarvis status` (run snapshots); rules out one command ambiguously mixing host liveness and run state.
- Structured logs use a separate SQLite file under `~/.jarvis/state/` with log-repository bootstrap and forward-only migrations, not `v2.sqlite`/`StateStore`; rules out mixing rich event history into the orchestration store resume reads.
- `01` `log.tail` must allow arbitrary run IDs, replay empty history, and follow later appends; rules out requiring detached run lifecycle before the log substrate can be tested.
- Live tail must drop disconnected subscribers and isolate slow subscribers with bounded per-subscriber buffering or stream close; rules out append latency depending on any one client.
- `01` must prove request/response and streaming frames coexist on one socket by issuing normal requests while a tail stream is open; rules out untested protocol multiplexing.
- CLI autostart must specify executable discovery, readiness timeout, stdio detachment, and structured failure reporting before `start`/`status`/`log-tail` depend on it; rules out hidden shell-specific daemon launch behavior.
- Process-group kill scope is limited to real child-process invocation bindings, with injectable abort behavior still covering tests; rules out redesigning run orchestration into worker processes solely for kill.
- Any invocation binding kill/abort seam change must update `v2/docs/shared-invocation.md` or its actual durable home; rules out changing cancellation contracts only in code/spec prose.
- Each materially invasive subspec (`00` daemon/IPC, `01` logging, `02` detached runs, `03` steering) must require `bun run ready`; rules out reserving full readiness evidence for the final steering slice only.
- v1 docs entries must explicitly say these are additive v2-only surfaces and do not restate or alter v1 kill/resume/lock behavior; rules out accidental v1 parity drift.
- `v2/docs/v2-architecture.md` must be aligned to the as-built second-host model when Phase 3 lands; rules out leaving older daemon-first wording as the durable architecture.
