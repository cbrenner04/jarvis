# Jarvis v2 — Build order

The detailed expansion of rollout step 5 in [`v2-vision.md`](v2-vision.md)
("build v2 incrementally, behavior-by-behavior"). The *why* lives in the vision
doc; the *how* (the architecture this order builds toward) lives in
[`v2-architecture.md`](v2-architecture.md). This doc is only sequencing.

## Ordering principle

**Daemon-shell-first.** Build the long-running host, its IPC/API boundary, and
the state store *before* any step does real work. First-working-step lands late
and that is the accepted trade: `jarvis1` stays the daily driver throughout, and
the honest lifecycle boundary from day one avoids retrofitting a process-owning
step runner into a daemon later. Slow and steady, fewer reworks.

Each phase is a small number of subspec-sized chunks (≈ one PR each, capped per
the vision's PR ceiling). Specs are small on purpose — they exist for human
review, and small is what a human can actually hold in their head. Phases are
ordered so each one runs and is testable before the next begins.

The TUI is the one exception to "build the plumbing first": it is seeded as soon
as there is a run to observe (Phase 4) and then dogfooded through every phase
after, because it is the biggest unknown and we want it churning in the open
while there is slack to absorb the rework.

## Phases

### Phase 0 — v2 project scaffold

Stand up `v2/` as its own tsconfig project with `v2/tsconfig.json`, a minimal
CLI entry at `v2/src/cli.ts`, and a co-located test shape under `v2/src/*.test.ts`.
Wire the root `bin/jarvis` shim to the v2 CLI while keeping `jarvis1` on v1.
At the repo boundary, root verification must include v2 via `bun run typecheck`
covering both `v1/tsconfig.json` and `v2/tsconfig.json`, plus Biome import-boundary
overrides that ban `v1/** -> v2/**` and `v2/** -> v1/**` cross-tree imports.
No behavior beyond `--version` and "not ready". Retires: build/tooling wiring risk.

### Phase 1 — State store (SQLite)

The spine everything writes to. Schema for runs, steps, outcomes, and the
orchestration-state-vs-work split; boundary-checkpoint semantics; kill-resume ==
crash-recovery defined here. Pure library, no daemon: library-owned bootstrap
opens `~/.jarvis/state/v2.sqlite` (or explicit caller override) and applies
idempotent forward-only migrations before repository operations exist. Phase 1
correctness does not depend on WAL, singleton-writer daemon ownership, or
daemon lock policy. Recovery is step-boundary only: recovery reads derive
`start-next-boundary` / `replay-last-boundary` / `run-terminal` from
`runs.next_step_id` plus durable attempt/outcome rows, and boundary commit proof
is one transactional effect (attempt terminal + outcome + checkpoint
advancement). Retires: state-model risk in isolation, before anything depends on
it.

### Phase 2 — Daemon shell + IPC + structured logging

The long-running host: start/stop, and a programmatic IPC/API surface exposing
only trivial ops at first (ping, list-runs → empty, shutdown). Structured,
queryable logging stream lands here and is used by everything after. A minimal
`jarvis` CLI control surface (start/stop/status/log-tail) talks to the daemon;
the interactive TUI is seeded later (Phase 4). No step execution yet. Retires:
the lifecycle/embedding boundary — the thing we most want honest up front.

### Phase 3 — Single step execution (first working step)

One `write` step run *once*, inside the daemon: render via the shared prompt
registry → invoke one agent (one cli+model binding) → capture outcome token →
check the deterministic output contract → persist run/step state → write into a
worktree under `~/.jarvis/worktrees`. No loop, no workflow. Includes worktree
creation and `.jarvis.lock` coexistence, plus quota fallback in the
agent-invocation layer. Retires: the core execution path end-to-end.

### Phase 4 — TUI seed (start dogfooding)

A minimal interactive client over the daemon API: launch a run, watch its live
state and structured log stream, see the outcome. Seeded here — the first point
there is a real run to observe — so we dogfood the TUI through every phase that
follows. Deliberately thin; this is the highest-uncertainty track and *will* be
reworked as we learn, so it is under-specified ahead of need. Retires: the
operator surface, early — when rework is still cheap.

### Phase 5 — The write loop (behavior #1)

Wrap the single step in the write-behavior loop: repeat until artifact exists /
criteria move / blocker declared, with max loop counts and an explicit early-stop
outcome. Prove kill-resume over a dirty worktree here. Retires: loop + recovery
semantics on a real behavior. *TUI:* live loop progress + pass count.

### Phase 6 — Workflow runner + project config binding

Linear-with-bounded-loops array of steps. The project config layer binds agents
(cli+model) per step and defines workflow presets; includes the workflow-authoring
helper. Run a two-step write→write workflow. Retires: the source-vs-config seam
(steps are source, agent bindings are per-project data). *TUI:* workflow/step
view of a run.

### Phase 7 — Remaining behaviors: review-and-update, human

The review-and-update loop, and the human loop (pause graceful / resume / kill
immediate) — made less clunky than v1, using the daemon steering API from
Phase 2. Retires: the full behavior vocabulary. *TUI:* approve / resume / kill
controls — the human loop's home.

### Phase 8 — Concurrency + admission

Adaptive memory-watermark admission, `queued` status, multiple concurrent runs,
admission-only (no preemption). Local model (qwen via aider) as the terminal
entry in agent order, personal machine only. Retires: the memory-efficiency
constraint. *TUI:* multi-run dashboard + queue view.

### Phase 9 — PR lifecycle + attribution (runner-owned)

Worktree → branch → draft PR → ready, with the per-commit `Jarvis-Agent`
attribution footer. Port v1's PR mechanics onto the v2 runner. Retires: the
output side of a run. *TUI:* PR status per run.

## Cross-cutting (not phases)

- **Structured logging**: lands in Phase 2, consumed throughout.
- **TUI**: seeded at Phase 4, extended by each later phase (the *TUI:* notes
  above). Highest-uncertainty track; specced just-in-time, expected to churn.
- **Quota fallback**: agent order folds into Phase 3's invocation layer; the
  configurable order is Phase 6.
- **Evals**: deferred — on-demand only, no architectural impact yet.

## Parity & coexistence

Each phase leaves `jarvis` more capable but never required; `jarvis1` remains the
daily driver until v2 reaches parity (vision step 5). No v1 deletion.
