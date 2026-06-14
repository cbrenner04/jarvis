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

## Refine skip

No net-new load-bearing decision to pin. The architecture already fixes the
steering semantics (pause graceful at boundary / resume branches on stop-cause /
kill immediate via process-group SIGTERM→SIGKILL), the daemon-owns-orchestration-
not-work split, and keeps rich logs/events out of the orchestration store — so
"where structured logs live" is already decided in the doc the spec references.
The remaining forks (IPC transport/framing, a distinct pause-vs-killed
disposition field, in-daemon vs child-process model, log schema, autostart) are
the intent's listed open questions; each belongs to its first caller in draft,
and answering now would invent precision the repo's deferral rule forbids.

