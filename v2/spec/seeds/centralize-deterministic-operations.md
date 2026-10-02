---
name: centralize-deterministic-operations
---

# Centralize deterministic operations across the harness and scripts

## Problem

Jarvis has shared Git helpers and a subprocess runner, but workflow, cleanup, publication, review, and root scripts still construct dependency commands and interpret their results independently. Shared execution mechanics do not give Git operations, error semantics, or scope rules a single owner. Exposing tools over these scattered implementations would preserve the duplication.

Evidence: `shared/git.ts` defines common queries, while `shared/prompts/review-implement.ts`, `v2/src/commands/cleanup.ts`, `v2/src/execution/external-worktree.ts`, and `scripts/ready.ts` also construct Git commands. GitHub calls are distributed across cleanup and publication code. Existing services should be consolidated before adding parallel abstractions.

## Decisions

- Each operation has one owner; higher-level operations compose lower-level operations. CLI commands, agent tools, free-text routing, and scripts enter at different levels. A pipeline command is not the same abstraction as an agent's diff tool.
- Include runtime code and root scripts in the inventory and migration. Preserve the dependency direction: `shared/**` must not import `v2/**`. Do not touch frozen `v1/**`.
- Establish one canonical Git boundary for Jarvis-owned code: command construction, output parsing, and common failure semantics live there. Callers use typed operations rather than reconstructing commands through a public arbitrary-arguments wrapper.
- Separate deterministic validation, parsing, and policy from stateful effects. Git and filesystem operations are stateful; centralizing them does not make their results independent of current state.
- Audit GitHub/`gh`, subprocess lifecycle, workspace/path confinement, gate execution, spec mechanics, and run/pipeline admission as additional candidates. Reuse existing owners and consolidate demonstrated duplication; do not build a generic framework or wrap every filesystem call.
- Higher-level services retain workflow policy and compose canonical primitives. Centralization does not put every operation in one file or expose every function as a public tool.
- Add structural guards against new bypasses in migrated production and script surfaces, with explicit test-fixture boundaries. Cover operation behavior through injected dependencies, never ambient machine configuration.
- This seed is a prerequisite for [agent tool exposure](./harness-exposes-agent-toolset.md). Centralizing Jarvis-owned code and preventing arbitrary agent shell bypasses are distinct requirements; the latter belongs to the toolset design.

## Open questions

- Which existing modules should own each operation, and which duplicate callers form the first independently testable migration?
- Which Git/GitHub error distinctions need to be preserved or made explicit, including absence versus an inconclusive query?
- Which additional candidates demonstrate enough duplication to warrant migration now?

## Acceptance criteria

- [ ] Planning inventories the in-scope runtime and script callers, identifies canonical owners, and splits migrations into independently testable specs.
- [ ] Migrated callers reuse typed canonical operations; structural guards prevent new direct dependency access outside the designated boundaries.
- [ ] Operation tests pin parsing, failure semantics, and policy; existing caller behavior remains covered.
- [ ] Implementation specs name typecheck and the additive test scopes required by their actual changed surfaces.

## Documentation updates

- `v2/docs/v2-architecture.md` — operation ownership, layering, dependency direction, and allowed entry points for scripts and interfaces.
- `AGENTS.md` — canonical dependency boundaries and how to add an operation without bypassing them.
