# Govern intent review prompts

Add intent-owned critic and actuator context to the shared prompt registry.

## Decisions

- Register `intent.prompt.review` and `intent.prompt.review-actuator`; rules out reusing plan-review artifacts whose artifact and editing contracts target specs.
- Layer intent review instructions through the shared registry; rules out embedding stable review prose in the workflow builder.

## Tasks

- Add the critic prompt for reviewing staged ready-intents and emitting a verdict.
- Add the actuator-context prompt for applying that verdict only within staged intent output.
- Extend registry and rendered-output coverage for both artifacts.

## Acceptance criteria

- [ ] The prompt registry resolves `intent.prompt.review` and `intent.prompt.review-actuator` with valid governed metadata.
- [ ] Rendered prompt coverage pins the critic's staged-intent/verdict contract and the actuator's staged-output editing boundary.
- [ ] `v1/docs/prompt-governance.md` lists both prompt IDs and their ownership.
- [ ] `v2/docs/prompts.md` documents their intent-specific layering and runtime ownership.

## Documentation updates

- Update `v1/docs/prompt-governance.md` with both governed artifacts.
- Update `v2/docs/prompts.md` with intent review ownership and layering.
