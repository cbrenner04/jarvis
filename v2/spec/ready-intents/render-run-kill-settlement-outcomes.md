---
name: render-run-kill-settlement-outcomes
---

# Render run kill settlement outcomes honestly

## Prerequisites

- Plain kill signals recorded gate/verifier process groups before a bounded wait and returns a non-settling outcome with the durable row state and each surviving child PID with its current parent PID.
- Force kill durably settles the named active row despite unfinished quiescence and returns any surviving child PID with its current parent PID.
- A successful kill RPC outcome means the named row is durably `killed`.

## Primary implementation surface

- CLI: `jarvis run kill` outcome validation, output, and exit status in `v2/src/commands/run.ts`.

## Problem

The CLI discards the kill RPC result and unconditionally prints `killed <run-id>` with exit `0`, so operators cannot distinguish durable settlement from a run still blocked by a child.

## Behavior

- Plain `jarvis run kill <id>` exits non-zero and never prints `killed` when the daemon reports that the row remains live after the quiescence bound.
- The non-settling diagnostic names the row's durable state and every surviving child PID with its parent PID.
- `jarvis run kill --force <id>` prints `killed` only after durable force settlement and warns when an identified child may still survive.
- Malformed kill outcome envelopes fail closed as invalid daemon responses.

## Decision ledger

- Parse and render the daemon's settlement outcome instead of treating any response frame as success; rules out unconditional `killed` output after RPC acknowledgement.
- Send non-settling state and child diagnostics to stderr with exit `1`; rules out a success exit that automation can misread.
- Keep `killed <run-id>` for confirmed ordinary and force settlement; rules out changing the established success copy when the row is actually terminal.
- Emit a force-survivor warning without changing the successful force exit; rules out claiming force failed after it durably settled the row.
- Reject unknown or incomplete outcome shapes; rules out silently restoring acknowledgement-only behavior during daemon/CLI version skew.

## Acceptance criteria

- [ ] `v2/src/commands/run.test.ts` proves a non-settling plain kill exits `1`, emits the live row state plus child PID and PPID on stderr, and emits no `killed` stdout; it fails against the pre-fix unconditional success branch.
- [ ] `v2/src/commands/run.test.ts` proves a force-settled outcome exits `0`, prints `killed <run-id>`, and warns with the surviving child PID and PPID; it fails against the pre-fix message-free output.
- [ ] `v2/src/commands/run.test.ts` proves confirmed settlement keeps the existing `killed <run-id>` success output and malformed kill outcomes exit `1` without success output.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — update live workflow stopping and stale force-kill recovery with settlement guarantees and hung-child diagnostics.
- `v2/docs/write-behavior.md` — update the run-control CLI table with outcome-dependent output and exits.
- `v2/docs/v1-behaviors.md` — record honest CLI kill reporting and the force-survivor warning.
