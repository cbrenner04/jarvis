---
name: triage-merge-recovers-local-ready-flakes-when-ci-green
---

# `triage --merge` recovers local ready flakes when CI is green at HEAD

## Problem

`jarvis1 triage <target> --merge` reruns the full local ready gate, then refuses to merge on any
red gate even when GitHub CI already passed for the same worktree HEAD. Known parallel-load and
timing flakes unrelated to the PR force repeated local reruns or manual `gh pr merge --admin`.

Observed on PR #821: CI green after the fixture fix; local `--merge` failed on
`run.sandbox-unrunnable.test.ts` and `triage-command.test.ts` under suite load.

## Desired behavior

When the local ready gate fails during `triage --merge`, evaluate whether recovery is safe before
aborting. If CI checks are green for the worktree HEAD sha and the failure is a recoverable flake
(parallel-load pattern or passing targeted reruns), continue the existing merge flow (mark ready if
draft, poll CI, admin-squash-merge) and report that flake recovery was used. If CI is not green at
HEAD or the failure is deterministic, refuse to merge with today's hard-gate behavior.

## Decisions

- Extend `triage --merge` only — rules out a new subcommand or `--force` bypass flag.
- Recovery requires green CI at worktree HEAD sha — rules out branch-latest check green while HEAD differs, and rules out bypassing a red local gate on CI alone under today's both-gates-hard contract.
- Recoverable flakes: parallel-load class (full serial suite retry or per-failing-test isolated rerun passes) — rules out bypass on first parallel red without rerun proof.
- Deterministic reds stay blocking: non-test gate steps, serially-reproducing test failures, and reruns that still fail — rules out blanket bypass whenever CI is green.
- Happy-path gate order unchanged when the first local gate passes — rules out always running recovery probes on green gates.
- Do not extend flake bypass to `triage --mark-ready` in this slice — rules out generalizing before merge recovery is proven.
- Deferred to first consumer: HEAD-sha CI fetch/query mechanism — pin when subspec is drafted.
- Deferred to first consumer: failing-test path extraction from gate stderr — pin when subspec is drafted.
- Deferred to first consumer: targeted-rerun granularity (file vs test name) and rerun cap — pin when subspec is drafted.

## Documentation updates

- `v2/docs/v1-behaviors.md` — flake-recovery trigger, HEAD-sha CI requirement, recoverable vs blocking failure classes, unchanged refusal when recovery conditions fail.

## Prerequisites

- `jarvis1 triage <target> --merge` runs the local ready gate then polls CI checks before admin-squash-merge and refuses merge on any local gate failure
- Ready gate test step retries a failed parallel `bun run test` serially once before declaring that step red
