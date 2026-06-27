---
name: phase-3-daemon-host
---

# Phase 3 of v2 — Daemon host + IPC + structured logging

Stand up the long-running **daemon** as a *second host* over the existing
host-agnostic core, plus the **structured logging** stream and a thin **`jarvis`
CLI control surface** that talks to the daemon. This is the first detached host;
the CLI `write` host (`v2/src/cli.ts`) stays as the in-process driver.

Source of truth: Phase 3 line in `v2/spec/v2-meta-index.md` and the Phase 3
section of `v2/docs/v2-build-order.md`; semantics in `v2/docs/v2-architecture.md`
(Interface, Steering semantics, Runs/state, Persistence, Recovery,
Git/worktrees/PRs locking). Done condition is merged code in `v2/src`, not this
seed.

## What exists today

- `executeWriteLoop` (`v2/src/write-loop.ts`) is the host-agnostic core: a
  resumable loop driven only by inputs + an `AbortSignal`, no process-signal
  ownership, no terminal assumptions. It already persists run/attempt rows via
  the state store and resumes by `(project, branch)`.
- `main()` (`v2/src/cli.ts`) is the *first* host: parses `jarvis write …`,
  calls `executeWriteLoop` in-process, prints the result, exits. Foreground only.
- State store (`v2/src/state-store.ts`) owns orchestration rows (runs, attempts,
  outcomes) keyed by durable IDs. The daemon reuses it as-is — it owns
  *orchestration* state, never the *work* (git worktree/branch).
- Real agent bindings still aren't wired; exercise the daemon through injected
  test bindings (`v2/src/testing/bindings.ts`), same as Phases 1–2.

## Scope

A second host over the **unchanged** core. The daemon wires *its own*
cancellation into the same `AbortSignal` the loop already honors — the core does
not learn about the daemon.

1. **Structured logging stream.** A structured, queryable log-event model (not
   free-text lines) + a sink the run path writes to + a reader that supports
   tail/follow. This is the stream "consumed by everything after," so the event
   shape is the load-bearing interface — design it for query, keyed by run ID.
   The write loop emits its boundary/iteration events into it.

2. **Daemon process + IPC transport.** A long-running process with a lifecycle
   (start / stop / status) and a typed request/response + streaming IPC channel.
   Keep it **hermetic** (no external broker, no network port — a local Unix
   socket under `~/.jarvis` is the natural fit; settle in refine). The daemon is
   the sole orchestrator: it tracks worktree ownership **in-memory**; the on-disk
   `.jarvis.lock` stays only for cross-process coexistence (`jarvis1`, editor).

3. **Programmatic run-control API** over the core, exactly the build-order verbs
   — no more:
   - **start a run** — daemon spawns `executeWriteLoop` with an `AbortSignal` it
     owns; returns the run ID.
   - **list runs** — from durable state + in-memory liveness.
   - **tail log** — stream (2)'s structured events for a run.
   - **pause / resume / kill** — the *only* steering vocabulary (architecture
     "Steering semantics"):
     - **pause = graceful**, at the next iteration boundary — the in-flight
       agent invocation finishes; the loop stops *completed-at-boundary*. This is
       distinct from abort: pause must not interrupt the running step.
     - **kill = immediate** — abort the signal now, SIGTERM→SIGKILL the agent
       process group (v1 abort); leaves a dirty worktree.
     - **resume** branches on how the step stopped: paused/boundary → continue;
       killed/crashed → re-run the interrupted step over the dirty worktree
       (the loop's existing resume path). Record which on the run.
   - Guard: **one active run per (project, branch)** (different specs/worktrees
     run fine; same branch does not).

4. **CLI control surface.** A minimal `jarvis` client over the IPC API: daemon
   `start`/`stop`/`status`, plus `start a run` / `list` / `log`(tail) /
   `pause`/`resume`/`kill`. Thin client — no orchestration logic in the CLI.

## Explicitly out of scope (do not build ahead of a consumer)

- **Concurrency, admission, memory watermark, `queued` status** — Phase 7. The
  daemon runs one run at a time here beyond the per-(project,branch) guard; do
  not add a queue or admission control.
- **TUI** — Phase 4. Build the API the TUI will consume; build no UI.
- **Workflow runner / multi-step / categories** — Phase 5. Still the single
  write loop.
- **PR lifecycle / attribution** — Phase 8.
- **Richer steering** (edit spec mid-run, inject messages, reorder steps),
  human-loop `approve/revise/abort`, blocked→human routing — Phase 6.
- **Local-model fallback ordering** — agent order/categories are Phase 5/7.

## Design posture (be careful here)

The daemon API is the embedding boundary every later surface (TUI, web, NL
router) sits on, but its first real consumer (the TUI) is Phase 4 — so resist
inventing API breadth now. Build exactly the verbs above with clean, typed,
composable contracts; defer anything a current caller doesn't exercise.

## Documentation updates

- `v2/docs/v2-architecture.md` — reconcile any Interface/Steering/logging
  decisions settled during build (the doc currently calls logging "improve
  later"; record the structured-log event shape decided here).
- `v2/spec/v2-meta-index.md` — tick Phase 3 when merged (the operator/harness
  owns this; not the implementing run).
- `v2/docs/v1-behaviors.md` — only if a v1 behavior's v2 successor is defined.

## Prerequisites

- Phase 2 is merged: `executeWriteLoop` + state store + kill/crash resume exist.
- Real agent bindings are *not* a prerequisite (test bindings drive the loop).
