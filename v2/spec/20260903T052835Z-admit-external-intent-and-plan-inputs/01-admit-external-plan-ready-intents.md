# Admit external plan ready-intents

## Primary implementation surface

Execution-loop: `planSource` in `v2/src/execution/publication-workflow-steps.ts`.

## Problem

`plan --ready-intent` rejects absolute paths, so ready-intents queued under `~/.jarvis/specs/<projectSafeId>/ready-intents/` cannot enter the plan publication workflow for opted-in projects.

## Prerequisites

- `00-admit-external-intent-seeds` (shared external-home conventions; no code dependency).

## Decision ledger

- Admit `--ready-intent` when the resolved file lies under `join(jarvisHome(), "specs", projectSafeId(registered-key), "ready-intents")` for the matched registered project; rules out accepting arbitrary absolute paths.
- Validate ready-intent structure (frontmatter `name:`, `## Prerequisites`) on the resolved external file path; rules out skipping pre-daemon validation for external inputs.
- Apply realpath containment against the owning project's external `ready-intents/` directory; rules out symlink escapes into sibling projects' homes.
- Refuse external ready-intent paths when the matched project would publish in-repo; rules out external admission for committed-only projects.
- Keep relative in-repo ready-intent admission unchanged; rules out regressing canonical repo queue paths.
- Draft external inputs to `~/.jarvis/specs/<projectSafeId>/plans/<name>/` using the existing git-disabled plan landing contract; rules out timestamped in-repo spec dirs for external publication.

## Tasks

- Extend `planSource` to accept absolute `--ready-intent` values under the matched project's external `ready-intents/` home.
- Resolve and validate the external ready-intent file before daemon contact; reject in-repo-only owners and out-of-home paths.
- Preserve relative in-repo ready-intent behavior and existing `canonicalTargetDir` routing for repo paths.
- Add regression coverage in `plan-workflow-steps.test.ts` for external ready-intent admission, external plan durable path, and write-step `landing.inputs` (`paths` canonical absolute ready-intent, `consumeFrom: "source"`).

## Acceptance criteria

- [ ] `plan-workflow-steps.test.ts` test `admits external ready-intent under project specs home` asserts `--ready-intent` naming a file under `~/.jarvis/specs/<safeId>/ready-intents/` drafts to external `plans/<name>/` for external publication routing and sets write-step `landing.inputs.paths` to the canonical absolute ready-intent path with `consumeFrom: "source"` (not `resolve(project.root, …)`), matching `records the ready-intent as the byte-identical plan input`; it fails against the current absolute-path rejection in `planSource`.

## Documentation updates

- Deferred to `03`–`05`.
