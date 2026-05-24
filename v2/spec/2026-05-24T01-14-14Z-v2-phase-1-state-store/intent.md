---
name: v2-phase-1-state-store
---

Draft the next v2 phase from `v2/spec/v2-meta-index.md`: Phase 1, the SQLite
state store. This is the first phase after the scaffold and should define the
durable run-state model that every later daemon, step runner, and TUI surface
will rely on.

Goal: land a small, reviewable spec for a pure library under `v2/` that owns
the run/step/outcome schema, persistence API, and resume semantics boundary. No
daemon, no IPC surface, no real step execution yet. The work should retire
state-model risk in isolation before Phase 2 starts layering process lifecycle
and control surfaces on top.

Design constraints to carry into the draft:

- Follow `v2/docs/v2-build-order.md`: Phase 1 is SQLite-backed and explicitly
  "pure library, no daemon."
- Keep the v2 architecture honest about orchestration state vs work state. The
  schema and APIs should make that split visible instead of collapsing
  everything into a single mutable run record.
- Define kill-resume semantics here as equivalent to crash recovery at the
  state boundary. Later phases may trigger the recovery through a daemon, but
  the durable model belongs in this phase.
- Keep the scope tight enough for a handful of atomic subspecs, not a giant
  kitchen-sink state system.
- Stay within the existing repo shape and Phase 0 decisions: TypeScript on Bun,
  strict typing, co-located v2 tests, minimal churn outside `v2/` plus any root
  verification or docs updates the spec truly needs.

Expected spec shape:

- A dated spec directory under `v2/spec/` with `index.md` plus numbered
  subspecs.
- Subspecs should be independently testable and small enough to review without
  reading the entire future architecture into them.
- Documentation updates are part of the work, not a follow-up.

Likely scope areas for the spec to divide:

- Choose the initial SQLite dependency and connection strategy for v2.
- Define the first schema for runs, steps, and recorded outcomes/events.
- Define the persistence API the rest of v2 will call.
- Specify resume/recovery semantics, especially what must be durable at step
  boundaries versus what can remain in-memory until later phases.
- Add focused tests that prove schema creation, round-trip persistence, and
  recovery-oriented reads/writes.

Questions the draft should resolve explicitly:

- What exact records exist in Phase 1, and which tempting fields should wait
  for later phases?
- How is "step outcome" represented now so Phase 3 can persist single-step
  execution without redesigning the store?
- What is the smallest durable checkpoint model that still supports the
  build-order requirement that kill-resume equals crash recovery?
- How much logging/event history belongs in Phase 1 versus Phase 2 structured
  logging?
- Which docs need updating so Phase 1's persistence boundary is discoverable in
  `v2/docs/`?

Out of scope for this intent:

- Daemon startup/shutdown, sockets, RPC, or CLI control commands.
- Executing agents, creating worktrees, prompt rendering, or quota fallback.
- TUI work.
- PR lifecycle work.
- Broad v2 refactors unrelated to introducing the state-store boundary.

The resulting spec should leave v2 with a tested persistence spine and clear
interfaces, so Phase 2 can focus on the daemon shell and IPC instead of still
arguing about what durable state means.

## Refine turn 1

- Keep Phase 1 centered on a library-owned durable model, not a daemon-shaped
  store. The draft should avoid requirements that depend on a long-lived
  singleton writer, IPC session state, or structured log streaming; those arrive
  in Phase 2 even if SQLite itself later runs under daemon ownership.
- Make the orchestration/work split explicit in the schema shape. A good Phase 1
  boundary is: `runs` hold identity, lifecycle status, and resume checkpoint;
  `steps` or step-attempt records hold execution-unit history; work artifacts
  such as worktree/branch/spec-path/PR refs stay as pointers only. Do not fold
  mutable step-progress details into one giant run blob.
- Keep "outcome" small and forward-compatible. Phase 1 should persist the result
  a later single-step runner will need to reason about: terminal classification,
  timestamps, selected durable payload fields, and enough linkage to know which
  step attempt produced it. Full structured logs, token/cost streams, and rich
  event narration should stay out unless the draft can justify them as required
  for recovery rather than observability.
- Define recovery around a boundary checkpoint, not mid-step durability. The
  draft should state that an interrupted in-flight step is replayed from its
  last durable pre-step checkpoint, while a completed boundary advances exactly
  once. That keeps "kill-resume == crash-recovery" concrete without inventing
  speculative partial-step snapshots.
- The spec should likely split into 3-4 subspecs, for example: SQLite package +
  connection/migration policy; initial schema + type model; persistence API +
  round-trip tests; recovery/resume semantics + recovery-oriented tests. That is
  small enough to review and lets the most controversial design points land
  independently.
- The draft should explicitly defer tempting fields: daemon pid/socket data,
  live log/event feeds, human-loop steering state beyond what recovery needs,
  agent transcript bodies, quota heuristics, concurrency/admission bookkeeping,
  and any abstraction for alternate databases.

## Refine turn 2

- Anchor the draft to the build-order wording, even where `v2/docs/v2-architecture.md`
  describes later daemon ownership details. Phase 1 may choose a SQLite package,
  file location policy, and migration mechanism, but it should not require WAL,
  a singleton writer, or multi-reader daemon assumptions to make the library
  correct. If those details matter, frame them as compatibility constraints for
  Phase 2 rather than acceptance criteria for Phase 1.
- Push the draft toward explicit finite enums over open-ended JSON blobs for the
  first durable model. In particular, run status, step kind, attempt status, and
  outcome classification should be named and closed in Phase 1 so later phases
  extend them deliberately instead of smuggling semantics through ad hoc payloads.
- Keep the checkpoint model concrete and minimal. A good draft target is one
  durable "next step to execute" or equivalent boundary marker on the run plus
  append-only step-attempt history; recovery should derive replay behavior from
  those records rather than from mutable in-progress fields spread across tables.
- Separate "attempt" from "outcome" in the spec language if both appear. A step
  attempt is the execution record with start/end timestamps and terminal state;
  an outcome is the durable result classification and selected payload that later
  workflow logic consumes. The draft should decide whether these are two tables
  or one table with two concepts, but it should make the distinction explicit.
- Bias the API surface toward transactional repository-style operations, not a
  generic ORM wrapper. The rest of v2 will likely need calls like create-run,
  record-step-start, record-step-finish, load-run-for-resume, and list-step-history;
  the draft should avoid speculative query abstractions or alternate-backend seams.
- Documentation scope should likely include at least `v2/docs/v2-build-order.md`
  and `v2/docs/v2-architecture.md` so the pure-library boundary and the
  daemon-owned-later persistence story stay consistent once Phase 1 lands.

## Refine turn 3

- Make migration/versioning a first-class Phase 1 concern, but keep it minimal:
  one canonical database file-location policy, one schema bootstrap path, and an
  explicit forward-only migration story the library owns. The draft should avoid
  speculative rollback tooling, alternate-backend seams, or daemon-era lock
  policy.
- Push the subspecs to define stable identifiers early. The draft should decide
  whether Phase 1 records use opaque IDs, ordered step indices, attempt numbers,
  or some combination, because resume, history reads, and later daemon APIs all
  depend on durable identity more than on rich payload shape.
- Keep the durable payload for each completed attempt narrow and deterministic.
  A good Phase 1 target is: terminal attempt status, outcome classification,
  started/finished timestamps, and only the selected fields later workflow logic
  must branch on. Raw transcripts, token/cost detail, and log/event bodies
  should stay deferred unless a concrete recovery read requires them.
- Make boundary idempotence explicit in the draft language and tests. Phase 1
  should prove that persisting a finished boundary twice does not advance resume
  state twice, and that recovery reads can distinguish "attempt recorded but run
  checkpoint not advanced" from "boundary fully committed."
- Keep the first schema biased toward Phase 3's single-step runner, not Phase 5+
  loop richness. Fields for repeat-range position, human steering decisions, or
  admission/concurrency state should land only if the draft can tie them to a
  concrete Phase 1 recovery invariant rather than later orchestration wishes.
