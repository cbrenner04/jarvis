---
name: cleanup-archives-harness-staging-outside-the-spec-home
---

# Cleanup resolves an intent run's spec identity to `.jarvis-intent-stage` and archives it to the repo root

## Problem

`jarvis cleanup jarvis --dry-run` previews this, reproducibly:

```text
/Users/…/.jarvis/worktrees/jarvis/intent/ready-command-reaches-the-step-that-runs (branch: intent/…)
  archive: /Users/…/Work/jarvis/.jarvis-intent-stage -> /Users/…/Work/jarvis/completed/.jarvis-intent-stage
```

Three things are wrong at once, and every other archive line in the same run is correct (`… /v2/spec/<name> -> …/v2/spec/completed/<name>`):

1. It names a **harness workflow staging directory** as a spec artifact. The documented contract is that cleanup ignores `.jarvis-plan-stage`, `.jarvis-intent-stage`, and other `.jarvis-*` sidecars.
2. The destination is **`<repo>/completed/`**, outside the spec home `v2/spec/completed/`.
3. The source **does not exist** — `.jarvis-intent-stage` is absent from both the primary checkout and the intent worktree.

## Cause (post-retirement archival, not the stranded scan)

`sourceForRun` (`v2/src/commands/cleanup.ts:769`) maps a run row to an artifact source from `run.specPath`. An intent write step records its staging directory as `specPath`, so:

- `identity = ".jarvis-intent-stage"` — relative and not `..`-prefixed, so it passes the containment guard at `:788`.
- `durablePath = resolve(projectRoot, identity)` → `<repo>/.jarvis-intent-stage`; basename is not `index.md`, so that path is returned as the source (`:790-791`).

`resolveArtifactSpec` (`:747`) then does `sources.find((path) => existsSync(join(path, "index.md"))) ?? sources[0]`. No candidate has an `index.md`, so the **`?? sources[0]` fallback accepts a source that was never proven to be a spec tree**, and `home: dirname(source)` (`:750`) becomes the repository root. Both faults are required: the staging path gets in, and the unproven fallback lets it through with a repo-root home.

The `existsSync` recheck the runbook promises guards the *stranded open-home scan*, not this post-retirement path, which is why a nonexistent source is previewed at all.

## Risk

This is on the session-close path. Applying it would either create a stray `completed/` directory in the operator's checkout or fail the move and report the worktree retirement failed — for a worktree whose retirement is otherwise fine.

## Decisions

- `sourceForRun` rejects any `run.specPath` whose relative identity contains a `.jarvis-*` path segment, matching the ignore contract already documented for the stranded scan; rules out harness staging directories entering artifact resolution at all.
- Artifact-spec resolution requires a proven spec tree — a source containing `index.md`, or a `.md` spec file — and returns `undefined` otherwise; rules out the `?? sources[0]` fallback promoting an arbitrary unproven path to an archive candidate.
- An archive destination is always `<spec home>/completed/`, where the spec home is derived from the registered project's `plan.targetDir`, not from `dirname(source)`; rules out a source path outside the spec home silently relocating the destination.
- Post-retirement archival rechecks source existence immediately before previewing or moving, as the stranded scan already does; rules out previewing a candidate that is not on disk.
- Existing correct archival for in-repo and external plan artifacts is unchanged, pinned; rules out narrowing legitimate archival while tightening resolution.

## Acceptance criteria

- [ ] A test proves a run row whose `specPath` is `.jarvis-intent-stage` (or any `.jarvis-*` segment) yields no artifact source; it fails against the current containment-guard-only filter.
- [ ] A test proves artifact resolution returns `undefined` when no candidate source contains `index.md` and none is a `.md` spec file; it fails against the current `?? sources[0]` fallback.
- [ ] A test proves an archive destination for a registered project is under that project's `plan.targetDir` `completed/` directory even when a candidate source resolves outside it; it fails against the current `dirname(source)` home.
- [ ] A test proves a post-retirement archive candidate that no longer exists on disk is neither previewed nor moved.
- [ ] A test proves in-repo spec-tree archival and external `plans/` archival still preview and apply their existing destinations.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: the `.jarvis-*` ignore applies to post-retirement archival as well as the stranded scan, and archive destinations are always under the spec home.
- `v2/docs/v1-behaviors.md` — record the tightened artifact resolution.
