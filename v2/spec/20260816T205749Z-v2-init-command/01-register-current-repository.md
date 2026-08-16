# Register the current repository

## Problem

- v2 must establish one unambiguous project registration without accepting an arbitrary directory or silently changing registry identity.

## Prerequisites

- Implement after [00 - Bootstrap machine profile and agent roster](./00-bootstrap-machine-profile-and-agent-roster.md); rules out writing partial project state before machine bootstrap is valid.

## Decisions

- Setup accepts only the resolved Git worktree top level. Outside a worktree or below its top level fails before config or repository writes.
- A supplied project key must match `[A-Za-z0-9][A-Za-z0-9_-]*`; separators, dots, traversal forms, and other unsafe names fail before mutation.
- The default key is the existing key for the resolved cwd when exactly one exists; otherwise it is the cwd basename. If cwd is already registered under another key, an omitted `--name` reuses it and a differing supplied `--name` fails naming both keys.
- A selected key bound to another resolved root fails before mutation and names both roots. Duplicate resolved roots are never added.
- Owned project paths must be well formed before merge: `projects` and the selected project are objects when present; `root` and `origin` are strings when present; `plan` is an object when present; and `plan.targetDir` is a string when present. Invalid ancestors or fields fail without replacement.
- Add the current `git remote get-url origin` only when the selected registration has no origin. Missing origin does not prevent setup; existing origin is never refreshed.
- Merge only owned v2 project fields and preserve unrelated top-level keys, projects, and selected-project fields. Expected registration failures leave config and repository bytes unchanged.

## Tasks

- Add handler-level Git-top-level, safe-key, duplicate-identity, origin, owned-shape, and atomic merge checks with injectable Git and filesystem dependencies.
- Add baseline-failing regressions for valid registration, merge preservation, invalid locations and names, duplicate roots/keys, malformed project paths, and optional additive origin discovery.
- Add in-body mutation directives to the named pins for the headline registration and every location, identity, malformed-config, origin, and preservation guard; use unique production anchors and no production invert hooks.
- Update durable registry ownership documentation named below.

## Acceptance criteria

- [ ] Handler-level init registers the resolved Git top-level under `--name` or its basename, adds a discovered origin only when absent, preserves a stored origin on rerun, and does not require an origin to write setup state. `v2/src/commands/init.test.ts` — `project registration is additive and idempotent`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `project registration is additive and idempotent`; Keystone checkpoint: its body carries one `// @mutate` directive that removes the resolved-root registration write, and the mutation turns the named pin RED.
- [ ] Existing agents, profile, unrelated top-level keys, other projects, and unrelated selected-project fields remain byte-preserved while missing registration state is added. `v2/src/commands/init.test.ts` — `project registration merge preserves unrelated config`; fails against the pre-fix code.
- [ ] A non-Git cwd, a worktree subdirectory, an unsafe key, a key bound to another root, a duplicate cwd under a differing supplied name, or any malformed owned project ancestor or field exits `1` before config or repository mutation; root and alias diagnostics identify both values. `v2/src/commands/init.test.ts` — `project registration refuses unsafe identity and malformed config`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `project registration guard inversions expose unsafe mutation`; Mutation checkpoint: its body carries distinct `// @mutate` directives for worktree-root, safe-key, duplicate-identity, key-root conflict, origin-preservation, malformed-config, and merge-preservation guards, and each mutation turns the named pin RED.
- [ ] `v2/docs/operator-runbook.md` assigns v2 project registration to `jarvis init`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — replace v1 project-registration ownership with v2 init.
