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
- HEAD-sha CI green is required before any recovery probe — rules out branch-tip `gh pr checks`
  when worktree HEAD differs from the commit CI exercised, and rules out bypassing a red local
  gate on CI alone without rerun proof.
- HEAD-sha CI fetch: `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` (paginated until
  empty), owner/repo from `git remote get-url origin` in the worktree, sha from
  `git rev-parse HEAD` — rules out reusing branch-scoped `gh pr checks` for the recovery
  gate.
- Map check-run `conclusion` (null = pending) through the existing merge CI status sets in
  `classifyCiChecks` — rules out a parallel taxonomy.
- HEAD-sha CI fetch/transport failure is fail-closed for recovery (treat as not green) — rules
  out merging on local flake when commit checks cannot be verified.
- Blocking failures (no recovery): non-`ReadyCommandError` gate errors (`FixCommandError`,
  `PreReadyFixCommitError`, `PostVerificationCommitError`, push/commit dirty errors, etc.); any
  `ReadyCommandError` whose captured stderr lacks test-step failure markers (`ready: parallel test
  failed` or `ready: serial test failed`); gate stderr containing
  `ready: deadline exceeded` — rules out blanket bypass whenever branch CI is green.
- Recoverable class: `ReadyCommandError` with test-step failure markers above — rules out
  recovering typecheck/check/install/lint reds.
- Recovery probe order after recoverable class + HEAD-sha CI green: (1) one additional full
  serial `bun test` in the worktree (no `--parallel`); (2) if still non-zero, one targeted
  serial `bun test <file…>` for deduped failing file paths extracted from gate stderr — rules
  out targeted rerun before the second full-serial attempt and rules out bypass on first
  parallel red without rerun proof.
- Failing-file extraction parses gate-error captured stderr for bun `(fail)` / `at <path>:<line>`
  patterns; dedupe paths; cap at 8 files in one invocation — rules out per-test-name isolation,
  rules out rerunning unbounded per-file loops, and rules out targeted probe when extraction
  yields zero paths (probe 2 skipped; recovery fails).
- Recovery success requires a green probe (probe 1 or probe 2); either still red refuses merge
  with today's hard-gate stderr — rules out merging when reruns still fail.
- On recovery success: emit stdout
  `triage --merge: local ready flake recovered (CI green at HEAD); proceeding` then continue the
  existing merge flow unchanged (draft→ready when needed, branch CI poll, admin-squash) — rules
  out altering post-recovery merge mechanics or silent bypass.
- Post-recovery CI poll stays on branch `gh pr checks` as today — rules out re-specifying poll
  behavior in this slice.
- Extend `TriageGhRunner` with injectable `getChecksForSha?(sha: string)` (default: live
  `gh api` commit check-runs) — rules out untestable live `gh` in unit tests.
- Deferred to first consumer: operator-runbook merge-section wording — pin when an operator asks
  for runbook cross-link.

## Task checklist

- Add HEAD-sha CI fetch helper and wire `getChecksForSha` on `TriageGhRunner`.
- Add merge-time flake recovery evaluator (classify gate error, run probes, return proceed vs
  refuse).
- Wire into `triageMerge` after `triageRunReadyGate` failure only; preserve happy path when
  gate passes.
- Tests in `v1/test/triage-command.test.ts`: recovery proceeds on test flake + HEAD-sha CI green
  + serial probe green; refuses on non-test gate failure; refuses when HEAD-sha CI red; refuses
  when probes stay red; targeted file probe path when serial still red and stderr yields paths;
  preservation of existing `--merge` cases.
- Update `v2/docs/v1-behaviors.md` `--merge` entry per Documentation updates.

## Acceptance criteria

- [ ] When `triage --merge` local ready gate fails on a test-step-only `ReadyCommandError` and
      commit check-runs are green for worktree `HEAD`, an additional serial `bun test` probe that
      passes allows merge to complete (draft→ready when needed, CI poll, admin-squash) and stdout
      reports local ready flake recovery.
- [ ] When the serial probe still fails but gate stderr yields failing file paths, one targeted
      serial `bun test <paths…>` probe that passes allows the same merge completion and recovery
      stdout.
- [ ] When commit check-runs for worktree `HEAD` are not green (red, pending, empty, or fetch
      failure), `triage --merge` refuses merge on local gate failure with no recovery attempt.
- [ ] When the local gate fails on a non-test error (e.g. typecheck / fix / commit), `triage
      --merge` refuses merge with no recovery attempt even if HEAD-sha CI is green.
- [ ] When recovery probes (serial and targeted when applicable) still fail, `triage --merge`
      refuses merge with `ready gate failed` surfaced and no admin merge.
- [ ] When the first local ready gate passes, `triage --merge` runs no recovery probes and
      behavior matches the pre-change merge flow.
- [ ] `triage-command.test.ts` › `--merge with local gate failure refuses to merge` stays green
      (typecheck failure path unchanged).
- [ ] `triage-command.test.ts` › `--merge with green CI checks merges the PR` stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: extend the `triage --merge` entry with flake-recovery trigger (local
  gate red only), HEAD-sha commit check-runs requirement, recoverable vs blocking failure
  classes, probe order (serial then targeted files), recovery stdout line, and unchanged refusal
  when recovery conditions fail; note `--mark-ready` exclusion.
