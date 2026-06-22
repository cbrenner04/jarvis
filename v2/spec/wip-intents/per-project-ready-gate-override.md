---
name: per-project-ready-gate-override
---

# Per-project override for the completion ready gate (custom command or skip)

## Problem

The patch completion ready gate hardcodes `bun run ready`. Target repos that lack a `ready` script
fail this gate every time, sending the agent into destructive fix-up flailing it can never resolve.
There is no way to point the gate at a repo's actual verification command, or to opt a gateless repo
out of the gate.

## Direction

Let a repo configure how the completion ready gate runs — supply an alternate gate command, or skip
the gate — without changing the default `bun run ready` behavior for repos that don't configure it.
Bind to the existing config; keep it opt-in and default-off.

## Open questions (for plan to decide)

- Config shape and where it lives: per-project, a global patch-mode default, or both — and the
  precedence if both are set.
- **Skip semantics**: if the gate is skipped, is the PR still marked ready? What happens to the
  `check:fix` commit and the fix-up loop? (A skip that still flips the PR to ready relaxes the
  "ready means verified" invariant — call that out and decide deliberately.)
- Which ready-gate call sites the override applies to (completion transition, pre-shrink, review
  baseline/final, `maybeMarkReady`).
- Validation rules for the new config.

## Out of scope

- Plan-mode gate behavior.
- Changing default `bun run ready` for repos that don't set the override.

## References

- `v1/src/ready-gate.ts` (`runReadyAndCommit`, `runReadyGateWithTier`) — the gate.
- `v1/src/modes/patch/*` — ready-gate call sites.
- `v1/src/config.ts` — config validation + per-project / mode config.
- Experiment: the same idea was hand-authored out-of-band as PR #421; this seed runs it through the
  normal seed→plan→run pipeline so the two final PRs can be compared.
