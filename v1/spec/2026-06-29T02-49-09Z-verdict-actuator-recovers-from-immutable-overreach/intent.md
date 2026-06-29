---
name: verdict-actuator-recovers-from-immutable-overreach
---

# Verdict actuator recovers from immutable-file overreach

When a review verdict actuator produces valid allowed edits but also modifies an immutable copied input such as `intent.md`, Jarvis should preserve the useful pass instead of discarding it. If post-actuator validation fails only because immutable copied input changed, Jarvis reverts only that path, keeps the allowed spec/verdict edits, commits and pushes the review pass, and emits an operator-visible notice naming the reverted path and any verdict requirement left unapplied by that revert.

Other validation failures keep the current fail-the-pass behavior. This is a structural validation recovery, not a substitute for prompt instructions.

## Decisions

- Recover only immutable-copy overreach; reject unrelated validation failures — rules out blanket validation bypass.
- Revert the immutable path byte-for-byte before commit; do not ask the actuator to self-correct — rules out trusting fallback-agent instruction adherence.
- Emit a visible recovery notice with dropped verdict fallout when knowable — rules out silent loss of review intent.
- Cover plan review actuation and any patch review actuation path with immutable copied inputs — rules out a plan-only recovery guard.

## Documentation updates

- Update `v1/docs/plan-mode.md` with protected-file revert-and-continue behavior in review actuation.
- Update `v1/docs/operator-runbook.md` to remove the manual `intent.md` revert step from transient-killed plan recovery once this ships.
- Update `v2/docs/v1-behaviors.md` for the changed v1 review-actuator behavior.

## Prerequisites

- Plan review can produce an adjudicated verdict and invoke an actuator that validates edits before committing.
