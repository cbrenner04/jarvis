# Discover external plan artifacts for cleanup

## Problem

`discoverStrandedArtifacts` scans only each registered project's in-repo `v2/spec/` home, so completed external plan trees under `~/.jarvis/specs/<safeId>/plans/<name>/` never enter cleanup even when no worktree owns them.

## Decisions

- Discover only immediate open directories under `join(jarvisHome(), "specs", projectSafeId(project), "plans/")` for registered projects whose `planSourcePublishesExternally` predicate is true; rules out scanning unrelated Jarvis storage, other projects' safe IDs, or in-repo-only projects.
- Exclude `completed/` under `plans/` and non-directory entries; rules out re-archiving or treating queue paths as plan artifacts.
- Do not scan `ready-intents/`, `seeds/`, or other siblings at the external specs root; rules out coupling external plan discovery to ready-intent cleanup.
- Merge discovered external candidates into the existing stranded-artifact pipeline with the same `home`/`source`/`name`/`project` shape (`home` = `plans/` directory); rules out a parallel cleanup command or weaker inspection path.
- Resolve discovery candidate paths with the same `realpathSync` / resolved-path containment rules admission uses; skip symlink escapes and malformed trees the admission resolver would refuse; rules out listing discoverable artifacts admission would not admit.
- When multiple registered projects share one `projectSafeId`, skip external discovery for that safe ID with an explicit skip reason and emit no candidates; rules out silent omission or attributing one `plans/` tree to an arbitrary colliding owner.
- Preserve the in-repo `v2/spec/` scan unchanged; rules out narrowing repository artifact discovery.

## Tasks

- Extend `discoverStrandedArtifacts` to append external plan candidates for each scoped registered project that publishes externally.
- Require each candidate directory to contain `index.md`; skip bare files and malformed trees.
- Keep `completed/`, `seeds`, and `ready-intents` exclusions for the in-repo scan; mirror `completed/` exclusion for external `plans/`.
- Add `cleanup.test.ts` discovery coverage with completed, incomplete, unrelated-safe-id, and external-ready-intent fixtures.

## Acceptance criteria

- [x] `cleanup.test.ts` — `"discovers completed external plan directories for planSourcePublishesExternally projects and ignores completed sibling and unrelated storage"` lists only eligible open `plans/<name>/` trees for a registered project whose `planSourcePublishesExternally` predicate is true while skipping `plans/completed/`, unrelated `~/.jarvis/specs/<otherSafeId>/`, and `~/.jarvis/specs/<safeId>/ready-intents/`; it fails against the pre-fix scanner that only reads `<projectRoot>/v2/spec/`.
- [x] `cleanup.test.ts` — `"skips external plans scan for registered projects where planSourcePublishesExternally is false"` emits no external `plans/` candidates for an in-repo-only registered project; it fails against a pre-fix scanner that reads every registered project's external home regardless of `planSourcePublishesExternally`.
- [x] `cleanup.test.ts` — `"archives eligible stranded specs without retiring a worktree and retains refused siblings"` stays green.
- [x] `cleanup.test.ts` — `"keys stranded ownership to the recorded project branch and rechecks it before archival"` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

- None — discovery semantics are documented in `03-document-external-plan-archival.md`.
