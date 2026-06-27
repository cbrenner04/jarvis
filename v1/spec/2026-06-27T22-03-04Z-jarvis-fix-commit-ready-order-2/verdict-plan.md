# Verdict: refinements required before implementation

The spec correctly targets the core problem (reorder `runReadyAndCommit` to fix → commit → strict ready) and centralizes change through the shared helper. It is **not implementation-ready**: several behavioral contracts the prior `ready-and-fix-scripts` work deliberately deferred to harness changes are still unspecified, and shipped docs still describe post-ready dirty-tree commits that this spec deletes without replacement.

---

## Required refinements

### 1. Custom `readyCommand` dirty-on-green outcome

**Outcome:** Pin what happens when a custom `readyCommand` returns green but leaves dirty porcelain.

- Green + dirty → hard error; abort before `gh pr ready` — rules out retaining the post-ready commit path and rules out silently leaving a dirty tree.
- Harness does not run `bun run fix` for custom overrides; override is verification-only — rules out treating override as autofix entrypoint.

**Rationale:** Durable docs (`worktrees-and-commits.md`, `v1-behaviors.md`) and current code both assume post-green dirty-tree commit for overrides. Deleting that path without a replacement contract is a behavior change operators with `readyCommand` will hit.

---

### 2. Fix invocation and commit gating

**Outcome:** Resolve the conflict between decisions ("always fix"), intent ("when worktree needs autofix"), and AC #1 ("with fixable changes").

- `full` tier always invokes `bun run fix` before verification — rules out skipping fix on a clean tree.
- Fix commit runs only when porcelain is non-empty after fix — rules out empty commits on no-op fix.
- Non-zero fix exit aborts before verification and before `gh pr ready` — rules out proceeding after failed fix (extend AC #2 to cover fix-command failure, not only commit/push/dirty).

**Rationale:** Without these pins, implementers can diverge on skip-vs-always and commit-vs-no-commit with no failing AC.

---

### 3. Completion-gate retry semantics under new order

**Outcome:** Update the completion retry contract for fix → commit-if-dirty → ready.

- Retry re-runs the full `full`-tier sequence — rules out ready-only retry after a successful fix-commit.
- Fix-command failure is retryable (same class as today's `ReadyCommandError`) — rules out fail-fast on first transient fix flake.
- Fix-commit, push, and post-commit-dirty failures stay non-retryable — rules out weakening today's post-commit abort contract.
- Red `ready` after successful fix-commit leaves the fix commit on branch; retries do not revert it — rules out implicit rollback between attempts.
- `firstRedBaselineSha` and stuck-red discard do not revert harness fix commits — rules out treating autofix commits as fix-up churn to discard.

**Rationale:** `run-loop.md` and `v1-behaviors.md` describe retry reusing uncommitted custom-`readyCommand` dirt; that model is incompatible with pre-ready fix commits.

---

### 4. Completion-gate pre-ready failure operator contract

**Outcome:** Pin exit behavior for fix/commit/push/post-commit-dirty failures on the completion gate.

- Same non-retryable, operator-intervention class as today's post-ready commit failure (exit `6` on completion gate) — rules out new exit codes or silent draft-PR continuation.

**Rationale:** AC #2 pins observable outcomes but not exit classification; this is load-bearing operator behavior referenced in `run-loop.md` exit tables.

---

### 5. Recorded-green carrier semantics

**Outcome:** Pin when the green carrier is recorded relative to fix commit.

- Recorded-green HEAD is captured only after a successful full gate (strict `ready` green), with clean porcelain — rules out recording green after fix commit but before verification.

**Rationale:** Fix-commit advances HEAD mid-gate; without this pin, `fast`-tier carrier reuse could be wrong.

---

### 6. Plan-mode and override boundaries

**Outcome:** Record explicit boundaries for plan and config overrides.

- Plan-mode full-tier gate uses built-in `bun run fix` + built-in `bun run ready`; `readyCommand` stays unwired — rules out plan skipping harness fix.
- No `fixCommand` config knob; autofix is always built-in `bun run fix` on `full` tier — rules out per-project fix override in this spec.
- Operators who encoded autofix inside `readyCommand` must fold autofix into their command or accept harness fix + their verification — record as migration note, not harness bug.

**Rationale:** Plan call site does not thread `readyCommand` today; explicit pin prevents accidental plan-only verification without fix.

---

### 7. Operator-facing error text and types

**Outcome:** Require alignment of error types, `instanceof` retry classification, and stderr messages with pre-ready fix semantics.

- Rename or re-message `ReadyCheckFixCommitError` / push errors and "post-ready dirty-output" text — rules out misleading operator guidance after path deletion.

**Rationale:** `completion-pipeline.ts` branches on these types for retry vs exit-6; stale wording is an operator-facing defect.

---

### 8. Documentation acceptance criteria (documentation-standard compliance)

**Outcome:** Extend doc ACs beyond the three named files so no durable home contradicts the new order.

- Add `v1/docs/run-loop.md` (completion-transition gate, numbered gate list, exit-6 exception for post-ready commit) — rules out leaving the primary loop doc stale.
- Add `v1/docs/plan-mode.md` ready-transition bullet — rules out plan doc implying built-in-ready dirty commit.
- Broaden `v1/docs/v1-behaviors.md` AC to cover completion retry, red-path commit failure, triage `--mark-ready`/`--merge` gate path, and recorded-green timing — rules out partial baseline update.
- `operator-runbook.md` AC: align gate-order prose and cross-link `v2/docs/v1-behaviors.md`; remove stale autofix-commit caveat only if present — rules out chasing nonexistent intent prose (current runbook documents `lint:md`/CI gap, not autofix commits).

**Rationale:** Per `v2/docs/documentation-standard.md`, behavior must have one durable home with cross-links; multiple v1 docs still describe post-ready dirty commits.

---

### 9. Prerequisites section

**Outcome:** Add `## Prerequisites` citing strict `bun run ready` and `bun run fix` from merged `ready-and-fix-scripts` work.

- Rules out implementing on a checkout where built-in scripts are still mutating-ready.

**Rationale:** Intent declares prerequisites; spec-guidance treats them as validation gates for plan-generated specs.

---

### 10. Acceptance criteria — behavioral coverage beyond file names

**Outcome:** Add or sharpen ACs so checkbox compliance cannot pass without pinning order and failure branches.

- Fix-before-ready ordering is asserted (not only that five test files exist).
- Fix-command failure branch is covered in tests.
- Custom `readyCommand` green + dirty → abort is covered.
- Triage `--mark-ready`/`--merge` full-tier ordering through `runReadyAndCommit` is behaviorally asserted (AC #5 names call sites; add observable ordering AC or require it in `triage-command.test.ts`).

**Rationale:** Harness specs may name test files when structure is the contract, but file-list ACs alone have produced checkbox compliance without branch coverage elsewhere in this repo.

---

## Not required (upheld as out of scope or defensible)

- `fixCommand` config override — correctly deferred; record "no override" as decision, do not implement.
- Single-subspec shape — acceptable given cohesive blast radius through `runReadyAndCommit`.
- Fix commit message wording — intent allows successor; optional one-line default only.
- Index vs subspec title mismatch — cosmetic.
