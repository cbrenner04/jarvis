---
name: daemon-stop-refuses-active-runs
---

# Daemon stop refuses active runs

`jarvis daemon stop` currently shuts down the daemon while durable work is non-terminal, silently destroying in-flight iterations.

## Prerequisites

## Behavior

- Refuse a normal stop when any durable run is non-terminal, exit non-zero, and print every blocking run ID.
- Accept `jarvis daemon stop --force` to perform the intentional destructive stop.

## Decisions

- Guard on durable non-terminal rows, not only in-memory live loops; rules out missing queued or temporarily non-live work.
- Require an explicit `--force` bypass; rules out removing emergency shutdown or prompting in automation.

## Out of scope

- Restarting or resuming runs after a forced stop.
- Removing the need to restart after a v2 merge.

## Documentation updates

- Update `v2/docs/daemon-host.md` with the guarded stop contract.
- Update the `v2/docs/write-behavior.md` daemon CLI table and syntax without duplicating the host contract.
