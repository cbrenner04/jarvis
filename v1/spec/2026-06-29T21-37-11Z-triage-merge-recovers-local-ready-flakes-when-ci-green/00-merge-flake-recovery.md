# 00 - Merge flake recovery when local gate red and HEAD-sha CI green

## Problem

`jarvis1 triage <target> --merge` hard-aborts on any local ready gate failure even when GitHub
CI already passed for the same worktree HEAD and the red is a parallel-load test flake (PR #821:
`run.sandbox-unrunnable.test.ts`, `triage-command.test.ts` under suite load). Operators rerun
manually or `gh pr merge --admin`.

## Prerequisites

- Gated `jarvis1 triage <target> --merge` pipeline (ready gate → optional `gh pr ready` → CI poll
  → admin-squash) with injectable `TriageGhRunner` / `runGate` seams — observable in
  `v1/src/commands/triage.ts` and `v1/test/triage-command.test.ts`.
- Ready gate test step retries failed parallel `bun run test` serially once before declaring red —
  observable in `scripts/ready.ts` and `v2/docs/v1-behaviors.md`.

## Decisions

- Scope is `triage --merge` only — rules out a new subcommand, `--force`, or `--mark-ready`
  flake bypass.
- Recovery runs only after the completion ready gate returns an error — rules out skipping the
  gate or probing when the first gate pass succeeds.
- Recovery eligibility is typed: only `ReadyCommandError` whose captured stderr includes harness
  test-step markers (`ready: parallel test failed` or `ready: serial test failed`) enters recovery
  — rules out message-substring classification on generic `Error`, `FixCommandError`, push/commit
  dirty errors, and other non-`ReadyCommandError` throws even when stderr text mimics test failures.
- Custom `readyCommand` override produces `ReadyCommandError` without harness markers → no recovery
  — rules out flake bypass for non-`scripts/ready.ts` verification commands.
- HEAD-sha CI green is required before any recovery probe — rules out branch-tip `gh pr checks`
  when worktree HEAD differs from the commit CI exercised, and rules out bypassing a red local
  gate on CI alone without rerun proof.
- Owner/repo for HEAD-sha fetch: parse worktree `origin` via existing `normalizeRepoUrl`; derive
  `owner`/`repo` from the normalized `github.com/{owner}/{repo}` slug — rules out ad-hoc URL
  parsing and rules out recovery when parse fails (fail-closed, same as fetch failure).
- HEAD-sha CI fetch: `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` (paginated until
  empty), sha from `git rev-parse HEAD` — rules out reusing branch-scoped `gh pr checks` for the
  recovery gate.
- Check-run adapter maps GitHub API `status` + `conclusion` into `CiCheckState[]` before calling
  existing `classifyCiChecks` — rules out passing raw API shapes into `classifyCiChecks` and rules
  out a parallel taxonomy: `completed` + `success`/`skipped`/`neutral` → green statuses;
  `completed` + failure conclusions (`failure`, `cancelled`, `timed_out`, `startup_failure`, …) →
  red; `queued`/`in_progress` or `completed` with null `conclusion` → pending.
- HEAD-sha CI fetch/transport failure or unusable adapter output is fail-closed for recovery
  (treat as not green) — rules out merging on local flake when commit checks cannot be verified.
- Blocking failures (no recovery): any non-`ReadyCommandError`; `ReadyCommandError` lacking harness
  test-step markers (e.g. lint/check/custom ready command); gate stderr containing substring
  `ready: deadline exceeded`; probe non-zero exit from signal/timeout (codes 124, 130, 143 per
  `isGenuineTestFailure`) — rules out treating gate timeout or probe signal kills as recoverable
  flakes.
- Recoverable class: typed `ReadyCommandError` with harness test-step markers above and no deadline
  substring — rules out recovering typecheck/check/install/lint reds.
- Recovery probes mirror the gate serial test step: worktree `cwd`, `bun test` (not `bun run
  test`), same preload/setup as the gate; no ready-gate deadline on probes — rules out
  `bun run test` probes and rules out deadline-budget kills mid-probe.
- Recovery probe order after recoverable class + HEAD-sha CI green: (1) one additional full serial
  `bun test`; (2) if still non-zero, one targeted serial `bun test <file…>` for deduped failing
  file paths extracted from gate stderr — rules out targeted rerun before the second full-serial
  attempt and rules out bypass on first parallel red without rerun proof.
- Failing-file extraction: before implementation, anchor `(fail)` / `at <path>:<line>` regexes
  against captured stderr from a real failing gate run (fixture or recorded sample in test);
  traverse stderr in order, dedupe paths, cap at 8 first-seen files in one probe-2 invocation —
  rules out per-test-name isolation, rules out unbounded per-file loops, and rules out probe 2
  when extraction yields zero paths (recovery fails).
- Recovery success requires a green probe (probe 1 or probe 2); either still red refuses merge
  with today's hard-gate stderr — rules out merging when reruns still fail.
- On recovery success: emit stdout exactly
  `triage --merge: local ready flake recovered (CI green at HEAD); proceeding` then continue the
  existing merge flow unchanged (draft→ready when needed, branch CI poll, admin-squash) — rules
  out altering post-recovery merge mechanics or silent bypass.
- Post-recovery CI poll stays on branch `gh pr checks` as today — recovery may proceed on
  HEAD-sha green then abort if branch poll is red; rules out re-specifying poll behavior in this
  slice.
- Extend `TriageGhRunner` with injectable `getChecksForSha?(sha: string)` (default: live `gh api`
  commit check-runs + adapter) — rules out untestable live `gh` in unit tests.
- Extend `TriageCommandOptions` with injectable `runRecoveryProbe?(cwd: string, args: string[]):
  number` (default: live serial `bun test` in worktree cwd) — rules out live `bun test` in unit
  tests for recovery probe paths.
- Deferred to first consumer: operator-runbook merge-section wording — pin when an operator asks
  for runbook cross-link.

## Task checklist

- Add check-run → `CiCheckState[]` adapter and HEAD-sha CI fetch helper; wire `getChecksForSha` on
  `TriageGhRunner` with `normalizeRepoUrl` owner/repo resolution.
- Add merge-time flake recovery evaluator (typed gate-error classification, probes, return proceed
  vs refuse); wire `runRecoveryProbe` default.
- Wire into `triageMerge` after `triageRunReadyGate` failure only; preserve happy path when gate
  passes.
- During implementation, anchor failing-file extraction regexes against a real captured gate stderr
  sample; commit fixture or inline sample in test.
- Tests in `v1/test/triage-command.test.ts` via injected `runGate`, `getChecksForSha`, and
  `runRecoveryProbe`: recovery proceeds on test flake + HEAD-sha CI green + serial probe green
  (assert exact recovery stdout); refuses on `FixCommandError`; refuses on generic `Error` even
  with test-like message; refuses when HEAD-sha CI red; refuses when `getChecksForSha` throws or
  returns unusable data; refuses when stderr contains `ready: deadline exceeded`; refuses when
  `ReadyCommandError` lacks harness test markers; refuses when probe 1 red and extraction yields
  zero paths; targeted file probe when serial still red and stderr yields paths; refuses when
  probes stay red; preservation of existing `--merge` cases.
- Update `v2/docs/v1-behaviors.md` `--merge` entry per Documentation updates.

## Acceptance criteria

- [ ] When `triage --merge` local ready gate fails on a typed `ReadyCommandError` with harness
      test-step markers and commit check-runs are green for worktree `HEAD`, an additional serial
      `bun test` probe that passes allows merge to complete (draft→ready when needed, CI poll,
      admin-squash) and stdout includes exactly
      `triage --merge: local ready flake recovered (CI green at HEAD); proceeding`.
- [ ] When the serial probe still fails but gate stderr yields failing file paths, one targeted
      serial `bun test <paths…>` probe that passes allows the same merge completion and the exact
      recovery stdout line above.
- [ ] When commit check-runs for worktree `HEAD` are not green (red, pending, empty, fetch
      failure, or `getChecksForSha` throw/unusable data), `triage --merge` refuses merge on local
      gate failure with no recovery attempt.
- [ ] When the local gate throws `FixCommandError`, `triage --merge` refuses merge with no
      recovery attempt even if HEAD-sha CI is green.
- [ ] When the local gate throws a generic `Error` whose message mimics test failure text,
      `triage --merge` refuses merge with no recovery attempt even if HEAD-sha CI is green.
- [ ] When gate stderr contains substring `ready: deadline exceeded`, or `ReadyCommandError` lacks
      harness test-step markers (e.g. lint/check failure or custom `readyCommand`), `triage
      --merge` refuses merge with no recovery attempt even if HEAD-sha CI is green.
- [ ] When probe 1 stays red and failing-file extraction yields zero paths, `triage --merge`
      refuses merge with no probe 2 and no recovery.
- [ ] When recovery probes (serial and targeted when applicable) still fail, or a probe exits with
      signal/timeout codes (124/130/143), `triage --merge` refuses merge with `ready gate failed`
      surfaced and no admin merge.
- [ ] When the first local ready gate passes, `triage --merge` runs no recovery probes and
      behavior matches the pre-change merge flow.
- [ ] `triage-command.test.ts` › `--merge with local gate failure refuses to merge` stays green
      (typecheck failure path unchanged).
- [ ] `triage-command.test.ts` › `--merge with green CI checks merges the PR` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: extend the `triage --merge` entry with flake-recovery trigger (local
  gate red only), typed recoverable class (harness test-step markers on built-in ready gate only;
  custom `readyCommand` blocks recovery), HEAD-sha commit check-runs requirement and adapter,
  blocking subclasses (non-test errors, deadline substring, signal/timeout probe exits, probe
  still red), probe contract (serial `bun test`, no gate deadline), probe order (full serial then
  targeted files), exact recovery stdout line, dual-CI edge case (recovery gates on HEAD-sha
  check-runs; post-recovery poll remains branch `gh pr checks` and may still abort), unchanged
  refusal when recovery conditions fail, and `--mark-ready` exclusion.
