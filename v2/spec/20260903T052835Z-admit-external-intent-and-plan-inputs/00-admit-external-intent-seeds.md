# Admit external intent seeds

## Primary implementation surface

Execution-loop: `resolveSeed` in `v2/src/execution/publication-workflow-steps.ts`.

## Problem

`intent --seed` rejects absolute paths and confines file seeds to the registered project root, so seeds queued under `~/.jarvis/specs/<projectSafeId>/seeds/` cannot enter the intent publication workflow for opted-in projects.

## Prerequisites

- Chained-stage dispatch resolves external workspaces for git-disabled projects (`match-git-disabled-chained-stage-workspaces`).
- Implement admits external plan trees at the canonical `~/.jarvis/specs/<safeId>/plans/<name>/index.md` path (`implement-admits-externally-landed-specs`).

## Decision ledger

- Admit `--seed` only when the resolved file lies under `join(jarvisHome(), "specs", projectSafeId(registered-key), "seeds")` for the matched registered project; rules out accepting arbitrary absolute paths or a global seed pool.
- Apply realpath containment against that project's external `seeds/` directory, not only the repository root; rules out symlink escapes into sibling projects' homes.
- Refuse external seed paths when the matched project would publish in-repo (`git !== false` and effective commit is true); rules out external admission for committed-only projects.
- Keep relative in-repo seed admission, escape checks, and inline `--seed-text` unchanged; rules out regressing existing repo-bound entry.
- Land and consume external seeds through the existing git-disabled intent landing contract (`consumeFrom: "source"`, external `ready-intents/` durable dir); rules out a separate consumption path.

## Tasks

- Extend `resolveSeed` to resolve absolute `--seed` values under the matched project's external `seeds/` home via `projectSafeId` and `jarvisHome()`.
- Reject external seed paths for in-repo-only projects and paths outside the owning project's `seeds/` tree (including symlink escapes).
- Preserve relative in-repo seed behavior and inline seed handling.
- Add regression coverage in `intent-workflow-steps.test.ts` for external seed admission, external `ready-intents/` landing target, and write-step `landing.inputs` (`paths` canonical absolute seed, `consumeFrom: "source"`).

## Acceptance criteria

- [ ] `intent-workflow-steps.test.ts` test `admits external seed under project specs home` asserts `--seed` naming a file under `~/.jarvis/specs/<safeId>/seeds/` admits for a project with external publication routing, lands to external `ready-intents/`, and sets write-step `landing.inputs.paths` to the canonical absolute seed path with `consumeFrom: "source"`; it fails against the current relative-path and project-root escape guards in `resolveSeed`.

## Documentation updates

- Deferred to `03`–`05`.
