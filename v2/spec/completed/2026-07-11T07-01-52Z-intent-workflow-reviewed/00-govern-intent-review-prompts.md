# Govern intent review prompts

Add intent-owned critic and actuator context to the shared prompt registry.

## Decisions

- Register `intent.prompt.review` and `intent.prompt.review-actuator`; rules out reusing plan-review artifacts whose artifact and editing contracts target specs.
- Layer intent review instructions through the shared registry; rules out embedding stable review prose in the workflow builder.
- Render the actuator prompt with the critic verdict unchanged in an enforced delimited data slot; rules out generic review's verdict-only actuator prompt.
- State critic read-only and actuator `.jarvis-intent-stage/`-only obligations in the governed prompts; rules out granting either role worktree-wide authority.

## Tasks

- Add the critic prompt for reviewing staged ready-intents and emitting a verdict.
- Add the actuator prompt that composes its staging boundary with the unchanged verdict.
- Extend registry and rendered-output coverage for both artifacts.

## Acceptance criteria

- [x] The prompt registry resolves `intent.prompt.review` and `intent.prompt.review-actuator` with valid governed metadata.
- [x] Rendered prompt coverage pins the critic's read-only staged-intent/verdict contract and the actuator's staging-only boundary plus unchanged delimited verdict.
- [x] `v1/docs/prompt-governance.md` lists both prompt IDs and their ownership.
- [x] `v2/docs/prompts.md` documents their intent-specific layering and runtime ownership.
- [x] `v2/docs/write-behavior.md` distinguishes the intent-specific composed actuator prompt from generic review's verdict-only contract and cross-links runtime isolation enforcement.

## Documentation updates

- Update `v1/docs/prompt-governance.md` with both governed artifacts.
- Update `v2/docs/prompts.md` with intent review ownership and layering.
- Update `v2/docs/write-behavior.md` with intent-specific prompt composition and isolation obligations.
