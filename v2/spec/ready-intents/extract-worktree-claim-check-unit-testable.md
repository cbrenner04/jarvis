---
name: extract-worktree-claim-check-unit-testable
---
# Extract Worktree Claim Check Unit Testable

# Extract the `worktree_claimed` admission check into a standalone unit-testable function

The `worktree_claimed` claim check repeated across `start`, `resume`, and
`revise` in `v2/src/daemon/daemon.ts` is inline registry-lookup logic inside
each handler closure, with no standalone unit coverage independent of a real
IPC round trip.

## Decision

Extract the `worktree_claimed` claim check into a standalone exported
function taking the ownership registry and key as explicit parameters, and
call it from `start`, `resume`, and `revise`. No behavior change. Add direct
unit tests against the extracted function; keep existing RPC-level tests
covering `start`/`resume`/`revise` wiring as-is.

## Documentation updates

- `v2/docs/daemon-host.md`: note the `worktree_claimed` admission check
  (`#admission-guards-for-start-resume-revise`) lives in a standalone
  exported function shared by `start`, `resume`, and `revise`.

## Prerequisites

- worktree_claimed rejection on start/resume/revise exists in v2/src/daemon/daemon.ts
