---
name: boundary-split-emits-near-duplicate-subspecs
---

# The mechanical surface split corrupts plan drafts, and its taxonomy is jarvis-only

## Problem

`normalizePlanDraftSpecDir` (`shared/module-boundary-surfaces.ts:417`, called unconditionally from `v2/src/execution/write.ts:213`) takes the plan agent's authored draft and mechanically re-splits it into one subspec per "module-boundary surface". For each child it calls `replaceTitle(draft.body, title)` and replaces only the bullets under `## Acceptance criteria`, `## Decisions` and `## Documentation updates`. Everything else is copied verbatim.

That produces, by construction:

- **Byte-identical `## Problem` sections**, because the split never derives per-surface framing.
- **Bare surface titles** — `# Persistence`, `# Execution loop`, `# CLI`, `# Daemon` come straight from `SURFACES[surface].title`. These are planning labels, which `AGENTS.md` forbids in authored artifacts.
- **Subspecs with zero acceptance criteria**, whenever `bulletsForBoundary` finds no criteria for a boundary the split emitted anyway.
- **Orphans and title/filename drift**, because children are renumbered by `emittedIndex` while the index and in-body titles are not reconciled — which the orphan-file contract then rejects as a second, downstream failure.

Classification is regex keyword matching over acceptance-criterion **prose, including file paths**. A criterion that merely says "existing coverage in `v2/src/daemon/pipeline-stage-dispatch.test.ts` stays green" matches `/\bdaemon\b/i` and pulls the whole draft into a daemon split.

## The taxonomy is jarvis-specific and is applied to every project

`MODULE_BOUNDARY_SURFACES` is a hardcoded four-value list — `persistence`, `daemon`, `cli`, `execution-loop` — describing **jarvis's own architecture**, with no per-project override. `normalizePlanDraftSpecDir` runs on the plan path for every registered project.

Several patterns are ordinary software vocabulary, not jarvis jargon:

- `cli`: `/\bflags?\b/i`, `/\bsubcommands?\b/i`, `/\bcommand[- ]line\b/i`
- `persistence`: `/\bpersist(?:ed|ence|ent|ing|s)?\b/i`, `/\b(?:database|sqlite|storage)\b/i`
- `daemon`: `/\bsocket\b/i`, `/\b(?:ipc|rpc)\b/i`

Verified against the real classifier (2026-09-08). Every one of these ordinary product-repo pairs splits:

| criteria | classified |
| --- | --- |
| "each change persists across relaunch" + "the board flags an illegal move" | `persistence, cli` |
| "written to local storage" + "a feature flag hides the hint button" | `persistence, cli` |
| "saved to the database" + "`bin/seed` accepts a `--dry-run` flag" | `persistence, cli` |
| "engine adapter reads UCI over a socket" + "persisted between sessions" | `persistence, daemon` |

**It is already half-firing on a real product repo.** In `chess-mvp-yolo` (a SwiftUI iOS app) `persistence` matches repeatedly on shipped specs — "board display settings persistence", "in-progress game persistence", "each change persists across relaunch" — and one Stockfish engine subspec matches `daemon`. Those drafts survived only because each matched a *single* surface; two is the split threshold. A SwiftUI app has no persistence layer, no CLI and no daemon, so a split there emits subspecs named for layers the repo does not contain. Same class as #3426, where jarvis's own `v2/docs/` path leaked into a Vite SPA.

The multi-surface **rejection** leaks the same way: `assertSingleSurfaceBullets` throws on a bullet matching two surfaces, so a product-repo bullet like "the flag is persisted" blocks the draft outright.

## The single-surface escape hatch is unreachable

`declaresSingleSurface` requires both an `Unsplit rationale:` line and a `## Primary implementation surface` section in `intent.md`. Current intents are authored with `## Module-boundary surface`, so the guard cannot fire for them — the split runs even on an intent that declares exactly one surface. That is how a ready-intent declaring "Module-boundary surface: CLI workflow admission" produced `00-daemon.md` + `01-cli.md`.

## The split is redundant with two mechanisms that already work

- `prompts/plan/draft.md:56` already instructs the agent to keep one surface per acceptance-criteria bullet.
- The plan review roles already split oversized subspecs *correctly*: `review-adjudicator.md:50` and `review-actuator.md:53` require "an independently testable split … every original task and acceptance outcome exactly once … every replacement linked from `index.md`" — precisely what the mechanical split fails to do.

The classifier has no consumers outside its own module. Nothing else depends on the taxonomy.

## Evidence

- **2026-09-08, three consecutive plan lanes**, every one hand-collapsed by the operator: `stamp-gate-commands-on-gate-running-steps` (single declared CLI surface → `00-daemon.md` + vacuous `01-cli.md`); `persist-review-step-gate-commands` (`00`/`01` and `02`/`03` identical problems, one with zero criteria, orphan `04`); `run-review-finalization-with-resolved-gate-commands` (`01`/`02` byte-identical, `02` with zero criteria, index linking 2 of 6, five titles disagreeing with filenames). In all three the agent's underlying content was sound — collapsing to the real behaviours landed each one.
- **2026-09-02, `exclude-test-support-from-production-glob`** (run `b17711b8`): `00-cli.md` and `01-execution-loop.md` with identical `## Problem`, orphan `02` declaring a prerequisite on a filename absent from the tree. Discarded.
- **`canonical-pipeline-execution-state-and-stage-claims`**: recorded in the brief as "00/01 subspecs near-duplicate; needs re-plan".

## Decisions

- Retire the mechanical surface split: `normalizePlanDraftSpecDir` keeps the agent's authored subspec files as authored and emits no per-surface children. Rules out repairing the split by deriving per-surface framing — a post-hoc splitter cannot synthesize a per-surface `## Problem`, and two mechanisms that can already do this job correctly are in place.
- Retire the surface taxonomy (`MODULE_BOUNDARY_SURFACES`, `SURFACES`, and the classification helpers) rather than making it configurable. Rules out per-project taxonomies: the invariant worth enforcing is not "which jarvis layer", and no consumer outside this module needs it.
- Preserve the one-artifact-per-bullet rule using the existing artifact-path check (`namesExactlyOneArtifact` / `referencedArtifactPaths`), which is vocabulary-free and repo-agnostic. A bullet naming two files is still rejected, naming the file paths it found. Rules out losing the enforcement `prompts/plan/draft.md:56` advertises.
- Preserve index-link validation (`assertIndexLinks`) unchanged; it is generic and catches real orphans. Rules out retiring orphan detection alongside the split.
- Rules out gating the split to the jarvis project only: that leaves jarvis itself paying the corruption tax that cost three hand-collapses in one session.

## Acceptance criteria

- [ ] A test proves a draft whose acceptance criteria mention two jarvis surfaces is left with its authored files, titles and `## Problem` sections unchanged, and emits no additional subspec; it fails against the current split.
- [ ] A test proves a draft written in ordinary product-repo vocabulary ("each change persists across relaunch" plus "a feature flag hides the hint button") is neither split nor rejected; it fails against the current classifier.
- [ ] A test proves an acceptance-criteria bullet naming two artifact paths is still rejected, with the error naming both paths, and that a bullet naming exactly one is accepted regardless of its wording; it fails if the one-artifact rule is dropped with the taxonomy.
- [ ] A test proves `index.md` linking an unknown or duplicated subspec still throws, unchanged.
- [ ] A guard or test proves no production module outside `shared/module-boundary-surfaces.ts` imports a surface-classification export, so the taxonomy retirement is complete.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and the `test:shared` pair pass.

## Documentation updates

- `prompts/plan/draft.md` — restate the bullet rule as one artifact per bullet; drop the module-boundary-surface framing and the claim that a multi-surface bullet blocks the draft.
- `v2/docs/spec-guidance.md` — the plan agent authors subspecs; there is no post-hoc surface split.
- `v2/docs/write-behavior.md` — remove the draft-normalisation split from the plan write path.
- `v2/docs/v1-behaviors.md` — record the retirement.
