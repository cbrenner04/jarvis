# 02 - Filter stranded discovery candidates

## Problem

Stranded discovery treats dot-directories, harness staging directories, and paths that vanish before reporting as inspectable artifacts, producing skip lines for agent scratch state and deleted entries.

## Decision ledger

- Exclude every dot-directory and recognized harness staging directory from both `discoverStrandedArtifacts` and `discoverExternalPlanStrandedArtifacts` enumeration via `isHarnessWorkflowStagingPath`; rules out treating `.scratch`, `.jarvis-plan-stage`, `.jarvis-intent-stage`, and other sidecars under `v2/spec/` or external `plans/` as open-home specs.
- Recheck candidate path existence with `existsSync` immediately before stranded inspection or skip reporting; rules out emitting skip lines for entries deleted between discovery and report.
- Keep external `plans/` and in-repo `v2/spec/` admission rules unchanged aside from the new filters; rules out broadening stranded discovery to seeds or ready-intents queues.

## Work

- Extend `discoverStrandedArtifacts` and `discoverExternalPlanStrandedArtifacts` to skip dot-directories and harness staging directories using `isHarnessWorkflowStagingPath`.
- Drop vanished candidates in `inspectStrandedArtifacts` (existence recheck immediately before inspection/skip emission).
- Add regression coverage with filter fixtures as immediate children of `v2/spec/` or external `plans/` (not repo-root `.scratch` alone); exercise the vanished-path race by deleting a discovered candidate after enumeration and before the inspection pass runs.

## Acceptance criteria

- [ ] `v2/src/commands/cleanup.test.ts` test `stranded discovery ignores non-spec and vanished paths` produces no skip lines for dot-directories and harness staging directories under `v2/spec/` or external `plans/`, or for a candidate deleted after discovery and before inspection; it fails against the pre-fix inspection output.
- [ ] `v2/docs/operator-runbook.md` documents stranded discovery filtering for dot-directories, harness staging directories, and vanished paths.
- [ ] `v2/docs/v1-behaviors.md` records the stranded discovery filtering delta.

## Documentation updates

- `v2/docs/operator-runbook.md` — artifact filtering for stranded open-home discovery.
- `v2/docs/v1-behaviors.md` — stranded discovery ignores dot-directories, staging dirs, and vanished paths.
