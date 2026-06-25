# triage --mark-ready re-runs the gate and promotes on green

## Problem

Exit `10` (`ready-stuck-red`) strands correct work as a draft PR when the
completion ready gate flakes red. Recovery is fully manual: the operator re-runs
the gate in the worktree by hand, then `gh pr ready`. The north-star path
"operator verified green → mark ready" is owned by no command. Fold it into the
existing `triage` command instead of adding a subcommand.

## Decisions

- Recovery is a `--mark-ready` flag on the **named** `triage` form (`jarvis1 triage <worktree-name> --mark-ready`); the no-arg listing and the plain named drill-down stay read-only. — rules out running the gate on every drill-down, putting side effects on a read-only diagnostic.
- `--mark-ready` with no worktree name is a usage error. — rules out applying recovery to the read-only no-arg listing.
- `--mark-ready` is a **guarding wrapper**, not a thin reuse: it runs its own pre-checks before invoking the completion ready seam, because the seam's defaults (throw on no-PR, silent return on incomplete, `gh pr ready` with no draft-state check) do not provide them. — rules out delegating the guards to the seam and inheriting a crash / silent no-op / incorrect promotion.
- Pre-check order before invoking the gate: (a) PR exists; (b) PR is in **DRAFT**; (c) spec complete (all linked subspecs checked). Any failing pre-check → report and exit without calling the gate or `gh pr ready`. — promote-only-when-DRAFT covers MERGED/CLOSED/already-open uniformly; the already-ready guard has no existing source and must be added, read from the PR's draft state.
- Re-run the gate once via the same completion ready path used at run completion (`runReadyGateWithTier`/`maybeMarkReady`) with **no** recorded-green carrier, so it runs the whole `full` gate. — rules out reusing the `readyGateRetryBound` retry loop (out of scope; the operator already verified green).
- **Green path mutates and pushes the operator's branch.** The `full`-tier ready path runs `git add -A`, commits, and pushes when the tree is dirty after fix-up; the intent's premise (operator already verified green by hand) plausibly leaves a dirty tree, so this fires. Decision: **disclose-and-accept** — recovery commits and pushes exactly as run completion does, and this is recorded in `v1-behaviors.md`. — rules out silently mutating the branch undocumented, and rules out refusing on a dirty tree (would defeat the recovery the operator wants).
- Catch **all** gate failure modes — command failure, fix-commit failure, fix-push failure, and "still dirty — do not promote" — and map each to report-captured-text + non-zero exit, leaving the PR draft. "Red" = any gate failure mode. — rules out assuming a single failure string and mishandling the other raised failures.
- Resolve the project/config key from the worktree name (worktree → branch → registered project), then thread that project's `readyCommand` override to the gate re-run. — the drill-down path receives no config today; rules out hard-coding `bun run ready` and diverging from the run-completion gate.
- `.active-spec-path` edge cases: (a) marker absent (pre-marker worktree) → report and exit, do not crash; (b) non-index / single-file spec (zero linked subspecs) → treat as complete (no unchecked subspecs to block), do not read it as perpetually-incomplete. — rules out crashing on stale worktrees and never-promoting valid single-file specs.
- Refuse when the worktree is locked by a live run PID (triage is already lock-aware); report and exit without mutating. — rules out a mutate-and-push clashing with a concurrent `jarvis run` holding the worktree.

## Task checklist

- Parse `--mark-ready` for the named `triage` form in `v1/src/cli.ts`; reject the flag with no worktree name as a usage error; dispatch the named form to the triage command.
- Implement the recovery in `v1/src/commands/triage.ts`: resolve the worktree's branch, project/config key, spec path (`.active-spec-path`), and PR; refuse if locked by a live PID; run pre-checks (PR exists, PR DRAFT, spec complete) before the gate; re-run the gate once against the worktree; on green mark the PR ready; on any gate failure mode report captured text and leave draft.
- Add the already-ready (not-DRAFT) guard from the PR's draft state.
- Handle `.active-spec-path` absent (report, no crash) and single-file/non-index specs (zero subspecs = complete).
- Resolve the project/config key from the worktree name and thread the per-project `readyCommand` to the gate re-run.
- Tests for green→ready (incl. dirty-tree commit+push), red→draft+non-zero across failure modes, no-PR / incomplete / already-ready / missing-marker / locked no-op, flag-without-name usage error, and read-only forms unchanged.
- Docs (see below).

## Acceptance criteria

- [x] `jarvis1 triage <worktree-name> --mark-ready` re-runs the completion ready gate once against that worktree and, on green, flips its draft PR to ready and exits 0.
- [x] On green with a dirty tree after fix-up, `--mark-ready` commits (`git add -A`) and pushes the branch before marking ready, matching run completion.
- [x] On a red gate — any failure mode (command failure, fix-commit failure, fix-push failure, still-dirty) — `--mark-ready` leaves the PR draft, prints the captured failure text, and exits non-zero.
- [x] `--mark-ready` uses a per-project `readyCommand` override (when configured) instead of `bun run ready`.
- [x] `--mark-ready` reports and does not call the gate or `gh pr ready` when the worktree has no PR, the PR is not in DRAFT (already ready, merged, or closed), the spec's linked subspecs are incomplete, the `.active-spec-path` marker is absent, or the worktree is locked by a live run.
- [x] A single-file / non-index spec (zero linked subspecs) counts as complete and is promotable.
- [x] `jarvis1 triage --mark-ready` with no worktree name exits non-zero with a usage error.
- [x] `v1/test/triage-command.test.ts` existing listing and drill-down tests stay green — the no-arg listing and the plain named drill-down run no gate and mutate no PR.
- [x] `jarvis1 triage --help` / the triage usage string lists the `--mark-ready` flag.

## Documentation updates

- [x] `v1/docs/run-loop.md`: the exit-10 (`ready-stuck-red`) section names `jarvis1 triage <worktree-name> --mark-ready` as the recovery that re-runs the gate and promotes on green.
- [x] `v1/docs/operator-runbook.md`: the stuck-red (exit 10) recovery step names the `triage --mark-ready` path alongside the existing rerun-`jarvis1 run` path.
- [x] `v2/docs/v1-behaviors.md`: record the `triage --mark-ready` behavior — gate re-run; green→ready including the **commit-and-push** of a dirty tree (same side effect as run completion); red→draft+non-zero across all gate failure modes; no-op guards (no-PR, not-DRAFT, incomplete spec, missing marker, locked); single-file spec promotable; `readyCommand` honored — and that the read-only triage forms are unchanged.
