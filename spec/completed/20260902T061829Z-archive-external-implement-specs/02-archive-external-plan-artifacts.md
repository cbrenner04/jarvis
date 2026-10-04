# Archive external plan artifacts

## Problem

Even when cleanup can resolve and discover external plan trees, archival still applies in-repo ownership checks (`join(worktree, relative(projectRoot, spec.source))`), previews destinations under `v2/spec/completed/`, and may attempt ready-intent pruning beside `plans/` — none of which match the external plan home contract.

## Decisions

- Reuse `checkArtifactEligibility`, `archiveCompletedSpec`, dry-run preview, apply ordering, and rollback guards without weakening completeness, open-PR, or ownership checks; rules out a separate external cleanup policy.
- Archive to `plans/completed/<name>/` within the same external `plans/` home (`plans/<name> -> plans/completed/<name>`); rules out moving trees into the repository or the external specs root.
- External retired-worktree and stranded archival both use branch-keyed ownership (`hasStrandedOwner`-style) on the durable implementation branch, not path containment inside the code worktree; rules out `hasMaterializedOwner` path checks that cannot locate external specs under `projectRoot` or treat every external plan as unowned.
- Never prune `~/.jarvis/specs/<safeId>/ready-intents/` during external plan archival; rules out applying in-repo `intent.md` byte-match consumption to unrelated external ready-intents.
- Leave in-repo `provenIntentPrune` behavior unchanged; rules out regressing repository ready-intent consumption.

## Tasks

- Route external artifacts through the shared eligibility and archive helpers with `home` set to the external `plans/` directory.
- Adjust retired-worktree archival to use branch-keyed ownership for external sources and path-containment `hasMaterializedOwner` for in-repo sources; keep stranded external ownership on the existing `hasStrandedOwner` branch-keyed path.
- Extend `previewArtifact` / `previewAllCleanupTargets` so external dry-run archive lines read `plans/<name> -> plans/completed/<name>` (full absolute paths in apply stdout remain acceptable when they match that relative shape).
- Ensure `archiveCompletedSpec` rollback on prune failure still applies when external archival is attempted; external candidates must not set `provenIntentPrune`.
- Add apply, dry-run, refusal, and rollback coverage in `cleanup.test.ts`.

## Acceptance criteria

- [x] `cleanup.test.ts` — `"dry-run previews external plan archive as plans/<name> -> plans/completed/<name> without mutation"` reports the external relative move shape and leaves the source tree and `plans/completed/` untouched; it fails against the pre-fix cleanup path that never discovers external plans.
- [x] `cleanup.test.ts` — `"archives eligible external plan after completeness and ownership checks"` moves a complete, unowned external plan into `plans/completed/<name>/` only when open-PR and materialized-owner inspection pass; it fails against the pre-fix code that never archives external trees.
- [x] `cleanup.test.ts` — `"rolls back failed external plan archival under the existing transaction contract"` restores the source directory and prints a skip reason when post-move cleanup fails; it fails against the pre-fix path that never reaches external archival.
- [x] `cleanup.test.ts` — `"archives open-home spec when retiring its owning worktree in one invocation"` stays green.
- [x] `cleanup.test.ts` — `"archives eligible stranded specs without retiring a worktree and retains refused siblings"` stays green.
- [x] `cleanup.test.ts` — `"dry-run previews archive and proven intent pruning without changes"` stays green.
- [x] `cleanup.test.ts` — `"retires before archiving a complete durable spec and prunes only its consumed intent"` stays green.
- [x] `cleanup.test.ts` — `"dry-run stranded archive preview matches apply when owning worktree is in retire preview set"` stays green.
- [x] `cleanup.test.ts` — `"preserves artifacts when retirement fails and reports post-retirement archive refusals"` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- None — operator and parity prose are owned by `03-document-external-plan-archival.md`.
