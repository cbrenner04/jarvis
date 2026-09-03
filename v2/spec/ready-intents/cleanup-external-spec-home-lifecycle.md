---
name: cleanup-external-spec-home-lifecycle
---

# Cleanup discovers external seeds and ready-intents in stranded scans

## Prerequisites

- Intent `--seed` admits, lands, and consumes seeds under `~/.jarvis/specs/<safeId>/seeds/` for opted-in projects.
- Plan `--ready-intent` admits ready-intents under `~/.jarvis/specs/<safeId>/ready-intents/` for opted-in projects.
- Completed external plan trees archive to `plans/completed/<name>/` under the external home with stranded discovery for `plans/` (`archive-external-implement-specs`, landed).

## Module-boundary surface

- CLI: `jarvis cleanup` external-home discovery, archival, and stranded-artifact inspection in `v2/src/commands/cleanup.ts`.

## Problem

External plan identity resolution, `plans/` stranded discovery, and `plans/completed/<name>/` archival already land on main (`archive-external-implement-specs`). Cleanup still does not scan external `seeds/` or `ready-intents/` queues for opted-in projects — stranded discovery covers in-repo `v2/spec/` and external `plans/` only, so consumed or stale external seeds and ready-intents are invisible to cleanup.

## Decisions

- Opt-in stays the contract (`plan.commit: false` / `git: false` per project); rules out scanning or archiving in-repo-only projects into external homes.
- External-home layout under `~/.jarvis/specs/<projectSafeId>/`: `seeds/`, `ready-intents/`, `plans/<name>/`, `plans/completed/<name>/`; rules out a root-level `completed/` sibling in the external home.
- Reuse landed external plan archival to `plans/completed/<name>/` without changing its destination; rules out re-implementing plan-tree archival in this intent.
- Stranded-artifact scans include external `seeds/` and `ready-intents/` queue entries for opted-in projects alongside existing in-repo and external `plans/` discovery; rules out leaving external queue directories invisible.
- Reuse existing completeness, open-PR, ownership, dry-run, move, and rollback guards before external archival; rules out a weaker cleanup path for external trees.
- External homes remain per registered project via shared `projectSafeId`; rules out a global spec pool.

## Acceptance criteria

- [ ] `cleanup.test.ts` test `discovers stranded artifacts in external seeds and ready-intents homes` asserts opted-in project queue entries under `~/.jarvis/specs/<safeId>/seeds/` and `ready-intents/` appear in `discoverStrandedArtifacts` output with the same skip rules as in-repo queue siblings; it fails against the current plans-only external discovery.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — external `seeds/` and `ready-intents/` stranded discovery; cross-link install-and-config for layout.
- `v2/docs/v1-behaviors.md` — parity with v1 external queue lifecycle and divergence from landed external-plan archival.

## Primary implementation surface

v2/src/commands/cleanup.ts
