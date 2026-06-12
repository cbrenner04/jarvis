# State store

The durable state store for Jarvis v2 runs and execution history.

## Location and initialization

The store lives at `~/.jarvis/state/v2.sqlite`. A library-owned bootstrap in `openStateStore()` creates or opens this file and applies forward-only, idempotent migrations before any repository operation is exposed. Callers can override the path for tests or temporary stores.

## Schema

### `runs` table

Orchestration identity, lifecycle, and checkpoint, plus pointers to work artifacts:

- `id` (TEXT): Unique run identifier.
- `project` (TEXT): Project identifier from the target repo registry.
- `spec_ref` (TEXT): Reference to the spec/target (branch, commit, etc).
- `created_at` (INTEGER): Unix timestamp (milliseconds) when the run was created.
- `status` (TEXT): One of `in-progress`, `completed`, `blocked`, `budget-soft-stopped`.
  `failed` is also used for terminal invocation failures.
- `attempt_count` (INTEGER): Number of completed attempts (durable checkpoint for resume).
- `worktree_path` (TEXT): Path to the worktree (reconstructible, not durable).
- `branch` (TEXT): Git branch name (durable).
- `spec_path` (TEXT): Path to the spec within the worktree.

### `attempts` table

Per-step attempt records linked to a run:

- `id` (TEXT): Unique attempt identifier.
- `run_id` (TEXT): Foreign key to `runs.id`.
- `attempt_number` (INTEGER): Sequential attempt number for the run (1, 2, ...).
- `started_at` (INTEGER): Unix timestamp (milliseconds) when the attempt started.
- `status` (TEXT): `in-progress`, `completed`, `blocked`, `budget-soft-stopped`.

### `outcomes` table

Outcome classification for an attempt:

- `id` (TEXT): Unique outcome identifier.
- `attempt_id` (TEXT): Foreign key to `attempts.id`.
- `kind` (TEXT): Outcome classification: `done`, `no-work`, `progress`, `blocked`, `contract_miss`, `invocation_failure`, `invalid_token`.
- `completed_at` (INTEGER): Unix timestamp (milliseconds) when the outcome was recorded.

## Migrations

Migrations are forward-only and idempotent. Re-opening an already-migrated store applies no changes. New columns or tables are added as consumers need them, never ahead of time.

## API surface

Repository-style named operations, keyed by durable IDs. No generic SQL surface is public.

### `createRun(args)`

Create a new run and return its ID.

**Args:**
- `project: string` — Project identifier.
- `specRef: string` — Reference to the spec/target (branch, commit, etc).
- `worktreePath: string` — Path to the worktree.
- `branch: string` — Git branch name.
- `specPath: string` — Path to the spec within the worktree.

**Returns:** Run ID (string).

Initial state: `status = "in-progress"`, `attempt_count = 0`, `createdAt = now()`.

### `loadRun(runId)`

Load a run and its attempt history for resume.

**Args:**
- `runId: string` — The run ID to load.

**Returns:** Run record with nested attempts array, including each attempt's
durable outcome classification when present, or `null` if not found.

### `findRunByProjectBranch(args)`

Load the most recent run for a `(project, branch)` resume key.

**Args:**
- `project: string` — Project identifier.
- `branch: string` — Git branch name.

**Returns:** Run record with nested attempts array, or `null` if no run exists
for that key.

### `recordAttemptStart(runId)`

Record the start of a new attempt for a run.

**Args:**
- `runId: string` — The run ID.

**Returns:** Attempt ID (string).

Creates an `attempts` row with `status = "in-progress"`, `startedAt = now()`, and `attemptNumber = current length + 1`.

### `commitCompletionBoundary(args)`

Commit a completion boundary atomically: persist attempt completion + outcome + checkpoint/attempt-count advance.

This is idempotent: re-committing an already-finished boundary rolls back to a no-op (checking for an existing outcome row for that attempt and returning early).

**Args:**
- `attemptId: string` — The attempt ID to complete.
- `status: AttemptStatus` — Terminal status of the attempt.
- `outcomeKind: OutcomeKind` — Outcome classification.
- `beforeRunUpdate?: () => void` — Test seam to force a mid-transaction failure.

**Transaction:**

1. Update the attempt's status to the provided terminal status.
2. Create an outcome row linking the attempt to the outcome kind.
3. Increment the run's `attempt_count`.
4. Persist the run's boundary status (`in-progress`, `completed`, `blocked`, or `failed`).

All three operations commit or roll back together. If an outcome already exists for this attempt (indicating a prior completion), the operation is a no-op.

### `setRunStatus(runId, status)`

Persist a run status change outside a completion boundary.

Current use: when an invocation exits on budget after already committing the
last `progress` boundary, the loop marks the run `budget-soft-stopped`. Resume
reads that status plus attempt history to continue with a fresh per-invocation
budget.

## Implementation notes

- **Transactional boundary:** The completion boundary uses a database transaction to ensure all-or-nothing persistence. A forced failure mid-boundary rolls all changes back.
- **No transcripts or cost streams:** The store carries only minimal state needed for resumption: timestamps, terminal status, outcome classification. Rich logs and token/cost tracking are out of scope here.
- **Deterministic outcomes:** Outcome rows carry classifications (`done`, `progress`, `blocked`, etc.), not free-form payloads. The runner branches on these deterministic values.
- **Resume read:** Recovery branches from durable state only: the `(project,
  branch)` run lookup, run status, and attempt/outcome history. An `in-progress`
  attempt means "re-run that dirty iteration"; a committed `budget-soft-stopped`
  run means "continue with a fresh budget"; a committed terminal run returns its
  stored result idempotently.
- **Derived interruption:** `interrupted` is not a stored status. An open attempt
  with no committed boundary is the interrupted-state read.

## Cross-references

See [`v2-architecture.md`](./v2-architecture.md) for the broader design:
- **Runs, state & the human loop** (lines 220–344): orchestration state model and recovery semantics.
- **Persistence** (lines 252–281): store location, migrations, and repository-op surface.
- **Recovery** (lines 283–303): idempotent boundary commit and resumption guarantees.
