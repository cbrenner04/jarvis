# `modes.patch.shrink` config and off switch

Add the `modes.patch.shrink` config key and wire its `off` value to skip the
post-completion shrink phase entirely. Values are `off | agent`; `agent` keeps
the existing agent-shrink behavior, `off` makes the phase a no-op. The
no-file-change contract-test skip lands in `01`.

## Problem

`modes.review.passes: 0` skips review but there is no config to skip shrink.
Shrink runs whenever `git: true` and at least one implementation iteration ran
(`v1/src/modes/patch/run.ts` `shouldRunShrink`).

## Decisions

- Field is `modes.patch.shrink` on `ModeConfig`, values `off | agent`, default `agent`. Rules out reusing `modes.review.passes` or a boolean buried elsewhere to express the switch.
- Default `agent` preserves today's agent-shrink behavior as the baseline. Rules out defaulting to `off` and silently dropping shrink on existing configs.
- `off` makes `shouldRunShrink` false so the phase (pre-shrink ready gate, agent, telemetry) never runs. Rules out entering `runPatchShrinkPhase` and early-returning inside it, which would still fire the pre-shrink gate.
- Invalid values fail config validation with a named error, consistent with `prNarrative`. Rules out silently coercing unknown strings to a default.

## Task checklist

- [x] Add `shrink?: "off" | "agent"` to `ModeConfig` and default `agent` in `DEFAULT_CONFIG.modes.patch`.
- [x] Validate `modes.patch.shrink` (reuse the `prNarrative`-style validator pattern); reject unknown strings with a named error.
- [x] Gate `shouldRunShrink` on the resolved value: `off` ⇒ phase does not run.
- [x] Docs per below.

## Acceptance criteria

- [x] A config with `modes.patch.shrink` set to `off` or `agent` loads successfully; an unknown value fails validation with a message naming `modes.patch.shrink`.
- [x] A config omitting `modes.patch.shrink` resolves to `agent`.
- [x] With `modes.patch.shrink: "off"` and an otherwise shrink-eligible completion (`git: true`, ≥1 implementation iteration), the shrink phase does not run: no pre-shrink ready gate fires and no `patch_phase: "shrink"` telemetry row is emitted.
- [x] With `modes.patch.shrink: "off"`, review placement and `maybeMarkReady` are unchanged from a run with shrink disabled by other means (review still runs when `modes.review.passes > 0`).
- [x] With the default (`agent`) and a shrink-eligible completion, the existing agent-shrink behavior runs as before this change.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/config.md`: document `modes.patch.shrink`, its `off | agent` values, default `agent`, and `off` inner-loop guidance (skip shrink during fast inner-loop runs).
- `v1/docs/run-loop.md`: note `off` skips the shrink phase entirely without affecting review placement.
- `v2/docs/v1-behaviors.md`: record the new config field, default, and `off` skip behavior in the post-completion shrink section.
