---
name: admit-external-implement-specs
---

# Admit external implement specs

## Primary implementation surface

CLI admission.

## Problem

`jarvis run workflow implement` rejects the durable plan tree produced when `planSource` publishes externally for a registered project because the tree lives under `~/.jarvis/specs/<project-safe-id>/plans/` outside every registered repository root.

## Prerequisites

- Shared `projectSafeId` maps registered project keys to the path segment used by external plan publication under `~/.jarvis/specs/<safeId>/plans/<name>/`.

## Decision ledger

- Admit a canonical `index.md` only when it is under `~/.jarvis/specs/<projectSafeId(registered-key)>/plans/**` for exactly one registered owner whose `planSource` external-publication predicate is true (`config.git === false || (config.plan?.commit ?? true) === false`); rules out arbitrary external paths and multi-project ownership guesses.
- Preserve the canonical external spec identity while resolving code work from the owning registered project and `--base`; rules out copying or relativizing the spec tree into the repository.
- Do not require an admitted external spec to exist in the target Git base; rules out applying the in-repo `git cat-file` gate to Jarvis-owned storage.
- Read admitted external trees for completeness before daemon contact (build and recovery paths) and return `implement.already_complete` without materialization when complete; rules out creating a worktree or run row for finished work.
- Apply incomplete re-run safety gates to the code worktree and skip landed-criteria drift rooted at the external spec; rules out false landed-criteria, missing-spec, or `implement.link_out_of_tree` refusals.
- Keep in-repo spec/artifact containment, base-ref availability, symlink safety, and non-index `--artifact` behavior unchanged; rules out broadening positive admission beyond external plan `index.md`.

## Acceptance criteria

- [ ] A CLI/workflow admission regression test passes `--spec ~/.jarvis/specs/<safeId>/plans/<name>/index.md` for a registered project whose `planSource` publishes externally, resolves the owning project and external spec identity, and fails against the current `Spec path outside registered project roots` refusal.
- [ ] Admission rejects unregistered safe IDs, paths outside `plans/`, owners whose `planSource` would publish in-repo only, non-`index.md` external paths, duplicate `projectSafeId` collisions, and symlink escapes under `~/.jarvis/specs/...` without weakening existing in-repo containment tests.
- [ ] An admitted external spec is not checked for membership in `--base`, while existing in-repo base-ref availability coverage stays green.
- [ ] A fully checked external tree returns `implement.already_complete` before worktree materialization, daemon contact, agent invocation, or run-row creation (build and recovery paths).
- [ ] An incomplete external re-run reaches the ordinary code-worktree reset gates without landed-criteria refusal on external-absolute `specPath` and without resolving the spec relative to that worktree.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — define external-plan implement admission, `planSource` publication predicate, project ownership, identity fields, canonical path handling, completeness (build + recovery), and stale-reset landed-criteria handling.
- `v2/docs/operator-runbook.md` — document the standalone external-plan implement command through admission/preflight/stale-reset success; cross-link the workflow contract and execution-routing sibling intent instead of duplicating or implying full-loop support.
- `v2/docs/v1-behaviors.md` — record the resulting v2 external-plan implement admission behavior without changing v1.

## Out of scope

- External `--ready-intent` admission, v1 changes, external homes shared by multiple projects, end-to-end agent-loop execution routing for external spec trees (sibling intent), and `reviewPasses > 0` verdict-path behavior outside the code worktree (defer to execution intent).
