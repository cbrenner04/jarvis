# 01 - Durable docs for scoped ready-gate autofix

## Problem

Operator and parity docs still describe built-in ready-gate repair autofix as configured `fixCommand` or repo-wide `bun run fix`, without scoping, raised diagnostic limits, or the out-of-diff settlement contract aligned with `ready_gate_out_of_scope` on the test step.

## Decision ledger

- Update each durable home once; cross-link between operator-runbook and write-behavior rather than duplicating full seam prose; rules out leaving stale repo-wide autofix wording in any listed doc.
- Document built-in vs configured `fixCommand` split: scoping applies to the built-in biome path only until a caller pins configured-command behavior; rules out claiming all autofix invocations are scoped today.
- On success, built-in scoped autofix does not surface or settle on untouched out-of-diff pre-existing findings — settlement isolation only, not `ready_gate_out_of_scope`-style path naming; rules out operators expecting visible acknowledgment of ignored out-of-diff lint after a green autofix.

## Prerequisites

- Subspec 00 lands scoped built-in ready-gate repair autofix in `publishWithReadyRepair`.

## Work

- Revise `v2/docs/operator-runbook.md` § Autofix, bounded repair, and settlement (~439): built-in autofix runs scoped `biome check --write --unsafe` on changed paths with raised `--max-diagnostics`; out-of-diff pre-existing findings do not strand `completion_commit_failed` and are not surfaced on successful autofix; configured `fixCommand` unchanged.
- Revise `v2/docs/write-behavior.md` ready-gate repair autofix paragraph (~108): built-in path scopes to changed paths; distinct from completion-commit scoped format and from configured `fixCommand`.
- Add or revise `v2/docs/v1-behaviors.md` parity entry for scoped built-in ready-gate repair autofix (v2 additive; contrast v1 `runReadyAndCommit` repo-wide autofix).

## Acceptance criteria

- [x] `v2/docs/operator-runbook.md` § Autofix, bounded repair, and settlement documents scoped built-in autofix on changed paths, raised `--max-diagnostics` on autofix biome, that out-of-diff pre-existing findings do not settle `completion_commit_failed` for built-in autofix, and that successful built-in autofix does not surface or name untouched out-of-diff pre-existing findings.
- [x] `v2/docs/write-behavior.md` ready-gate repair autofix paragraph documents built-in scoping to changed paths and distinguishes it from completion-commit scoped format and configured `fixCommand`.
- [x] `v2/docs/v1-behaviors.md` records v2 built-in ready-gate repair autofix scoping to changed paths with raised diagnostic limit as the current parity baseline.

## Documentation updates

- `v2/docs/operator-runbook.md` — scoped built-in autofix, diagnostic surfacing, out-of-diff settlement isolation, success-path non-surfacing.
- `v2/docs/write-behavior.md` — built-in ready-gate repair autofix scoping; distinction from completion-commit format.
- `v2/docs/v1-behaviors.md` — v2 scoped ready-gate repair autofix parity baseline.
