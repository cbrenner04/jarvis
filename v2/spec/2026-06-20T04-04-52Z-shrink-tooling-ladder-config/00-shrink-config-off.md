# `modes.patch.shrink` config and off switch

Add the `modes.patch.shrink` config key and wire its `off` value to skip the
post-completion shrink phase entirely. The ladder semantics of the other values
(`tooling`, `agent`, `both`) land in `01`; this subspec only parses/validates the
field and makes `off` a no-phase, leaving every non-`off` value on the existing
agent-shrink behavior.

## Problem

`modes.review.passes: 0` skips review but there is no config to skip shrink.
Shrink runs whenever `git: true` and at least one implementation iteration ran
(`v1/src/modes/patch/run.ts` `shouldRunShrink`).

## Decisions

- Field is `modes.patch.shrink` on `ModeConfig`, values `off | tooling | agent | both`, default `both`. Rules out reusing `modes.review.passes` or a boolean to express four paths.
- Default `both` preserves today's agent-shrink behavior as the baseline. Rules out defaulting to `off` and silently dropping shrink on existing configs.
- `off` makes `shouldRunShrink` false so the phase (pre-shrink ready gate, agent, telemetry) never runs. Rules out entering `runPatchShrinkPhase` and early-returning inside it, which would still fire the pre-shrink gate.
- Invalid values fail config validation with a named error, consistent with `prNarrative`. Rules out silently coercing unknown strings to a default.

## Task checklist

- [ ] Add `shrink?: "off" | "tooling" | "agent" | "both"` to `ModeConfig` and default `both` in `DEFAULT_CONFIG.modes.patch`.
- [ ] Validate `modes.patch.shrink` (reuse the `prNarrative`-style validator pattern); reject unknown strings with a named error.
- [ ] Gate `shouldRunShrink` on the resolved value: `off` ⇒ phase does not run.
- [ ] Docs per below.

## Acceptance criteria

- [ ] A config with `modes.patch.shrink` set to any of `off`, `tooling`, `agent`, `both` loads successfully; an unknown value fails validation with a message naming `modes.patch.shrink`.
- [ ] A config omitting `modes.patch.shrink` resolves to `both`.
- [ ] With `modes.patch.shrink: "off"` and an otherwise shrink-eligible completion (`git: true`, ≥1 implementation iteration), the shrink phase does not run: no pre-shrink ready gate fires and no `patch_phase: "shrink"` telemetry row is emitted.
- [ ] With `modes.patch.shrink: "off"`, review placement and `maybeMarkReady` are unchanged from a run with shrink disabled by other means (review still runs when `modes.review.passes > 0`).
- [ ] With the default (`both`) and a shrink-eligible completion, the existing agent-shrink behavior runs as before this change.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/config.md`: document `modes.patch.shrink`, its four values, default `both`, and `off` inner-loop guidance (skip shrink during fast inner-loop runs).
- `v1/docs/run-loop.md`: note `off` skips the shrink phase entirely without affecting review placement.
- `v2/docs/v1-behaviors.md`: record the new config field, default, and `off` skip behavior in the post-completion shrink section.
