---
name: dismiss-pipeline-cli
---

# Dismiss Pipeline CLI

## Prerequisites

- A pipeline carries a nullable durable dismissal timestamp that survives reopening the state store, with dismiss/undismiss store operations that leave stage records and derived state untouched.
- The daemon accepts `pipeline_dismiss` and `pipeline_undismiss`, excludes dismissed pipelines from the default `pipeline_list` projection, and includes them with `dismissedAt` under an explicit opt-in parameter.

## Surface

CLI.

## Problem

- `jarvis pipeline` has no dismiss action, so the only operator lever over a dead pipeline is `reject`, which changes lifecycle state and still lists the pipeline; `pipeline list` prints every stored pipeline with no way to narrow it.

## Behavior

- `jarvis pipeline dismiss <pipeline-id>` and `jarvis pipeline undismiss <pipeline-id>` record and clear the dismissal; `jarvis pipeline list` omits dismissed pipelines and `--all` includes them, marked as dismissed.

## Decisions

- Ship dismissal as `pipeline dismiss`/`undismiss` subcommands rather than folding it into `jarvis cleanup`; rules out the seed's alternative — cleanup is worktree/spec teardown and is not addressed by pipeline id.
- `--all` is the opt-in on `pipeline list`, composable with the existing `--since`/`--state` filters and reflected in `--json` output; rules out a separate `pipeline list-dismissed` command.
- Dismissing a `running` pipeline succeeds and prints a warning naming its live state; rules out refusing, and rules out hiding a live pipeline silently.
- Both subcommands print a one-line confirmation naming the pipeline and exit non-zero with the daemon's refusal on an unknown id; rules out silent success.

## Required verification

- A CLI test asserts `pipeline dismiss <id>` issues the dismiss request and confirms, and that a subsequent `pipeline list` omits the pipeline while `pipeline list --all` shows it marked dismissed; it fails against the pre-fix CLI.
- A CLI test asserts `pipeline undismiss <id>` returns the pipeline to default `pipeline list` output.
- A CLI test asserts dismissing a running pipeline succeeds with a warning naming its state.
- A CLI test asserts an unknown pipeline id exits non-zero with the daemon refusal on both subcommands.
- Command-tree and help-flag parity tests cover the two subcommands and the `--all` flag.

## Documentation updates

- `v2/docs/operator-runbook.md` — dismiss/undismiss, that dismissal hides without deleting, `pipeline list --all` to see dismissed pipelines, and a cross-link to the `pipeline-list-display-retention` seed.
- `v2/docs/write-behavior.md` — the `pipeline dismiss|undismiss` grammar and the `pipeline list --all` flag.
- `v2/docs/v1-behaviors.md` — `jarvis pipeline list` no longer prints every stored pipeline by default.
