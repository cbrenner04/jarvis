# Dispatch named workflow presets

Replace the implement-only CLI branch with generic preset lookup while preserving the shipped implement workflow contract.

## Decisions

- The preset registry maps names to builders kept in separate modules; rule out constructing preset steps inside the registry — wiring stays independent of builder behavior.
- Register only `implement`; rule out placeholder `intent` or `plan` entries — no builders exist for them.
- Missing and unknown names use workflow-level usage; rule out falling through to general `run` usage — preset selection fails at the workflow boundary.

## Scope

- Add name-to-builder preset dispatch for `jarvis run workflow <name> [flags]`.
- Preserve the implement parser, builder inputs/results, daemon request, stdout, daemon errors, and exit behavior.
- Reject missing and unknown preset names before opening an IPC connection.
- Keep builder failures unchanged and pre-IPC.
- Update the durable CLI contract and v2 behavior catalog.
- Do not add builders, presets, daemon auto-start, or project review defaults.

## Acceptance criteria

- [ ] `v2/src/cli.test.ts` implement workflow dispatch tests stay green through the preset registry, including the unchanged builder input, `{ steps }` daemon request, run-ID output, and daemon errors.
- [ ] Missing or unknown workflow preset names print workflow usage, exit `1`, and do not contact the daemon.
- [ ] An `implement` builder failure is printed unchanged, exits `1`, and does not contact the daemon.
- [ ] Only `implement` is a registered workflow preset.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with generic workflow selection, registered presets, usage/error timing, and the preserved implement launch contract.
- Update `v2/docs/v1-behaviors.md` with the revised v2 additive CLI behavior and source citations.
- Do not update `v2/docs/onboarding.md`; this change does not alter v2 readiness.
