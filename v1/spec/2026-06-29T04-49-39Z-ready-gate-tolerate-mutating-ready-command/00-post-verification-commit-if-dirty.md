# Post-verification commit-if-dirty on full tier

## Problem

On `full` tier, `runReadyAndCommit` runs fix → commit-if-dirty → verify against a clean tree, then throws `ReadyVerificationDirtyError` when verification returns green but porcelain is non-empty. Mutating `readyCommand` side effects (coverage threshold auto-update, snapshot regen) always leave dirt, so the gate aborts before `gh pr ready` even when verification passed.

## Scope

Extend `runReadyAndCommit` in `v1/src/ready-gate.ts` and align completion-gate error classification, recorded-green timing, retry semantics, tests, and durable docs. All `full`-tier call sites share this helper — no completion-only carve-out.

## Prerequisites

- Fix → commit-if-dirty → verify ordering is live (`2026-06-27T22-03-04Z-jarvis-fix-commit-ready-order-2`).
- Per-project `readyCommand` replaces verification only; harness still runs built-in `bun run fix` before it on `full`.

## Decisions

- Supersedes `2026-06-27T22-03-04Z-jarvis-fix-commit-ready-order-2` invariant that green full-tier verification never commits dirty post-`ready` output — replaced by post-verification commit-if-dirty on green+dirty porcelain.
- Mechanism: extend the existing pre-ready auto-commit path with a post-verification commit-if-dirty step — rules out a configured expected-dirty allowlist or new config knob.
- Allowlist rejected: mutating `readyCommand` outputs are repo-specific and unpredictable at config time; misconfigured allowlists reproduce the original abort bug; post-verify commit mirrors trusted pre-ready commit-if-dirty symmetry — rules out path-scoped allowlists.
- Green+dirty post-verify porcelain is harness-owned committable churn, not operator error — rules out immediate `ReadyVerificationDirtyError` before commit attempt.
- "Unexpected" post-verification dirt means residual non-empty porcelain after the post-verification commit attempt (or commit/push failure) — rules out treating all post-verify dirt as unexpected.
- Post-verification commit runs only on `full` tier after green verification when porcelain is non-empty — rules out post-verify commit on `fast`, on verification red, or when verify leaves a clean tree.
- Pre-verify porcelain must already be clean (existing pre-ready fix-commit idempotency contract) — rules out path-scoped diffing.
- Post-verification commit uses the same shape as pre-ready fix commit: `git add -A`, commit with per-call-site `agentLabel` trailer, push, then re-read porcelain — rules out commit without push or without idempotency re-check.
- Default post-verification commit message: `chore: apply post-ready verification output` (successor wording allowed) — rules out reusing the pre-ready `check:fix` message for verification churn.
- Post-verification commit failure, push failure, or still-dirty porcelain after commit aborts before `gh pr ready` — rules out proceeding with residual dirt or retrying only verification.
- `ReadyVerificationDirtyError` is thrown only when porcelain remains non-empty after the post-verification commit attempt (including the zero-dirt-skip path: no error when verify leaves clean porcelain) — rules out immediate abort on any post-verify dirt without attempting commit.
- Residual `ReadyVerificationDirtyError` message follows the pre-ready still-dirty template structure (green verification, commit attempted, worktree still dirty, inspect) with guidance to inspect unexpected changes, not to fold autofix into `readyCommand` — rules out ad-hoc weak operator messaging.
- Completion-gate post-verification commit/push/residual-dirty failures are non-retryable and exit `6` class (same bucket as today's pre-ready fix-commit failures) — rules out completion retry after a failed post-verify commit.
- Completion-gate exit-6 `dirty-worktree` exclusion covers harness-owned post-verification `chore: apply post-ready verification output` commits the same as pre-ready `chore: apply pre-ready check:fix` — rules out iteration/completion misclassifying post-verify harness commits as operator dirt.
- Completion-gate retry re-runs the full `full`-tier sequence (fix → pre-ready commit-if-dirty → verify → post-verification commit-if-dirty) — rules out verify-only or post-verify-only retry slices.
- Recorded-green HEAD is captured only after the full gate succeeds with clean porcelain (after post-verification commit when applicable) — rules out recording green before post-verify commit on mutating commands.
- `fast` tier keeps today's behavior: no fix, no pre-ready commit, no post-verification commit, no post-verification porcelain enforcement — rules out tier drift.
- Non-completion call sites throw the same post-verification error types/messages; exit-code mapping stays caller-specific (completion `6`, triage `1`, etc.) — rules out divergent error surfaces across gate sites.
- Add dedicated post-verification commit/push error types (successor names to `PreReadyFixCommitError` / `PreReadyFixPushError`) — rules overloading pre-ready error names for post-verify failures.
- Extract `commitPostVerification` as a test seam sibling to `commitPreReadyFix` — rules out inline-only commit logic that blocks sandbox ordering injection.
- No second verification pass after post-verification commit — rules out verify-after-commit loops; verification already returned green; CI is the backstop for committed output.
- Built-in `bun run ready` and non-mutating `readyCommand` with clean post-verify trees keep today's no-extra-commit path — rules out gate churn on the common path.
- Repos with mutating `readyCommand` that relied on green+dirty abort as a signal silently gain harness auto-commit on `full` — rules out documenting this only in code; operator expectation shift is observable.

## Tasks

- Replace the immediate post-verify `ReadyVerificationDirtyError` with post-verification commit-if-dirty when porcelain is non-empty after green verification on `full`.
- Extract `commitPostVerification` mirroring `commitPreReadyFix` (trailer threading, push, post-commit porcelain re-check); introduce post-verification commit/push error types.
- Update completion-gate `instanceof` classification for the new error types; keep them non-retryable.
- Refresh `ready-gate.test.ts`, `run.test.ts`, and other gate tests that assert green+dirty abort without a commit attempt.
- Add coverage for mutating `readyCommand` that leaves committable churn, residual still-dirty after post-verify commit, and recorded-green capturing post-commit HEAD when post-verify commit advances SHA.
- Update durable docs for the new gate step, error semantics, exit-6 dirty-worktree exclusion, and operator migration note.

## Acceptance criteria

- [ ] On `full` tier, green verification with non-empty porcelain runs post-verification commit-if-dirty (add, commit with `agentLabel` trailer, push) instead of throwing `ReadyVerificationDirtyError` before commit.
- [ ] On `full` tier, green verification with clean porcelain skips post-verification commit and proceeds without error (common path unchanged).
- [ ] Post-verification commit failure, push failure, or still-dirty porcelain after post-verification commit aborts before `gh pr ready`; completion-gate failures in this class exit `6`.
- [ ] A mutating `readyCommand` that dirties the tree on green verification can complete the gate when post-verification commit leaves clean porcelain (patch completion path reaches `gh pr ready` / exit 0 in tests).
- [ ] Residual still-dirty porcelain after post-verification commit throws `ReadyVerificationDirtyError` (or successor) matching the pre-ready still-dirty message structure: green verification, commit attempted, worktree still dirty, inspect — with guidance to inspect unexpected changes, not to fold autofix into `readyCommand`.
- [ ] `fast` tier skips fix, pre-ready commit, post-verification commit, and post-verification porcelain enforcement — `ready-gate.test.ts` fast-tier tests stay green.
- [ ] Completion-gate retry re-runs the full `full`-tier sequence including post-verification commit-if-dirty; post-verification commit/push/residual-dirty failures are non-retryable.
- [ ] Recorded-green HEAD is captured only after successful `full` gate with clean porcelain (after post-verification commit when applicable).
- [ ] `ready-gate.test.ts` covers a case where post-verification commit advances HEAD and recorded-green captures the post-commit SHA, not pre-commit.
- [ ] Patch completion, pre-shrink, review baseline/final, `maybeMarkReady`, plan-mode ready transition, and triage `--mark-ready`/`--merge` inherit the new ordering through `runReadyAndCommit` / `runReadyGateWithTier` without call-site forks.
- [ ] Non-completion gate call sites surface the same post-verification error types/messages with caller-specific exit mapping unchanged.
- [ ] `ready-gate.test.ts` and `run.test.ts` cover committable post-verify churn, residual still-dirty abort, and unchanged clean post-verify path.
- [ ] `v2/docs/v1-behaviors.md` records post-verification commit-if-dirty, updated gate ordering, error classification, recorded-green timing, retry semantics, and that post-verify commit does not re-run verification (CI backstop).
- [ ] `v1/docs/operator-runbook.md` **The gate** section describes when the harness commits after verification, notes mutating-`readyCommand` auto-commit expectation shift, and cross-links `v2/docs/v1-behaviors.md`.
- [ ] Stale gate-order recitations in `v1/docs/run-loop.md`, `v1/docs/config.md`, `v1/docs/worktrees-and-commits.md`, `v1/docs/workflows.md`, and `v1/docs/plan-mode.md` are updated or deduped per `v2/docs/documentation-standard.md`.
- [ ] `v1/docs/run-loop.md` exit-6 table includes post-verification failure rows and extends the `dirty-worktree` harness-commit exclusion to `chore: apply post-ready verification output`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v2/docs/v1-behaviors.md` — post-verification commit-if-dirty, gate ordering, error/retry classification, recorded-green timing, no re-verification after post-verify commit (primary durable home).
- `v1/docs/operator-runbook.md` — **The gate** section: harness commits after verification when applicable; mutating-`readyCommand` expectation shift.
- `v1/docs/run-loop.md` — completion-transition gate step order, exit-6 rows for post-verification failures, `dirty-worktree` exclusion for post-verify harness commits.
- `v1/docs/config.md` — `readyCommand` + `full`-tier ordering includes post-verification commit-if-dirty.
- `v1/docs/worktrees-and-commits.md` — completion readiness narrative.
- `v1/docs/workflows.md` — completion-gate narrative; cross-link or dedupe per documentation standard.
- `v1/docs/plan-mode.md` — plan-mode auto-mark-ready gate ordering includes post-verification commit-if-dirty.
