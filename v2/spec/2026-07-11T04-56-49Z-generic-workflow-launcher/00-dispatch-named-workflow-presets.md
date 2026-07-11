# Dispatch named workflow presets

Replace the implement-only CLI branch with generic preset lookup while preserving the shipped implement workflow contract.

## Decisions

- The preset registry maps names to builders kept in separate modules; rule out constructing preset steps inside the registry — wiring stays independent of builder behavior.
- Register only `implement`; rule out placeholder `intent` or `plan` entries — no builders exist for them.
- Missing and unknown names print `usage: jarvis run workflow <implement> [flags]\n`; rule out general `run` usage or a usage form that hides the registered name — preset selection fails at the workflow boundary.
- The CLI name-to-builder registry is separate from `resolveWorkflowPreset`'s step-shape registry; rule out merging them or removing its `write-write` preset — they own launch dispatch and runtime shape validation respectively.
- Builder errors print the builder text plus one trailing newline; rule out prefixes, reformatting, or extra blank lines — this is the existing CLI boundary.

## Verified prerequisite

- Workflow execution dispatches `behavior: "review"`; rule out implementing against write-only dispatch. Sources: `v2/src/execution/workflow-runner.ts`, `v2/src/execution/workflow-runner.test.ts`.

## Scope

- Add name-to-builder preset dispatch for `jarvis run workflow <name> [flags]`.
- Preserve the implement parser, builder inputs/results, daemon request, stdout, daemon errors, and exit behavior.
- Reject missing and unknown preset names before opening an IPC connection.
- Keep builder failures unchanged except for the CLI's existing single trailing newline, and pre-IPC.
- Update the durable CLI contract and v2 behavior catalog.
- Do not add builders, presets, daemon auto-start, or project review defaults.

## Acceptance criteria

- [ ] `v2/src/cli.test.ts` implement launch, invalid-flag, daemon-request, run-ID, and daemon-error tests stay green through the preset registry.
- [ ] Missing and unknown workflow preset names each print exactly `usage: jarvis run workflow <implement> [flags]\n`, exit `1`, and do not contact the daemon.
- [ ] An `implement` builder failure prints its error text followed by exactly one trailing newline, exits `1`, and does not contact the daemon.
- [ ] Only `implement` is a registered workflow preset.
- [ ] The CLI name-to-builder registry remains separate from `resolveWorkflowPreset`, whose `write-write` runtime preset remains available.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with generic workflow selection, registered presets, usage/error timing, and the preserved implement launch contract.
- Add a focused `[v2 additive]` CLI entry to `v2/docs/v1-behaviors.md` with current `v2/src/cli.ts` and `v2/docs/write-behavior.md` citations; do not rewrite v1 parity behavior.
- Do not update `v2/docs/onboarding.md`; this change does not alter v2 readiness.
