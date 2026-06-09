# Jarvis v2 — Build order

The detailed expansion of rollout step 5 in [`v2-vision.md`](v2-vision.md)
("build v2 incrementally, behavior-by-behavior"). The *why* lives in the vision
doc; the *how* (the architecture this order builds toward) lives in
[`v2-architecture.md`](v2-architecture.md). This doc is only sequencing.

## Ordering principle

**Walking-skeleton-first.** Build the thinnest end-to-end run that does real work
first, then grow each layer — durable state, the daemon host, project config —
only behind a concrete consumer that needs it. A layer built ahead of its
consumer has nothing to constrain its shape and inflates on invented precision;
deferring to the first consumer is the vision's rule applied to sequencing
itself.

The honest-from-day-one boundary is the **library**, not the daemon. The
execution core is a host-agnostic function (cancel via `AbortSignal`, no global
process-signal ownership). A thin CLI host drives it first; the daemon is a
*second host* over the same core, added when detached/concurrent runs are a real
need — additive, not a retrofit. This reverses the earlier daemon-shell-first
trade: first-working-step lands early, and the speculative state/recovery design
that has no caller is never written.

Each phase is a small number of subspec-sized chunks (≈ one PR each, capped per
the vision's PR ceiling). Specs are small on purpose — they exist for human
review, and small is what a human can actually hold in their head. Phases are
ordered so each one runs and is testable before the next begins.

The TUI is the highest-uncertainty track: seeded as soon as there is a real run
to observe (once the daemon host exists) and dogfooded through every phase after,
because we want it churning in the open while there is slack to absorb the
rework.

## Phases

### Phase 0 — v2 project scaffold

Stand up `v2/` as its own tsconfig project with `v2/tsconfig.json`, a minimal
CLI entry at `v2/src/cli.ts`, and a co-located test shape under `v2/src/*.test.ts`.
Wire the root `bin/jarvis` shim to the v2 CLI while keeping `jarvis1` on v1.
At the repo boundary, root verification must include v2 via `bun run typecheck`
covering both `v1/tsconfig.json` and `v2/tsconfig.json`, plus Biome import-boundary
overrides that ban `v1/** -> v2/**` and `v2/** -> v1/**` cross-tree imports.
No behavior beyond `--version` and "not ready". Retires: build/tooling wiring risk.

### Phase 1 — First write step, end-to-end (first working step)

One `write` step, run *once*, driven from the v2 CLI — no daemon: render via the
shared prompt registry → invoke one agent and a model passed directly (the
`--agent`/`--model` override; the category store is Phase 5) → capture the
outcome token → deterministically check the output contract → write into a
worktree under `~/.jarvis/worktrees`. No loop, no workflow, and no durable state
— the worktree plus git is the only persistence a single run needs. Includes
worktree creation, `.jarvis.lock` coexistence, and quota fallback in the
agent-invocation layer. Built as a host-agnostic core function (cancel via
`AbortSignal`) behind a thin CLI host — the library/host boundary we keep honest
from day one. Retires: the core execution path end-to-end, and the library
boundary.

### Phase 2 — The write loop (behavior #1)

Wrap the single step in the write-behavior loop: repeat until the artifact exists
/ acceptance criteria move / a blocker is declared, with max loop counts and an
explicit early-stop outcome. This is the first consumer that must *resume*, so
durable state earns its first rows here — only the columns resume reads, no more
(SQLite under `~/.jarvis/state/`). Prove kill-resume over a dirty worktree
(Ctrl-C/crash → re-run resumes from the last step boundary, v1's one-shot resume
model). Retires: loop + minimal durable state + boundary recovery, on a real
behavior. *TUI: not yet — runs are still foreground.*

### Phase 3 — Daemon host + IPC + structured logging

Introduce the long-running host as a second driver over the existing core, now
that there is a real looping run worth detaching from the terminal: start/stop, a
programmatic IPC/API surface (start a run, list runs, tail log, pause/resume/kill
at the next boundary), and the structured, queryable logging stream consumed by
everything after. The core library is unchanged — the daemon wires its own
cancellation into the same `AbortSignal`. A minimal `jarvis` CLI control surface
(start/stop/status/log-tail) talks to the daemon. Retires: the lifecycle/embedding
boundary and the multi-window problem.

### Phase 4 — TUI seed (start dogfooding)

The first interactive client over the daemon API: launch a run, watch its live
state and structured log stream, see the outcome. Seeded here — the first point
there is a detached run to observe — so we dogfood the TUI through every phase
that follows. Deliberately thin and under-specified ahead of need; this is the
highest-uncertainty track and *will* be reworked as we learn. Retires: the
operator surface, early — when rework is still cheap.

### Phase 5 — Workflow runner + project config binding

Linear-with-bounded-loops array of steps. Durable state grows step IDs and
cross-step attempt history here, behind the runner that reads them. The project
config layer lands here: the **per-machine agent fallback order** and the
**machine-independent category→agent→model store** (steps name a category; the
runner resolves `(agent, category) → model`, one model per pair, missing = hard
error at load). Defines workflow presets; includes the workflow-authoring helper
and the config-vs-source validation check. Run a two-step write→write workflow.
Retires: the source-vs-config seam (steps name categories in source; the agent
order and category→model store are data). *TUI: workflow/step view of a run.*

### Phase 6 — Remaining behaviors: review-and-update, human

The review-and-update loop — structured as the debate (read-only adversary →
defender → judge → verdict, then a separate executor applies it; reviewers are
reviewing-class, the executor executing-class) — and the human loop (pause
graceful / resume / kill immediate), made less clunky than v1 using the daemon
steering API from Phase 3. Human-loop and blocked converge on "paused awaiting a
human." Retires: the full behavior vocabulary. *TUI: approve / revise / resume /
kill controls — the human loop's home.*

### Phase 7 — Concurrency + admission

Adaptive memory-watermark admission, `queued` status, multiple concurrent runs,
admission-only (no preemption). Local model (qwen via aider) as the terminal
entry in agent order, personal machine only. Retires: the memory-efficiency
constraint. *TUI: multi-run dashboard + queue view.*

### Phase 8 — PR lifecycle + attribution (runner-owned)

Worktree → branch → draft PR → ready, with the per-commit `Jarvis-Agent`
attribution footer. Port v1's PR mechanics onto the v2 runner. Retires: the
output side of a run. *TUI: PR status per run.*

## Cross-cutting (not phases)

- **Durable state**: first rows in Phase 2 (loop resume), grown behind each
  consumer (cross-step history in Phase 5). Never built ahead of a caller.
- **Structured logging**: lands in Phase 3, consumed throughout.
- **TUI**: seeded at Phase 4, extended by each later phase (the *TUI:* notes
  above). Highest-uncertainty track; specced just-in-time, expected to churn.
- **Quota fallback**: agent order folds into Phase 1's invocation layer (a single
  agent+model passed directly); the configurable agent fallback order and the
  category→agent→model store are Phase 5, where category resolution composes over
  the same fallback (agents are the outer loop).
- **Evals**: deferred — on-demand only, no architectural impact yet.
- **Specless one-shot** (v1's `jarvis prompt`): the minimal preset — the Phase 1
  write step with no spec, exposed as a user command. Reaches v1 parity once the
  PR lifecycle (Phase 8) gives it commit + draft PR; needs no workflow runner.

## Parity & coexistence

Each phase leaves `jarvis` more capable but never required; `jarvis1` remains the
daily driver until v2 reaches parity (vision step 5). No v1 deletion.
