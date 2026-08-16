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
- Register the resolved current directory under the requested key or repository basename, refusing a key already bound to another root and naming both roots — rules out the v1 `~/Work` location constraint and silent rebinding.
- Persist the `origin` remote when present, omit it when absent, and persist `plan.targetDir` only when requested — rules out fabricated remotes and changing the existing plan-time `spec` default.
- Write the machine document through one JSON round trip that preserves unrelated top-level keys, existing project entries, and existing machine values — rules out destructive reconstruction or multi-write partial state.
- Create only `<targetDir>/seeds/.gitkeep` and `<targetDir>/ready-intents/.gitkeep` when scaffolding is requested; otherwise leave the target repository untouched — rules out implicit repo writes, runbooks, or guidance files.

## Acceptance criteria

- [ ] With an absent config, a temp machines directory, stubbed executable discovery, and stubbed git remote lookup, initialization persists the filtered agent order, requested profile, and basename-keyed project root/origin; rerunning produces no file diff.
- [ ] With an existing config, initialization leaves existing `agents`, `machineProfile`, unrelated top-level keys, and other project entries unchanged while adding only the requested project.
- [ ] Initialization fails without mutation when no agent CLI is available, a missing profile has no requested value, the requested profile is unknown, or the requested key names another root; profile failures list available profiles and key collisions name both roots.
- [ ] A requested `v2/spec` target persists `projects.<key>.plan.targetDir`; requested scaffolding creates only the two queue `.gitkeep` files, while initialization without scaffolding leaves the repo tree unchanged.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — this internal persistence service has no operator-facing entry until the dependent CLI intent exposes it.
