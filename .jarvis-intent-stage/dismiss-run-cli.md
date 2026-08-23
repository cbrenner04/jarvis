---
name: dismiss-run-cli
---

# Dismiss Run CLI

## Primary implementation surface

`v2/src/commands/run.ts`

Unsplit rationale: The whole change is the `run dismiss`/`undismiss` subcommands and the `run list --all` flag on the run CLI module, all riding the already-landed daemon requests; there is no second module boundary to split across.

## Prerequisites

- A run carries a nullable durable dismissal timestamp that survives reopening the state store, with dismiss/undismiss run store operations that leave status, attempts, and workflow snapshot untouched.
- The daemon accepts run dismiss/undismiss requests, excludes dismissed runs from the default `list` projection, and includes them with `dismissedAt` under `includeDismissed: true`.

## Surface

CLI.

## Problem

- `jarvis run` has no dismiss action, so a dead terminal ad-hoc or entry run can only leave `jarvis run list` by aging past the terminal-retention window; the operator cannot shed a specific row.

## Behavior

- `jarvis run dismiss <run-id>` and `jarvis run undismiss <run-id>` record and clear the dismissal; `jarvis run list` omits dismissed runs and `--all` includes them with a trailing dismissed column.

## Decisions

- Ship dismissal as `run dismiss`/`undismiss` subcommands mirroring `pipeline dismiss`/`undismiss` argument and refusal conventions; rules out folding it into `jarvis cleanup`, which is worktree/spec teardown and is not addressed by run id.
- `--all` is the opt-in on `run list`, composable with the existing `--since` and dimension filters and reflected in `--json` output; rules out a separate `run list-dismissed` command.
- The human listing gains a trailing `dismissed`/`-` column under `--all` only, mirroring `pipeline list --all`; rules out changing the default listing's column set.
- Dismissing a live run succeeds and prints a stderr warning naming the run and its state, and does not stop it; rules out refusing, and rules out hiding a live run silently.
- Both subcommands print a one-line confirmation naming the run and exit non-zero printing the daemon's `reason` verbatim on an unknown id; rules out silent success and rules out a CLI-invented error message.

## Required verification

- A CLI test asserts `run dismiss <id>` issues the dismiss request and confirms, and that a subsequent `run list` omits the run while `run list --all` shows it with the trailing dismissed column; it fails against the pre-fix CLI.
- A CLI test asserts `run undismiss <id>` returns the run to default `run list` output.
- A CLI test asserts `run list --all --json` carries the dismissal timestamp.
- A CLI test asserts dismissing a live run exits zero with a stderr warning naming the run and its state.
- A CLI test asserts an unknown run id exits non-zero with the daemon `reason` on both subcommands.
- Command-tree and help-flag parity tests cover the two subcommands and the `--all` flag.

## Documentation updates

- `v2/docs/operator-runbook.md` — `run dismiss`/`undismiss`, that dismissal hides without deleting, `run list --all` to see dismissed runs, cross-linked to the pipeline-dismiss docs and the `pipeline-list-display-retention` seed.
- `v2/docs/write-behavior.md` — the `run dismiss|undismiss` grammar and the `run list --all` flag.
- `v2/docs/v1-behaviors.md` — `jarvis run list` no longer prints every retained run by default.
