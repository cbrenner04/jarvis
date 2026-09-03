---
name: cleanup-external-spec-home-lifecycle
---

# Cleanup discovers and archives completed external spec homes

## Prerequisites

- Intent `--seed` admits, lands, and consumes seeds under `~/.jarvis/specs/<safeId>/seeds/` for opted-in projects.
- Plan `--ready-intent` admits ready-intents under `~/.jarvis/specs/<safeId>/ready-intents/` for opted-in projects.
- Completed external plan trees archive to `plans/completed/<name>/` under the external home with stranded discovery for `plans/` (`archive-external-implement-specs`).

## Module-boundary surface

- CLI: `jarvis cleanup` external-home discovery, archival, and stranded-artifact inspection in `v2/src/commands/cleanup.ts`.

## Problem

Cleanup still resolves spec identity and stranded discovery primarily against in-repo `v2/spec/` homes and rejects many external identities, so opted-in projects cannot rely on cleanup for the full external spec home. v1 external archival (#648) is the reference for the terminal lifecycle.

## Decisions

- Opt-in stays the contract (`plan.commit: false` / `git: false` per project); rules out scanning or archiving in-repo-only projects into external homes.
- Cleanup archives eligible completed external spec trees to an external `completed/` sibling within the owning project's `~/.jarvis/specs/<projectSafeId>/` home; rules out leaving completed external specs unarchived or moving them into the repository.
- Stranded-artifact scans cover registered projects' external spec homes, not only in-repo `v2/spec/`; rules out external-only projects being invisible to cleanup discovery.
- Reuse existing completeness, open-PR, ownership, dry-run, move, and rollback guards before external archival; rules out a weaker cleanup path for external trees.
- External homes remain per registered project via shared `projectSafeId`; rules out a global spec pool.

## Acceptance criteria

- [ ] A cleanup test proves a completed external spec tree archives to the external `completed/` sibling and appears in stranded-artifact scans; it fails against the current in-repo-only discovery.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — external-home cleanup discovery, dry-run, refusal, and `completed/` destination; cross-link install-and-config for layout.
- `v2/docs/v1-behaviors.md` — parity with v1 external archival (#648) and any remaining divergence from landed external-plan archival.
