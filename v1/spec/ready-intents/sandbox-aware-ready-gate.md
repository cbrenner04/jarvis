---
name: sandbox-aware-ready-gate
---

# Make `bun run ready` sandbox-aware so it stops needing a blanket bypass

## Problem

`bun run ready` must currently run entirely sandbox-off because its test step
spawns subprocess-spawning tests the sandbox blocks. Every local gate run
(operator finalize, contention re-run) drops the sandbox for the whole suite,
not just the ~20 tests that need it.

## Direction

Detect a sandboxed run. When sandboxed, run the sandbox-safe suite in-sandbox,
then handle the subprocess-spawning subset specially — either auto-escalate only
that subset outside the sandbox, or skip it with a loud notice that defers its
coverage to CI. Pick one approach. Unsandboxed runs (CI, sandbox-off) keep
running the complete suite unchanged.

If the chosen approach skips the subset locally, the pre-merge net must stay
honest: admin-merge safety still requires green CI on the unrunnable subset, not
a silent skip.

## Prerequisites

- `bun run test` excludes the subprocess-spawning tests and a separate target runs only that subset.

## Documentation updates

- `v1/docs/operator-runbook.md` — § "The gate" and § "Sandbox blindness and
  false-negatives": replace "run `ready` sandbox-off, full stop" with the new
  sandbox-aware flow.
- `v2/docs/v1-behaviors.md` — record the new sandbox-aware `ready` behavior.
