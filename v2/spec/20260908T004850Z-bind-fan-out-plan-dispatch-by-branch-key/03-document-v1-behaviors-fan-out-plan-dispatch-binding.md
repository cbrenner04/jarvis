# Document v1-behaviors fan-out plan dispatch binding

## Problem

`v2/docs/v1-behaviors.md` records branch-scoped plan downstream-input resolution and at `:643` documents positional pairing of split branch keys with fan-out `{ results }` during recovery; it does not record branch-key-bound dispatch and recovery binding.

## Prerequisites

- `00-branch-key-fan-out-plan-result-binding` (behavior landed).

## Decision ledger

- Supersede the `:643` `[v2 additive]` positional pairing entry with `[v2 behavior change]` branch-key-bound fan-out plan `{ results }` dispatch and recovery binding; rules out leaving `:643` contradictory beside a new entry.

## Tasks

- Replace `v2/docs/v1-behaviors.md` `:643` with a `[v2 behavior change]` entry describing branch-key-bound fan-out plan `{ results }` dispatch and recovery binding (parallel `downstreamInputs[i]` / `results[i]` map, lane-key lookup), single-path `{ steps }` recovery for named lanes after branch-scoped resolution, and pre-dispatch mismatch refusal naming the affected lane and downstream input.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` `:643` records branch-key-bound fan-out plan dispatch and recovery binding under `[v2 behavior change]` with no remaining positional `branchKeys`/`results` index pairing for that behavior.

## Documentation updates

- None beyond the acceptance criterion above.
