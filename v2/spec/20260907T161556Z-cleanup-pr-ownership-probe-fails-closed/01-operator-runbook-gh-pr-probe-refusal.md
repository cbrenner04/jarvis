# Operator runbook gh PR-probe refusal

## Problem

`v2/docs/operator-runbook.md` documents `--abandon` PR-ownership gates for ready PRs and ambiguous ownership, and stale-reset pre-mutation refusals, but not refusal when `gh pr list` is unreachable. Operators in sandboxed agent sessions routinely hit false-negative `gh` failures and need recovery text that names reachability and sandbox bypass.

## Decision ledger

- Extend the existing `--abandon` PR-ownership gates section and the incomplete re-run pre-mutation refusal list; rules out a new top-level cleanup chapter.
- Name sandboxed callers as the dominant trigger and point recovery at running the command outside the agent sandbox; rules out prose that reads like "this branch has no PR".
- Record that stale-workspace reset shares the same unknown-ownership refusal before teardown; rules out documenting `--abandon` only.

## Task checklist

- Under `--abandon` PR-ownership gates, add unknown PR ownership when `gh pr list` fails: pre-mutation refusal, no retirement, stderr naming `gh` reachability and sandbox-off retry.
- Under incomplete re-run pre-mutation refusal, add the same unknown-ownership case for automatic stale reset.
- Cross-link the existing [Coding agents in sandbox](#coding-agents-in-sandbox) section for the `gh` false-negative pattern.

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` documents fail-closed `--abandon` and stale-reset refusal when `gh pr list` is unreachable, including sandboxed-caller recovery via running outside the agent sandbox.

## Documentation updates

- `v2/docs/operator-runbook.md` — `--abandon` PR-ownership gates, incomplete re-run pre-mutation refusal, sandbox cross-link.
