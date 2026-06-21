---
name: baseline-verify-preexisting-failure-blockers
---

# Verify "pre-existing failure" blocker claims against the base ref; handle snapshot churn

## Problem

The single biggest time sink driving Jarvis on a snapshot-heavy target repo (groceries-client):
on nearly every seed the patch agent ran the test suite *mid-work* — before finishing snapshot
updates — saw transient snapshot mismatches, and concluded there were "N pre-existing polling
failures … unrelated to my change … axios mocking issue." It then either raised a `## Blocker`
(halting the run) or ticked ACs while declaring the suite red. **Every time this was false:**
`main` was fully green and a fresh re-run after the agent finished passed 100%. The agent
reasoned off an intermediate state and invented a plausible-but-wrong root cause.

This degraded multi-subspec specs to single-subspec throughput (the run never advanced past the
falsely-blocked subspec) and was the dominant cost driver.

## Direction

The claim "these failures are pre-existing / unrelated to my change" is cheap to falsify against
a known-green baseline — the harness knows the base ref. Use what exists:

- **Validate the blocker claim.** When a blocker (or red verdict) cites pre-existing / unrelated /
  baseline failures, reproduce the cited failures on the base ref; if they don't reproduce there,
  reject the blocker (it's the agent's own churn) rather than halting the run.
- **Snapshot-awareness.** Treat outdated snapshots distinctly from real failures — e.g. run an
  update-snapshots pass + re-test before a "pre-existing failures" blocker is allowed to stand.
  (Target-repo-agnostic: the update command is project-detected/configured, not hardcoded.)
- **Reinforce in the rules.** The patch rules already get injected inline; add guidance that an
  intermediate red suite mid-edit is not evidence of pre-existing breakage, and not grounds for a
  blocker without base-ref confirmation.

## Out of scope

- Auto-*ticking* or auto-passing — a real regression must still block; this only rejects blocker
  claims that provably don't reproduce on the base ref.
- The gate's serial re-run of flaky failures — sibling concern, see
  [[flaky-tests-serial-retry-and-determinism]].

## Documentation updates

- `v2/docs/v1-behaviors.md` — record base-ref blocker validation + snapshot handling.
- `v1/src/modes/patch/rules.md` — the mid-edit-red guidance.

## References

- `v1/src/modes/patch/rules.md` — patch rules injected each iteration; where the agent-side
  guidance lands.
- `shared/spec-parser.ts` — blocker parsing; harness-side validation hooks here / in the patch
  iteration loop (`v1/src/modes/patch/iteration.ts`).
- `scripts/ready.ts` — base-ref test capture would reuse the existing test command machinery.
- groceries `redesign-fixups-report.md` §5.2 — source, with verbatim symptoms.
