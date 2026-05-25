---
name: v2-phase-1-state-store
---

Next phase after `v2/spec/v2-meta-index.md` Phase 0 is Phase 1: the v2 state
store. This intent should become the spec seed for the first real v2 runtime
primitive: a pure-library SQLite persistence layer under `v2/` that defines the
 durable run/step/outcome model before any daemon or step execution work lands.

Goal: implement Phase 1 from `v2/docs/v2-build-order.md` and the matching
architecture section in `v2/docs/v2-architecture.md`. Land a library-owned
SQLite store at `~/.jarvis/state/v2.sqlite` by default, with caller override for
tests/temp databases, forward-only idempotent migrations, and a narrow
repository-style API that proves the orchestration-vs-work split and
kill-resume == crash-recovery boundary semantics.

Key decisions already made; the spec should follow them, not reopen them:

- Phase 1 is a pure library, not a daemon-owned shell.
- SQLite is the store; no Postgres path, no generic swappable data layer.
- Durable split is `runs`, `step_attempts`, `step_outcomes`.
- `runs` stores orchestration identity/lifecycle/checkpoint/work pointers, not
  embedded execution history or payload blobs.
- Public write boundary is narrow: `createRun`, `recordStepStart`,
  `commitStepBoundary`; read boundary is `loadRunForResume` and
  `listStepHistory`.
- `commitStepBoundary` is the only public path that durably completes an
  attempt, persists an outcome, and advances `runs.next_step_id`, all in one
  transaction.
- Recovery is step-boundary only. No mid-step resume, no daemon lifecycle
  semantics, no human steering state in this phase.

Scope to draft toward:

- Add the Phase 1 state-store module(s) under `v2/src`.
- Define the schema and migration bootstrap for `runs`, `step_attempts`, and
  `step_outcomes`.
- Expose the named API operations from typed library code, keyed by durable IDs
  and monotonic attempt ordinals rather than SQL-shaped callers.
- Model the recovery read outcomes explicitly:
  `start-next-boundary`, `replay-last-boundary`, `run-terminal`.
- Add library-local tests against temporary SQLite databases covering bootstrap,
  migrations, create/resume persistence, attempt history reads, and transactional
  boundary recovery behavior.
- Extend docs where needed so Phase 1 decisions stay discoverable and the meta
  index/build-order references remain aligned.

Important constraints:

- Keep payloads narrow and deterministic: timestamps, terminal status, outcome
  classification, minimal pointer fields.
- Rich logs, transcripts, token/cost streams, daemon/session metadata, and
  generic query helpers stay out.
- WAL, daemon singleton-writer policy, IPC, structured logging, worktrees, and
  actual step execution belong to later phases.
- Avoid speculative abstractions around future stores or future runtime shells.
- Stay within the existing repo stack and verification surfaces: TypeScript on
  Bun, strict typing, co-located tests, root `bun test` and `bun run typecheck`.

Likely spec shape:

- One slice for schema + bootstrap + migrations.
- One slice for write/read API and durable type contracts.
- One slice for recovery semantics and transactional proof tests.
- One slice for docs updates if the implementation work meaningfully changes the
  written Phase 1 contract.

Out of scope: daemon shell, IPC/control API, structured logging streams, the
first working step, TUI, workflow config, human loop controls, concurrency, or
PR lifecycle.

## Refine turn 1

Draft toward a small index with 3 implementation slices plus an optional docs
slice only if the written Phase 1 contract changes. The current durable contract
already lives in `v2/docs/v2-architecture.md` and sequencing lives in
`v2/docs/v2-build-order.md`; do not create a new parallel design doc for the
store. If implementation tightens or changes Phase 1 semantics, update that
existing architecture section in the same subspec and keep `v2/spec/v2-meta-index.md`
and build-order wording aligned only where the contract actually moved.

Keep the schema slice focused on bootstrap mechanics and forward-only migration
behavior, not on future tuning knobs. Good acceptance boundaries there:
database path resolution, parent directory creation if needed, idempotent
migration application, and stable initial schema for `runs`, `step_attempts`,
`step_outcomes`. Explicitly keep WAL pragmas, lock policy, and multi-process
coordination out of scope.

Keep the API slice strict about public surface area. The spec should name the
durable store types and repository methods that are public, and say that SQL
rows, migration runners, raw Bun SQLite handles, and ad hoc query helpers stay
internal. Favor exact input/output contracts keyed by `runId`, `stepId`,
`attemptId`, and `attemptOrdinal`; avoid reopening identifier format or adding a
generic persistence abstraction.

Recovery/proof coverage should be its own slice. Make the draft require tests
for: fresh run resumes at `start-next-boundary`; an attempt started without a
committed boundary resumes at `replay-last-boundary`; a committed terminal
boundary advances exactly once; terminal runs read back as `run-terminal`.
Include at least one proof that replaying a logically already-committed
boundary cannot duplicate the durable outcome or advance `next_step_id` twice.

Call out inline documentation requirements in the implementation slices: every
exported store symbol needs doc-comments, while cross-file semantics belong in
`v2/docs/` per `v2/docs/documentation-standard.md`. That should keep the draft
from inventing extra docs while still requiring durable updates when the public
contract changes.

## Refine turn 2

Keep the draft repo-native. The implementation should live under `v2/src` with
co-located tests in the existing `v2/src/*.test.ts` style; do not invent a new
top-level package, fixture tree, or docs-only support directory for Phase 1.

Tighten the schema slice around invariants the later API and recovery slices
depend on. The draft should require stable uniqueness/foreign-key rules that
make the durable model enforceable in SQLite: one run per `runId`, monotonic
attempt ordinals scoped to `runId + stepId`, and one terminal outcome record
per durably completed attempt. Keep the spec at the invariant level, not SQL
DDL detail.

Bootstrap acceptance should distinguish first-open from reopen behavior. The
schema slice should prove: creating the default/override database path works,
missing parent directories are created, a fresh store reaches the current
schema, and reopening an already-current store reapplies migrations as a no-op
without changing durable data.

The API slice should make creation-time and boundary-time inputs explicit, not
just the method names. `createRun` should own the durable run/work pointer
payload and initial checkpoint. `recordStepStart` should be the only public path
that allocates a new attempt ordinal. `commitStepBoundary` should accept enough
identity to bind the commit to exactly one prior attempt and one next-step
advance, without exposing raw SQL handles or caller-managed transactions.

Do not let the recovery slice hand-wave terminality. The draft should say
whether `run-terminal` is derived from a terminal run status, `next_step_id`
being absent, or both, and keep that rule consistent across schema fields, API
types, and docs if it becomes public semantics.

The proof tests should force one observable answer for duplicate boundary
commit attempts. Either the public contract returns the already-committed
snapshot for the same logical boundary or it rejects as already committed; in
either case the spec should require no second outcome row and no second
checkpoint advance. Do not leave that behavior implicit.

Docs slice guidance: no standalone docs subspec by default. If the draft fixes
observable semantics like terminal-run encoding or duplicate-commit behavior,
put the `v2/docs/v2-architecture.md` update in the same implementation slice
that makes the behavior concrete, and only touch `v2/docs/v2-build-order.md` or
`v2/spec/v2-meta-index.md` if their current wording becomes inaccurate.

## Refine turn 3

Bias the draft toward one index with exactly 3 implementation subspecs:
schema/bootstrap, public store API, and recovery proof coverage. Only split out
docs if the implementation work changes Phase 1 semantics enough that a mixed
code+docs subspec would stop being atomic.

Keep naming aligned with the current durable docs: `runs`, `step_attempts`, and
`step_outcomes`. If the draft mentions a shorter "steps/outcomes" summary in
`v2/docs/v2-build-order.md` or `v2/spec/v2-meta-index.md`, treat that as prose
shorthand, not a reason to reopen the table names or add alias terminology.

The draft should make one concrete call on duplicate boundary commits instead of
leaving it to implementation taste. Best fit with crash-recovery is: a repeat
`commitStepBoundary` for the same already-committed attempt returns the existing
durable boundary snapshot, with no second outcome row and no second
`next_step_id` advance. If the draft chooses rejection instead, require one
named error contract and the same no-duplicate durable proof.

The draft should also pin terminal-run encoding tightly enough that recovery
tests can assert one rule. Prefer `run-terminal` when `runs.status` is terminal
and `runs.next_step_id` is absent after a committed terminal boundary; do not
treat `next_step_id` absence by itself as enough unless the architecture text is
updated in the same subspec.

Keep the public API slice explicit about store construction scope. The spec can
allow one public bootstrap/open entry that resolves the default path or caller
override and then exposes only the named repository methods, but it should keep
raw database handles, migration entrypoints, and transaction control internal.

