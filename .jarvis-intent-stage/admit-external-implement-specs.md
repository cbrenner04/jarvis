---
name: admit-external-implement-specs
---

# Admit external implement specs

## Primary implementation surface

CLI admission.

## Problem

`jarvis run workflow implement` rejects the durable plan tree produced for a registered `plan.commit: false` project because the tree is outside every registered repository root.

## Prerequisites

- Shared `projectSafeId` maps registered project keys to the path segment used by git-disabled plan publication under `~/.jarvis/specs/<safeId>/plans/<name>/`.

## Decision ledger

- Admit a canonical spec path only when it is under `~/.jarvis/specs/<projectSafeId(registered-key)>/plans/**` for the owning `plan.commit: false` project; rules out arbitrary external paths and multi-project ownership guesses.
- Preserve the canonical external spec identity while resolving code work from the owning registered project and `--base`; rules out copying or relativizing the spec tree into the repository.
- Do not require an admitted external spec to exist in the target Git base; rules out applying the in-repo `git cat-file` gate to Jarvis-owned storage.
- Read admitted external trees for completeness before daemon contact and return `implement.already_complete` without materialization when complete; rules out creating a worktree or run row for finished work.
- Apply incomplete re-run safety gates to the code worktree without treating the external spec as repository/base content; rules out false landed-criteria or missing-spec refusals.
- Keep in-repo spec/artifact containment, base-ref availability, symlink safety, and non-index `--artifact` behavior unchanged; rules out broadening admission beyond external plan indexes.

## Acceptance criteria

- [ ] A CLI/workflow admission regression test passes `--spec ~/.jarvis/specs/<safeId>/plans/<name>/index.md` for a registered `plan.commit: false` project, resolves the owning project and external spec identity, and fails against the current `Spec path outside registered project roots` refusal.
- [ ] Admission rejects unregistered safe IDs, paths outside `plans/`, non-`plan.commit: false` owners, and symlink escapes without weakening existing in-repo containment tests.
- [ ] An admitted external spec is not checked for membership in `--base`, while existing in-repo base-ref availability coverage stays green.
- [ ] A fully checked external tree returns `implement.already_complete` before worktree materialization, daemon contact, agent invocation, or run-row creation.
- [ ] An incomplete external re-run reaches the ordinary code-worktree reset gates without resolving the spec relative to that worktree.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — define external-plan implement admission, project ownership, canonical path handling, and preflight completeness.
- `v2/docs/operator-runbook.md` — document the standalone `plan.commit: false` implement command and preflight behavior; cross-link the workflow contract instead of duplicating it.

## Out of scope

- External `--ready-intent` admission, v1 changes, and external homes shared by multiple projects.
