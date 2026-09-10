---
name: cleanup-artifact-resolution-rejects-harness-staging
---

# Cleanup's post-retirement artifact resolution rejects harness staging and archives only under the spec home

Unsplit rationale: every decision changes one module-boundary surface — cleanup's post-retirement artifact resolution in `v2/src/commands/cleanup.ts` (`sourceForRun`, `artifactForRetiredWorktree`, and the archive preview/apply it feeds) — so there is no second surface to sequence against.

## Primary implementation surface

- `v2/src/commands/cleanup.ts` post-retirement artifact resolution (`sourceForRun` → `artifactForRetiredWorktree` → archive preview/apply)

## Problem

`jarvis cleanup jarvis --dry-run` reproducibly previews `archive: <repo>/.jarvis-intent-stage -> <repo>/completed/.jarvis-intent-stage` for an intent run's retired worktree. Three faults compose: an intent write step records its staging directory as `run.specPath`, and the identity passes the containment guard in `sourceForRun`; `artifactForRetiredWorktree`'s `?? sources[0]` fallback accepts a source never proven to be a spec tree; `home: dirname(source)` then puts the destination at the repository root instead of `v2/spec/completed/`. The source does not even exist on disk. On apply this either creates a stray `completed/` in the operator's checkout or fails the move and misreports worktree retirement as failed.

## Decisions

- `sourceForRun` rejects any relative identity containing a `.jarvis-*` path segment, reusing the sidecar/staging predicate already used by the stranded scan; harness staging never enters artifact resolution.
- Artifact resolution requires a proven spec tree — a source containing `index.md`, or a `.md` spec file — and returns `undefined` otherwise; the `?? sources[0]` fallback goes away.
- The archive destination is always `<spec home>/completed/`, with the spec home derived from the registered project's `plan.targetDir` rather than `dirname(source)`.
- Post-retirement archival rechecks source existence immediately before previewing or moving, matching the stranded scan.
- Existing in-repo spec-tree archival and external `plans/` archival keep their current destinations.

## Prerequisites

- Cleanup already classifies `.jarvis-*` paths as harness sidecar/staging for the stranded scan.
- Registered projects expose `plan.targetDir` from the config registry that cleanup reads.
- External plan artifact archival resolves its own spec read root independent of `dirname(source)`.

## Acceptance criteria

- [ ] A test proves a run row whose `specPath` is `.jarvis-intent-stage` (or any `.jarvis-*` segment) yields no artifact source; it fails against the current containment-guard-only filter.
- [ ] A test proves artifact resolution returns `undefined` when no candidate source contains `index.md` and none is a `.md` spec file; it fails against the current `?? sources[0]` fallback.
- [ ] A test proves the archive destination for a registered project is under that project's `plan.targetDir` `completed/` directory even when a candidate source resolves outside it; it fails against the current `dirname(source)` home.
- [ ] A test proves a post-retirement archive candidate absent from disk is neither previewed nor moved; it fails against the current unchecked preview.
- [ ] Existing `cleanup` tests for in-repo spec-tree archival and external `plans/` archival stay green (destinations unchanged).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: the `.jarvis-*` ignore covers post-retirement archival as well as the stranded scan, and archive destinations are always under the spec home.
- `v2/docs/v1-behaviors.md` — record the tightened artifact resolution and spec-home-anchored destination.
