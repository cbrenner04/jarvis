---
name: phase-2-write-loop
---

# Phase 2 of v2 — The write loop (behavior #1)

Build the write *loop*: wrap the existing single-pass write step
(`executeWrite` in `v2/src/write.ts`) in a behavior loop that repeats until the
work is done, blocked, or the budget runs out — and make that loop **resumable**
across kill/crash. This is the first v2 consumer that must resume, so durable
state earns its first rows here.

Source of truth: Phase 2 line in `v2/spec/v2-meta-index.md` and the Phase 2
section of `v2/docs/v2-build-order.md`; loop + state + recovery semantics in
`v2/docs/v2-architecture.md` (Output contract, Runs/state, Persistence,
Recovery, Steering). Done condition is merged code in `v2/src`, not this intent.

## What exists today

- `executeWrite` runs **one** invocation pass over an external worktree:
  render prompt → `runStep` (quota fallback → outcome token → deterministic
  contract check) → classified `StepRunResult`. No loop, no retry, no state.
- `runStep` already classifies the four outcomes: `complete` (`done`/`no-work`),
  `progress`, `blocked`, `contract_miss`, plus `invalid_token` /
  `invocation_failure`.
- Worktree lifecycle + `.jarvis.lock` coexistence live in `external-worktree.ts`.
- Real agent bindings still aren't wired (`write-behavior.md`): the loop is
  exercised through injected test bindings (`v2/src/testing/bindings.ts`), same
  as Phase 1.

## Scope — the loop

A new loop layer that calls the write step repeatedly. Per the architecture's
output-contract rules:

- **`progress`** → loop again, consuming one of `N` max iterations. Contract
  **not** checked mid-loop.
- **`done` / `no-work`** → check the artifact contract. Pass → loop ends
  successfully. Fail → append a `## Blocker` to the spec and stop
  (`contract_miss` is a blocker, not a silent retry).
- **`blocked`** → stop immediately with a blocked outcome. (Routing to a human
  loop is Phase 6; here it's just a terminal stop state.)
- **Budget exhausted while still `progress`** → soft stop: resumable, not a
  blocker (v1's max-iterations / exit-5 model). Distinct outcome from `blocked`.
- `invocation_failure` (all agents exhausted / not wired) stays terminal as today.

Open for refine: where `N` comes from (CLI flag default vs. constant), the exact
loop-result surface, and how "acceptance criteria moved" factors in beyond the
artifact-exists contract (build-order says "artifact exists / criteria move / a
blocker is declared").

## Scope — durable state (first rows only)

Stand up the SQLite store the architecture specifies, but **only the columns the
write-loop resume path reads** — nothing built ahead of this consumer.

- **`~/.jarvis/state/v2.sqlite`**, library-owned bootstrap that opens the file
  (or a caller override for tests/temp stores) and applies forward-only,
  idempotent migrations before any repository op is exposed. Host-agnostic — no
  daemon, no single-writer lock, no WAL assumptions yet.
- **Repository-style named operations** keyed by durable IDs (create a run,
  record a step/iteration start, commit a boundary, load a run for resume). No
  generic SQL surface. SQL text, row mappers, migration helpers stay internal.
- **`runs`** carries enough to resume: identity (run ID, project, spec/target
  ref, created-at), status, a checkpoint pointer, and pointers to work (worktree
  path, branch, spec path) — not their contents.
- **Execution history** as attempt/outcome rows linked by ID, narrow: timestamps,
  terminal status, outcome classification. No transcripts, no token/cost streams.
- **Single transactional completion boundary**: attempt completion + outcome
  durability + checkpoint advance commit or roll back as a unit. Idempotent — a
  retried finished boundary must not double-advance or duplicate effect.

Open for refine: the precise minimal column set (driven by exactly what resume
reads), and whether a single-step loop needs a `next_step_id` checkpoint or just
an attempt count + terminal status.

## Scope — kill-resume / crash-recovery

Same path for both, per the architecture: **never resume mid-step**; replay from
the last durable pre-step boundary.

- Recovery derives from durable state (run status + attempt/outcome history),
  not in-memory flags.
- A killed/crashed run left an interrupted iteration over a **dirty worktree**;
  resume re-runs that iteration over the dirty worktree. A run paused
  cleanly-at-boundary just continues. (One field records which; full pause/kill
  steering is Phase 3+, but the resume branch on "interrupted vs. completed"
  starts here.)
- Worktree is reconstructible from its branch (carry forward v1
  auto-materialization) if the path is missing on resume.
- Budget-exhausted soft-stop is resumable: re-running picks up remaining
  iterations.

Cancellation flows through the existing `AbortSignal` seam (`signal` on
`runStep`/`executeWrite`) — keep the library host-agnostic, no global
process-signal ownership in the core.

## Out of scope

- Daemon host, IPC, structured logging (Phase 3).
- TUI — runs stay foreground here (`v2-build-order.md`: *TUI: not yet*).
- Workflow runner, multi-step, step IDs, category→model store (Phase 5).
- Human-loop steering / pause-resume-kill API (Phase 3/6). Phase 2 proves
  kill-resume mechanically via re-running the CLI, not via a steering API.
- Cross-step attempt history columns (Phase 5 grows them).

## Verification (target state, outside this spec tree)

- New loop + state + recovery code merged under `v2/src` with co-located tests.
- Tests prove, via injected bindings, the loop outcomes: `progress` loops and
  consumes budget; `done`/`no-work` + passing contract ends success;
  `done`/`no-work` + failing contract appends a blocker and stops; `blocked`
  stops; budget exhaustion soft-stops resumably.
- Tests prove kill-resume over a dirty worktree: an interrupted run re-runs the
  interrupted iteration; a budget-soft-stopped run resumes remaining iterations;
  a finished-boundary retry is idempotent (no double checkpoint advance).
- State tests run against a temp/override SQLite path (no `~/.jarvis` pollution)
  and prove bootstrap + idempotent migrations + the transactional boundary.
- `bun run typecheck` (both tsconfigs) and `bun test` green; `bun run ready`
  passes.
- Import boundary holds: new code lives in `v2/**` / `shared/**`, no
  `v2 -> v1` imports.

## Documentation updates

- Update `v2/docs/write-behavior.md` from "one invocation pass only; no
  automatic retry loop" to describe the loop, its outcomes, budget, and the
  resume model.
- Tick the Phase 2 box in `v2/spec/v2-meta-index.md` once the code merges
  (per the phase-start workflow — Jarvis owns that flip, not done by hand here).
- If any existing v1 behavior is changed, update `v2/docs/v1-behaviors.md`
  (per repo rule). Expected none — this is additive v2 code.
- Note the new SQLite state location/shape wherever Phase 1's worktree layout is
  documented, if a state doc doesn't already cover it.

## Refinement

- Iteration budget is per-invocation (v1 max-iterations / exit-5 model), not a
  durable counter. Resume = a fresh invocation with a fresh budget that continues
  the spec work; `runs` carries an attempt count for history/idempotency, not a
  remaining-iterations column. Rules out persisting a global remaining-budget that
  resume decrements — which the seed's "picks up remaining iterations" phrasing
  could otherwise imply, and which would add a column no resume read needs.
- Done-condition contract checks artifact existence only; the loop computes no
  spec acceptance-criteria diff. `runStep`'s outcome token already separates
  `progress` from `done`/`no-work`, so criteria-movement is the agent's signal,
  not something the loop recomputes. Deferred to first consumer: criteria-movement
  as an independent done signal — pin when a caller needs richer done-detection.
  Rules out building a spec-checkbox/criteria-diff mechanism in Phase 2, which the
  build-order "criteria move" phrasing could otherwise invite.
- Resume lookup keys on the `(project, branch)` tuple, not a CLI-supplied run ID.
  Architecture pins "at most one active run per (project, branch)"; the CLI surface
  carries no run ID. Same key resumes the existing run; a different key mints a fresh
  run. Run ID + created-at are internal once the key is pinned. Acceptance: same key
  resumes; different key creates fresh. Rules out a run-ID-keyed surface (none exists)
  or always-fresh-run-per-invocation (defeats resume).
- Resume branches three ways, not two. Terminal-done (success / blocked /
  `contract_miss` / `invocation_failure`) → report and do **not** resume. Interrupted
  (open attempt row, no committed boundary) → re-run the iteration over the dirty
  worktree. Soft-stop → continue with a fresh budget. Acceptance: a terminal run is
  not re-run. Rules out the binary interrupted-vs-completed branch, which reads every
  boundary-committed terminal run as "completed-at-boundary" and wrongly re-runs it.
- Stored run `status` enum has a home for every terminal outcome `runStep` can emit:
  `contract_miss` folds into a blocked status (it appends `## Blocker`);
  `invocation_failure` and `invalid_token` map to a failed status. The terminal-done
  branch reads this column, so the produced statuses and the stored enum must agree.
  Rules out an enum missing slots for these, which makes terminal-done unreadable.
- `invalid_token` is terminal failure, not `progress` — a malformed agent response
  routes like `invocation_failure`. Rules out looping on a malformed response.
- Interrupted-ness is **derived** (a read for an open attempt row with no committed
  boundary), not a stored `status` value; run status stays in-progress. `interrupted`
  is therefore not a value in the stored status enum. Rules out the conflicting design
  where `interrupted` is both a stored status and a derived read.
- Resume is gated on the worktree lock: a live lock holder → refuse (not recover);
  only a stale lock recovers. Attempt rows alone cannot distinguish an interrupted run
  from a currently-live one — the `withExternalWorktree` lock is the discriminator.
  Acceptance: resume against a live lock holder refuses. Rules out treating a live run
  as resumable.
- Boundary idempotency rests on the attempt ID's committed terminal status: a retried
  finished boundary observes the already-committed status and no-ops (no double
  checkpoint advance, no duplicate outcome row). Acceptance: finished-boundary retry is
  idempotent. Rules out asserting idempotency with no testable key.
- A resumed run does not re-append `## Blocker` (follows from terminal-done not being
  re-run). Acceptance: resuming a `contract_miss`/blocked run appends no second Blocker.
  Rules out duplicate Blocker accretion across resumes.
- Soft-stop (budget exhausted while still `progress`) exits `5`, matching v1's
  max-iterations exit code. The other terminal failures stay "distinct non-zero" as
  reasonable defaults. Rules out an arbitrary soft-stop code that breaks v1 parity.

