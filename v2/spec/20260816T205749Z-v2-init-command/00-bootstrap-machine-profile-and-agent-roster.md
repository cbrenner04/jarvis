# Bootstrap machine profile and agent roster

## Problem

- v2 has no safe way to establish a machine profile and runnable agent roster before project setup.

## Decisions

- The handler accepts only exact profile names enumerated from committed `config/machines/*.json`; extensions, separators, traversal forms, and ambiguous spellings are invalid.
- When `machineProfile` is absent, `--profile` is required; an existing different supplied profile fails before writes, and an existing matching profile is preserved.
- When `agents` is absent, use the available members of `claude`, `codex`, `cursor` in that order; do not infer alternatives.
- Every configured agent must have a binding in the selected profile and a runnable CLI on `PATH`. Quota-only fallback means a missing earlier configured CLI cannot be skipped, so one runnable agent is insufficient.
- Bootstrap writes a discovered roster only when that entire roster is supported by the selected profile; otherwise it fails before mutation. This deliberately makes a fresh `--profile work` fail because `work` binds `opencode`, not any default candidate; an existing compatible `opencode` roster remains valid.
- Existing `agents` and `machineProfile` must have their owned shapes: a non-empty unique string array and a non-empty string. Invalid shapes fail before mutation.
- Preserve unrelated top-level config fields and write no v1-only keys.

## Tasks

- Add handler-level machine bootstrap parsing, exact committed-profile enumeration, profile-model compatibility validation, executable probes, and merge-preserving atomic config preparation with injectable dependencies.
- Add isolated baseline-failing regressions for fresh bootstrap, all committed profiles including `work`/`opencode`, malformed owned machine fields, and no-mutation refusals.
- Add in-body mutation directives to the named pins for the headline bootstrap and each profile, compatibility, executable, and preservation guard; use unique production anchors and no production invert hooks.
- Update the v2 setup ownership and v1 parity documentation named below.

## Acceptance criteria

- [ ] From isolated machine and profile directories, handler-level init with `--profile home` and only `claude` available writes `agents: ["claude"]` and `machineProfile: "home"`; a matching second invocation preserves config bytes. `v2/src/commands/init.test.ts` — `fresh init bootstraps a compatible machine idempotently`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `fresh init bootstraps a compatible machine idempotently`; Keystone checkpoint: its body carries one `// @mutate` directive that removes the headline roster write, and the mutation turns the named pin RED.
- [ ] Existing compatible machine state is preserved, while bootstrap rejects absent profile selection, a conflicting or unknown profile, a malformed `agents` or `machineProfile`, no default candidate, a profile-unbound configured agent, or a configured CLI absent from `PATH` before config writes; diagnostics list exact committed choices. `v2/src/commands/init.test.ts` — `machine bootstrap rejects incompatible or malformed state without mutation`; fails against the pre-fix code.
- [ ] Every committed profile is exercised: supported home rosters pass; `work` accepts an existing runnable `opencode` roster and a fresh default-candidate bootstrap fails without mutation because no default candidate is profile-bound. `v2/src/commands/init.test.ts` — `profile bindings govern bootstrap and runnable roster`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `machine bootstrap guard inversions expose unsafe state`; Mutation checkpoint: its body carries distinct `// @mutate` directives for profile enumeration, profile conflict, roster compatibility, executable, malformed-state, and idempotence guards, and each mutation turns the named pin RED.
- [ ] `v2/docs/v1-behaviors.md` records v2 `init` machine ownership while retaining `jarvis1 init` as maintenance-only behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — distinguish v2 machine setup ownership from maintenance-only `jarvis1 init`.
