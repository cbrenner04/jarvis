# Run full gates as fix-commit-ready

## Problem

`runReadyAndCommit` still commits dirty output after a green ready gate. Now that built-in `ready` is strict verification and `fix` is the autofix entrypoint, full gates need to run autofix first, commit that output, then verify the exact committed tree.

## Scope

Change `runReadyAndCommit` and its patch/plan call sites through the shared helper. Keep `fast` tier carrier behavior unchanged. Do not redefine the `fix` or strict `ready` scripts.

## Prerequisites

- `bun run ready` is strict CI-parity verification with no autofix (merged `ready-and-fix-scripts` work).
- `bun run fix` exists as the separate pre-gate autofix entrypoint (merged `ready-and-fix-scripts` work).

## Decisions

- Full-tier gates always invoke `bun run fix` before verification — rules out skipping fix on a clean tree.
- Fix commit runs only when porcelain is non-empty after fix — rules out empty commits on no-op fix.
- Fix output is committed and pushed before `ready` when dirty — rules out a green gate on a tree CI will not see.
- Non-zero fix exit aborts before verification and before `gh pr ready` — rules out proceeding after failed fix.
- Post-ready dirty-tree commit path deleted — rules out retaining ready-then-commit ordering.
- On `full` tier with `readyCommand` set, harness still runs built-in `bun run fix` (and commit-if-dirty) before the override verification — rules out skipping harness fix when an override is configured.
- `readyCommand` replaces verification only; green verification with dirty porcelain aborts without a second harness fix pass — rules out post-verification fix to absorb override dirt.
- Green verification + dirty porcelain abort applies on `full` only; `fast` keeps today's no-porcelain-check behavior — rules out extending the abort to `fast` or silently allowing dirty override greens on `fast`.
- Fix-commit failure, push failure, or post-commit dirty porcelain aborts before verification and `gh pr ready` — rules out marking ready after an unverified or unpushed autofix.
- Completion-gate retry re-runs the full `full`-tier sequence (fix → commit-if-dirty → ready) — rules out ready-only retry after a successful fix-commit.
- Fix-command failure is retryable (same class as today's `ReadyCommandError`) — rules out fail-fast on first transient fix flake.
- Fix-commit, push, and post-commit-dirty failures stay non-retryable — rules out weakening today's post-commit abort contract.
- Red `ready` after successful fix-commit leaves the fix commit on branch; retries do not revert it — rules out implicit rollback between attempts.
- `firstRedBaselineSha` captured only on the first completion-gate verification red, at HEAD after that attempt's fix step (including any fix commit); fix-command reds do not capture — rules out baseline-at-first-fix-command-red that precedes a later fix commit.
- Stuck-red and changing-failure-bound discard still reset to `firstRedBaselineSha`; the capture rule keeps baseline from preceding persisted harness fix commits — rules out baseline-at-first-red with no carve-out for harness fix commits.
- Completion-gate fix/commit/push/post-commit-dirty failures exit `6` (same class as today's post-ready commit failure) — rules out new exit codes or silent draft-PR continuation.
- Triage `--mark-ready`/`--merge` pre-ready fix/commit/push/dirty failures exit `1` with no retry loop — rules out completion-style retry on triage gate failures.
- Recorded-green HEAD captured only after successful full gate (strict `ready` green) with clean porcelain — rules out recording green after fix commit but before verification.
- Plan-mode full-tier gate uses built-in `bun run fix` + built-in `bun run ready`; `readyCommand` stays unwired — rules out plan skipping harness fix.
- No `fixCommand` config knob; autofix is always built-in `bun run fix` on `full` tier — rules out per-project fix override in this spec.
- Fix commits thread per-call-site `agentLabel` into the commit trailer — rules out dropping attribution on the pre-ready fix commit.
- Non-completion `runReadyAndCommit` call sites throw the same pre-ready error types/messages; exit-code mapping stays caller-specific (completion `6`, triage `1`, etc.) — rules out divergent error surfaces across call sites.
- Operators who encoded autofix inside `readyCommand` must fold autofix into their command or accept harness fix + their verification — migration note, not harness bug.
- Rename or re-message `ReadyCheckFixCommitError`, push errors, `RunReadyAndCommitOpts`, the `commitCheckFix` seam, inject-site comments, and stale "post-ready dirty-output" text to match pre-ready fix semantics — rules out misleading operator guidance and a post-ready API surface after reorder.
- Default fix commit message: `chore: apply pre-ready check:fix` (successor wording allowed).

## Tasks

- Replace the post-ready dirty-tree commit path with a pre-ready `bun run fix` path for `full` gates.
- Commit and push fix output only when porcelain is non-empty after fix.
- Abort on `full`-tier green verification with dirty porcelain (no second harness fix pass).
- Pin `firstRedBaselineSha` capture on first verification red at post-fix-commit HEAD; keep stuck-red discard on that baseline.
- Rename/refactor `RunReadyAndCommitOpts`, the fix-commit seam (successor to `commitCheckFix`), inject sites, and comments for pre-ready fix/commit semantics.
- Align completion-gate retry, exit-6 classification, recorded-green timing, and error types/messages with the new order.
- Replace completion-gate retry docs that describe reusing uncommitted custom-`readyCommand` dirt with the fix-commit-persists-across-ready-reds model.
- Keep `fast` tier behavior and recorded-green tier selection unchanged.
- Update patch, plan, and triage ready-transition tests that currently expect `ready` to dirty the tree.
- Update durable docs for the new fix → commit → ready order.

## Acceptance criteria

- [ ] Full-tier gates always run `bun run fix` before verification, then commit and push only when porcelain is non-empty after fix, then run the verification gate against the committed tree.
- [ ] Non-zero fix exit, fix-commit failure, fix push failure, or post-commit dirty porcelain aborts before the verification gate and before `gh pr ready`; completion-gate pre-ready failures exit `6`.
- [ ] On `full` tier with `readyCommand` set, harness runs built-in `bun run fix` and commit-if-dirty before the override verification; if verification returns green with dirty porcelain, abort before `gh pr ready` without a second harness fix pass.
- [ ] Green verification + dirty porcelain abort applies on `full` only; `fast` tier keeps today's no post-verification porcelain check and no fix/commit path.
- [ ] A green full-tier verification gate never commits dirty output after `ready` returns.
- [ ] Completion-gate retry re-runs the full `full`-tier sequence; fix-command failure is retryable; fix-commit, push, and post-commit-dirty failures are not; red `ready` after a successful fix-commit retains the fix commit across retries; `firstRedBaselineSha` is captured only on the first verification red at post-fix-commit HEAD; stuck-red discard cannot reset below persisted harness fix commits.
- [ ] Recorded-green HEAD is captured only after a successful full gate with clean porcelain, not after fix commit alone.
- [ ] Fast-tier gates do not run `bun run fix`, do not commit fix output, and keep existing recorded-green carrier semantics.
- [ ] Patch completion, review baseline/final, shrink pre-gate, `maybeMarkReady`, plan-mode ready transition, and triage `--mark-ready`/`--merge` full-tier transitions run fix → commit-if-dirty → ready through `runReadyAndCommit`.
- [ ] Plan-mode full-tier gate uses built-in `bun run fix` and built-in `bun run ready`; `readyCommand` is not wired for plan.
- [ ] Per-project `readyCommand` overrides replace only the verification command and receive `JARVIS_READY_TIER`; they do not replace `bun run fix`.
- [ ] Triage `--mark-ready`/`--merge` pre-ready fix/commit/push/dirty failures exit `1` with no retry loop.
- [ ] Fix commits preserve per-call-site `agentLabel` trailer threading; non-completion call sites use the same pre-ready error types/messages with caller-specific exit mapping.
- [ ] `RunReadyAndCommitOpts`, the fix-commit seam, inject sites, and comments describe pre-ready fix/commit semantics (no post-ready dirty-output surface).
- [ ] Error types, `instanceof` retry classification, and stderr messages align with pre-ready fix semantics (no stale "post-ready dirty-output" guidance).
- [ ] `run.test.ts`, `ready-gate.test.ts`, `modes/patch/pr.sandbox-unrunnable.test.ts`, `modes/plan/pr.sandbox-unrunnable.test.ts`, and `triage-command.test.ts` assert fix-before-ready ordering, fix-command failure, custom-`readyCommand` green+dirty abort, baseline-vs-fix-commit interaction, and triage full-tier ordering.
- [ ] `v1/docs/operator-runbook.md` describes fix → commit → strict ready, cross-links `v2/docs/v1-behaviors.md`, and removes the hand-merge autofix caveat only if present.
- [ ] `v1/docs/worktrees-and-commits.md` describes completion readiness without a post-ready dirty-output commit and pins custom-`readyCommand` green+dirty abort on `full`.
- [ ] `v1/docs/config.md` states that on `full` tier harness runs `bun run fix` before `readyCommand`; override is verification-only.
- [ ] `v1/docs/run-loop.md` completion-transition gate, numbered gate list, retry semantics (fix commits persist; no dirty-reuse on retry), and exit-6 table match the new order.
- [ ] `v1/docs/workflows.md` completion-gate narrative matches fix → commit-if-dirty → ready (cross-link primary home or dedupe per `v2/docs/documentation-standard.md`).
- [ ] `v1/docs/plan-mode.md` ready-transition bullet matches built-in fix → ready (no post-ready dirty commit).
- [ ] `v2/docs/v1-behaviors.md` records completion-gate ordering, completion retry, red-path commit failure, triage `--mark-ready`/`--merge` gate path, recorded-green timing, baseline capture vs harness fix commits, and custom-`readyCommand` green+dirty abort on `full`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v1/docs/operator-runbook.md` — gate order; cross-link `v2/docs/v1-behaviors.md`; remove autofix-commit caveat if present.
- `v1/docs/worktrees-and-commits.md` — completion readiness; custom-`readyCommand` green+dirty abort on `full`.
- `v1/docs/config.md` — on `full`, harness fix before `readyCommand`; override verification-only.
- `v1/docs/run-loop.md` — completion-transition gate, retry semantics (no dirty-reuse), exit-6 classification.
- `v1/docs/workflows.md` — completion-gate narrative; cross-link or dedupe per documentation standard.
- `v1/docs/plan-mode.md` — ready-transition bullet.
- `v2/docs/v1-behaviors.md` — completion-gate, retry, triage gate path, recorded-green timing, baseline vs fix commits, review-baseline behavior.
