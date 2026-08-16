---
name: persist-v2-init-state
---

# Persist idempotent v2 machine and project initialization

## Prerequisites

## Surface

- Persistence: machine config creation/update plus optional project scaffolding.

## Problem

- v2 can read machine and project configuration but has no safe operation that initializes missing setup while preserving established values and unrelated state.

## Decisions

- Keep init-state mutation testable independently of CLI dispatch — rules out burying filesystem policy in the later command handler.
- Deferred to first consumer: exported API shape and module placement — pin when the `jarvis init` caller needs it.
- When `agents` is absent, persist `claude,codex,cursor` filtered to executables found on `PATH`, and fail without writing when none are found — rules out unavailable defaults or an empty agent order.
- When `machineProfile` is absent, require a requested profile whose JSON file exists in the Jarvis checkout's committed `config/machines/` directory; retain any existing value — rules out profile guessing, target-cwd lookup, or overwrite.
- Resolve a nested Git working directory to its Git top-level; use a non-Git current directory itself as the project root. Derive the default key from that root basename, query `origin` only from a Git root, and refuse a key already bound to another root while naming both roots — rules out the v1 `~/Work` location constraint, nested-directory registrations, and silent rebinding.
- Persist the `origin` remote when present, omit it when absent, and persist `plan.targetDir` only when requested — rules out fabricated remotes and changing the existing plan-time `spec` default.
- Accept `targetDir` only as a non-empty, normalized relative descendant of the resolved project root; reject absolute, root, and escaping paths before any write, including scaffolding — rules out writes outside the selected project.
- Write the machine document through one JSON round trip that preserves unrelated top-level keys, existing project entries, and existing machine values — rules out destructive reconstruction or multi-write partial state.
- Create only `<targetDir>/seeds/.gitkeep` and `<targetDir>/ready-intents/.gitkeep` when scaffolding is requested; otherwise leave the target repository untouched — rules out implicit repo writes, runbooks, or guidance files.

## Acceptance criteria

- [ ] With an absent config, a temp machines directory, stubbed executable discovery, and stubbed git remote lookup, initialization persists the filtered agent order, requested profile, and basename-keyed project root/origin; rerunning produces no file diff.
- [ ] With an existing config, initialization leaves existing `agents`, `machineProfile`, unrelated top-level keys, and other project entries unchanged while adding only the requested project.
- [ ] The `v2/src/config/init-state.test.ts` `rejects unavailable initialization inputs without mutation` regression test fails against the baseline and proves no-agent, missing/unknown-profile, key-collision, and invalid-target cases leave config and repository state unchanged; profile failures list available profiles and collisions name both roots.
- [ ] The `v2/src/config/init-state.test.ts` `resolves nested Git and non-Git working directories` regression test fails against the baseline and proves nested Git cwd registers its top-level root while a non-Git cwd registers itself without an `origin`.
- [ ] The `v2/src/config/init-state.test.ts` `persists and scaffolds only an in-root target directory` regression test fails against the baseline and proves `v2/spec` persists as `projects.<key>.plan.targetDir`, rejects absolute/root/escaping targets without mutation, and creates only the two queue `.gitkeep` files when scaffolding is requested.
- [ ] `v2/src/config/init-state.test.ts` — `rejects unavailable initialization inputs without mutation`; Mutation checkpoint: directives in the test body invert each added availability, profile, collision, and target-scope guard, and each scoped test fails.
- [ ] `v2/src/config/init-state.test.ts` — `resolves nested Git and non-Git working directories`; Mutation checkpoint: a directive in the test body bypasses Git-top-level resolution, and the scoped test fails.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — this internal persistence service has no operator-facing entry until the dependent CLI intent exposes it.
